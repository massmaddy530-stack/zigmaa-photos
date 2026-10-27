// Persistent upload queue for phone captures. Each photo is written to IndexedDB before any upload is attempted and
// is removed only after the server confirms it ("created" or "duplicate"), so a reload, a crash or a Wi-Fi drop
// never loses a queued photo. Uploads run only while the page is open: there is no service worker, so nothing
// uploads after the browser is closed or suspended; the queue simply resumes the next time the page is opened.
// Re-sending a photo is safe: the server de-duplicates by SHA-256 within the event.
import { ApiError, errorMessage, uploadPhotos } from "./api";
import { ACCEPTED_IMAGE_EXTENSIONS, ACCEPTED_IMAGE_TYPES, MAX_UPLOAD_MB } from "./config";
import type { UploadResponse } from "./types";

export type QueueItemStatus =
  | "pending" // waiting for its turn
  | "uploading"
  | "retrying" // transient failure; retried automatically at nextAttemptAt
  | "failed" // gave up (permanent error or too many attempts); can be retried by hand
  | "rejected"; // the server refused the file itself (e.g. not a valid image); retrying will not help

/** Why the whole queue is paused. Items stay stored and resume once the cause is fixed. */
export type QueueBlock = "signin" | "archived" | null;

export interface QueueItem {
  id: string;
  eventId: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  status: QueueItemStatus;
  attempts: number;
  nextAttemptAt: number;
  message?: string;
}

interface StoredItem extends QueueItem {
  data: ArrayBuffer; // ArrayBuffer rather than Blob: stores reliably in every browser's IndexedDB
}

/** A photo the server confirmed during this page session. Kept in memory only, for display; nothing is stored. */
export interface CompletedItem {
  id: string;
  name: string;
  size: number;
  result: "uploaded" | "duplicate";
  restored: boolean;
  at: number;
}

export interface QueueSnapshot {
  items: QueueItem[];
  /** Most recent first, capped at COMPLETED_LIMIT. */
  completed: CompletedItem[];
  progress: Record<string, number>;
  block: QueueBlock;
  blockMessage?: string;
  online: boolean;
  ready: boolean;
  /** Confirmed by the server during this page session (stored items are deleted once confirmed). */
  uploaded: number;
  duplicates: number;
  restored: number;
}

export type UploadFn = typeof uploadPhotos;

export interface UploadQueueOptions {
  eventId: string;
  upload?: UploadFn;
  idb?: IDBFactory;
  /** Parallel uploads; clamped to 1..2 to keep phones on weak Wi-Fi responsive. */
  concurrency?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Automatic attempts before an item is marked failed and waits for a manual retry. */
  maxAttempts?: number;
  random?: () => number;
  now?: () => number;
  /** Whether to listen to window online/offline/visibility events (off in tests). */
  listen?: boolean;
}

const DB_NAME = "zigmaa-upload-queue";
const STORE = "items";
const DB_VERSION = 1;
const COMPLETED_LIMIT = 50;

export function validateImageFile(f: { name: string; type: string; size: number }): string | null {
  if (f.type && !ACCEPTED_IMAGE_TYPES.includes(f.type)) return "Unsupported file type (use JPEG, PNG or WebP)";
  if (!f.type && !ACCEPTED_IMAGE_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
    return "Unsupported file type (use JPEG, PNG or WebP)";
  }
  if (f.size > MAX_UPLOAD_MB * 1024 * 1024) return `Larger than ${MAX_UPLOAD_MB} MB`;
  if (f.size === 0) return "Empty file";
  return null;
}

/** Exponential backoff with full jitter: a random delay in [0.5, 1] x min(max, base * 2^(attempt-1)). */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

type Outcome =
  | { kind: "done"; result: "created" | "duplicate"; restored: boolean }
  | { kind: "rejected"; message: string }
  | { kind: "transient"; message: string }
  | { kind: "permanent"; message: string }
  | { kind: "block"; block: Exclude<QueueBlock, null>; message: string }
  | { kind: "aborted" };

/** Maps one upload attempt (a single-file request) to what the queue should do with the item. */
export function classifyUpload(result: { status: number; body: UploadResponse } | null, err?: unknown): Outcome {
  if (result) {
    const r = result.body.items[0];
    if (!r) return { kind: "transient", message: "No result returned" };
    if (r.status === "created" || r.status === "duplicate") return { kind: "done", result: r.status, restored: !!r.restored };
    // A storage outage is reported per file (HTTP 503); the photo itself is fine, so try again later.
    if (r.error_code === "storage_error" || result.status >= 500) {
      return { kind: "transient", message: r.error ?? "Storage is unavailable" };
    }
    return { kind: "rejected", message: r.error ?? "Rejected by the server" };
  }
  if (err instanceof ApiError) {
    if (err.code === "aborted") return { kind: "aborted" };
    if (err.status === 401) return { kind: "block", block: "signin", message: "Your session expired. Sign in again to continue uploading." };
    if (err.code === "event_archived" || err.status === 409) {
      return { kind: "block", block: "archived", message: errorMessage(err) };
    }
    if (err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500) {
      return { kind: "transient", message: errorMessage(err) };
    }
    return { kind: "permanent", message: errorMessage(err) };
  }
  return { kind: "transient", message: errorMessage(err) };
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" }).createIndex("eventId", "eventId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A stable id for a capture: assigned when the photo is taken and kept through storage, upload and display. */
export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() // secure contexts only; plain-HTTP LAN pages fall through to the fallback
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function strip(stored: StoredItem): QueueItem {
  const item: Partial<StoredItem> = { ...stored };
  delete item.data;
  return item as QueueItem;
}

export class UploadQueue {
  private readonly eventId: string;
  private readonly upload: UploadFn;
  private readonly idb: IDBFactory;
  private readonly concurrency: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly listen: boolean;

  private db: IDBDatabase | null = null;
  private items = new Map<string, QueueItem>();
  private progress: Record<string, number> = {};
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<(s: QueueSnapshot) => void>();
  private block: QueueBlock = null;
  private blockMessage?: string;
  private online = true;
  private ready = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private counts = { uploaded: 0, duplicates: 0, restored: 0 };
  private completed: CompletedItem[] = [];
  private snapshotCache: QueueSnapshot | null = null;

  constructor(opts: UploadQueueOptions) {
    this.eventId = opts.eventId;
    this.upload = opts.upload ?? uploadPhotos;
    const idb = opts.idb ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
    if (!idb) throw new Error("IndexedDB is not available in this browser");
    this.idb = idb;
    this.concurrency = Math.min(2, Math.max(1, opts.concurrency ?? 1));
    this.baseDelayMs = opts.baseDelayMs ?? 2_000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
    this.maxAttempts = opts.maxAttempts ?? 8;
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.listen = opts.listen ?? typeof window !== "undefined";
  }

  /** Loads this event's stored items and starts uploading. Items left "uploading" by a closed page are re-queued. */
  async open(): Promise<void> {
    this.db = await openDb(this.idb);
    const tx = this.db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const stored = await requestToPromise(store.index("eventId").getAll(this.eventId) as IDBRequest<StoredItem[]>);
    for (const s of stored) {
      if (s.status === "uploading") {
        s.status = "pending";
        store.put(s);
      }
      this.items.set(s.id, strip(s));
    }
    await txDone(tx);
    if (this.disposed) return this.closeDb();
    if (this.listen) {
      this.online = typeof navigator === "undefined" || navigator.onLine !== false;
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
      document.addEventListener("visibilitychange", this.onVisible);
    }
    this.ready = true;
    this.emit();
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.controllers.values()) c.abort();
    if (this.listen && typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      document.removeEventListener("visibilitychange", this.onVisible);
    }
    this.listeners.clear();
    this.closeDb();
  }

  subscribe(fn: (s: QueueSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): QueueSnapshot {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        items: [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt),
        completed: this.completed,
        progress: { ...this.progress },
        block: this.block,
        blockMessage: this.blockMessage,
        online: this.online,
        ready: this.ready,
        ...this.counts,
      };
    }
    return this.snapshotCache;
  }

  /**
   * Stores the file first, then queues it. Returns the new item, or a validation message if it was not accepted.
   * Passing the capture's id makes a repeated save of the same photo overwrite its row instead of adding another.
   */
  async add(file: File, opts: { id?: string } = {}): Promise<QueueItem | string> {
    const problem = validateImageFile(file);
    if (problem) return problem;
    const existing = opts.id ? this.items.get(opts.id) : undefined;
    if (existing) return existing; // already stored (a save retried after a write that did complete)
    const db = this.requireDb();
    const now = this.now();
    const item: StoredItem = {
      id: opts.id ?? newId(), eventId: this.eventId, name: file.name || `photo-${now}.jpg`, type: file.type, size: file.size,
      createdAt: now, status: "pending", attempts: 0, nextAttemptAt: 0, data: await file.arrayBuffer(),
    };
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    await txDone(tx); // only queue once the photo is safely stored
    this.items.set(item.id, strip(item));
    this.emit();
    this.pump();
    return strip(item);
  }

  /** Re-queues one failed/rejected/retrying item now (resets its automatic attempt count). */
  async retry(id: string): Promise<void> {
    const it = this.items.get(id);
    if (!it || it.status === "uploading") return;
    await this.update(id, { status: "pending", attempts: 0, nextAttemptAt: 0, message: undefined });
    this.pump();
  }

  async retryAll(): Promise<void> {
    for (const it of [...this.items.values()]) {
      if (it.status === "failed" || it.status === "retrying") await this.retry(it.id);
    }
  }

  /** Removes an item from the device without uploading it. */
  async discard(id: string): Promise<void> {
    this.controllers.get(id)?.abort();
    await this.remove(id);
  }

  /** Clears a sign-in/archived pause (after the user signs in or un-archives) and resumes. */
  resume(): void {
    this.block = null;
    this.blockMessage = undefined;
    for (const it of this.items.values()) if (it.status === "retrying") it.nextAttemptAt = 0;
    this.emit();
    this.pump();
  }

  /** Drives uploads: starts due items up to the concurrency limit and schedules the next retry. */
  pump(): void {
    if (this.disposed || !this.ready || !this.db) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.block || !this.online) return;
    const now = this.now();
    const candidates = [...this.items.values()]
      .filter((it) => (it.status === "pending" || it.status === "retrying") && it.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const it of candidates) {
      if (this.controllers.size >= this.concurrency) break;
      void this.send(it.id);
    }
    const waiting = [...this.items.values()].filter((it) => it.status === "retrying" && it.nextAttemptAt > now);
    if (waiting.length && this.controllers.size < this.concurrency) {
      const next = Math.min(...waiting.map((it) => it.nextAttemptAt));
      this.timer = setTimeout(() => this.pump(), Math.max(0, next - now));
    }
  }

  private async send(id: string): Promise<void> {
    const it = this.items.get(id);
    if (!it || this.controllers.has(id)) return;
    const ctrl = new AbortController();
    this.controllers.set(id, ctrl);
    let outcome: Outcome;
    try {
      await this.update(id, { status: "uploading", message: undefined });
      const stored = await this.load(id);
      if (!stored) {
        this.items.delete(id); // discarded meanwhile
        return;
      }
      const file = new File([stored.data], stored.name, { type: stored.type });
      this.setProgress(id, 0);
      try {
        outcome = classifyUpload(await this.upload(this.eventId, [file], (p) => this.setProgress(id, p), ctrl.signal));
      } catch (err) {
        outcome = classifyUpload(null, err);
      }
    } catch (err) {
      outcome = { kind: "transient", message: errorMessage(err) }; // IndexedDB hiccup: keep the item, try later
    } finally {
      this.controllers.delete(id);
      delete this.progress[id];
    }
    if (this.disposed) return;
    try {
      await this.apply(id, outcome);
    } catch {
      // Storage write failed: the in-memory state is already updated and the stored copy is kept.
    }
    this.pump();
  }

  private async apply(id: string, outcome: Outcome): Promise<void> {
    const it = this.items.get(id);
    if (!it) return;
    switch (outcome.kind) {
      case "done":
        if (outcome.result === "created") this.counts.uploaded++;
        else this.counts.duplicates++;
        if (outcome.restored) this.counts.restored++;
        const done: CompletedItem = {
          id, name: it.name, size: it.size, result: outcome.result === "created" ? "uploaded" : "duplicate",
          restored: outcome.restored, at: this.now(),
        };
        this.completed = [done, ...this.completed].slice(0, COMPLETED_LIMIT);
        await this.remove(id); // confirmed by the server: only now is the stored copy deleted
        return;
      case "rejected":
        await this.update(id, { status: "rejected", message: outcome.message });
        return;
      case "permanent":
        await this.update(id, { status: "failed", message: outcome.message });
        return;
      case "aborted":
        await this.update(id, { status: "pending" });
        return;
      case "block":
        this.block = outcome.block;
        this.blockMessage = outcome.message;
        await this.update(id, { status: "pending" });
        return;
      case "transient": {
        const attempts = it.attempts + 1;
        if (attempts >= this.maxAttempts) {
          await this.update(id, { status: "failed", attempts, message: `${outcome.message} (gave up after ${attempts} attempts)` });
        } else {
          const delay = backoffDelay(attempts, this.baseDelayMs, this.maxDelayMs, this.random);
          await this.update(id, { status: "retrying", attempts, nextAttemptAt: this.now() + delay, message: outcome.message });
        }
      }
    }
  }

  private onOnline = () => {
    this.online = true;
    for (const it of this.items.values()) if (it.status === "retrying") it.nextAttemptAt = 0; // connection is back: retry now
    this.emit();
    this.pump();
  };

  private onOffline = () => {
    this.online = false;
    this.emit();
  };

  private onVisible = () => {
    if (document.visibilityState === "visible") this.pump();
  };

  private setProgress(id: string, p: number) {
    this.progress[id] = p;
    this.emit();
  }

  private emit() {
    this.snapshotCache = null;
    if (!this.listeners.size) return;
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error("Upload queue is not open");
    return this.db;
  }

  private async load(id: string): Promise<StoredItem | undefined> {
    const tx = this.requireDb().transaction(STORE, "readonly");
    return requestToPromise(tx.objectStore(STORE).get(id) as IDBRequest<StoredItem | undefined>);
  }

  private async update(id: string, patch: Partial<QueueItem>): Promise<void> {
    const it = this.items.get(id);
    if (!it) return;
    const next = { ...it, ...patch };
    this.items.set(id, next);
    this.emit();
    const tx = this.requireDb().transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const stored = await requestToPromise(store.get(id) as IDBRequest<StoredItem | undefined>);
    if (stored) store.put({ ...stored, ...patch });
    await txDone(tx);
  }

  private async remove(id: string): Promise<void> {
    this.items.delete(id);
    delete this.progress[id];
    this.emit();
    const tx = this.requireDb().transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  }

  private closeDb() {
    this.db?.close();
    this.db = null;
  }
}

export interface PendingCapture {
  id: string;
  file: File;
  saving: boolean;
  /** Why the last save failed. The photo stays in memory until it is saved or the user discards it. */
  error?: string;
  /** The file was refused by validation (wrong type, too large): saving again will not help. */
  invalid?: boolean;
}

/**
 * Holds captured photos in memory until the upload queue has written them to IndexedDB, one at a time and in capture
 * order. Camera captures are limited to `limit` unsaved photos (each is a full-resolution image in memory); when the
 * buffer is full the shutter should wait. Files picked from the gallery are already on disk and bypass the limit.
 */
export class CaptureBuffer {
  private pending: PendingCapture[] = [];
  private draining = false;
  private listeners = new Set<(items: readonly PendingCapture[]) => void>();

  constructor(
    private readonly save: (file: File, id: string) => Promise<QueueItem | string>,
    private readonly limit = 5,
  ) {}

  get items(): readonly PendingCapture[] {
    return this.pending;
  }

  /** True when no more camera captures should be accepted until earlier ones are saved. */
  get full(): boolean {
    return this.pending.filter((p) => !p.invalid).length >= this.limit;
  }

  subscribe(fn: (items: readonly PendingCapture[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.pending);
    return () => this.listeners.delete(fn);
  }

  /** Accepts a photo and returns its stable id, or null when the buffer is full (the caller keeps the photo). */
  push(file: File, opts: { bypassLimit?: boolean } = {}): string | null {
    if (!opts.bypassLimit && this.full) return null;
    const id = newId();
    this.pending = [...this.pending, { id, file, saving: false }];
    this.emit();
    void this.drain();
    return id;
  }

  retry(id: string): void {
    this.patch(id, { error: undefined });
    void this.drain();
  }

  /** Drops an unsaved photo. Only for an explicit user decision; never called automatically. */
  discard(id: string): void {
    this.pending = this.pending.filter((p) => p.id !== id || p.saving);
    this.emit();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const next = this.pending.find((p) => !p.saving && !p.error);
        if (!next) break;
        this.patch(next.id, { saving: true });
        try {
          const res = await this.save(next.file, next.id);
          if (typeof res === "string") this.patch(next.id, { saving: false, error: res, invalid: true });
          else {
            this.pending = this.pending.filter((p) => p.id !== next.id);
            this.emit();
          }
        } catch (err) {
          this.patch(next.id, { saving: false, error: err instanceof Error && err.message ? err.message : "Could not save the photo" });
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private patch(id: string, update: Partial<PendingCapture>) {
    this.pending = this.pending.map((p) => (p.id === id ? { ...p, ...update } : p));
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.pending);
  }
}

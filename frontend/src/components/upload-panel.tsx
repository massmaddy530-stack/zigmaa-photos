"use client";

import { CheckCircle2, Copy, FolderUp, Loader2, RotateCcw, Square, UploadCloud, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { ApiError, errorMessage, uploadPhotos } from "@/lib/api";
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_MB,
  UPLOAD_BATCH_BYTES,
  UPLOAD_BATCH_FILES,
  UPLOAD_CONCURRENCY,
} from "@/lib/config";
import { cn, formatBytes, formatNumber } from "@/lib/format";
import { Button } from "./ui/button";
import { Card, ProgressBar } from "./ui/primitives";
import { Alert } from "./ui/states";
import { useToast } from "./ui/toast";

type ItemStatus = "queued" | "uploading" | "created" | "duplicate" | "rejected" | "error";
interface UploadItem {
  id: number;
  file: File;
  status: ItemStatus;
  progress: number;
  message?: string;
}

const STATUS_TEXT: Record<ItemStatus, string> = {
  queued: "Waiting", uploading: "Uploading", created: "Uploaded", duplicate: "Already uploaded",
  rejected: "Rejected", error: "Failed",
};

let nextId = 1;

function preValidate(f: File): string | null {
  if (f.type && !ACCEPTED_IMAGE_TYPES.includes(f.type)) return "Unsupported file type (use JPEG, PNG or WebP)";
  if (!f.type && !ACCEPTED_IMAGE_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) return "Unsupported file type (use JPEG, PNG or WebP)";
  if (f.size > MAX_UPLOAD_MB * 1024 * 1024) return `Larger than ${MAX_UPLOAD_MB} MB`;
  if (f.size === 0) return "Empty file";
  return null;
}

function makeBatches(items: UploadItem[]): UploadItem[][] {
  const batches: UploadItem[][] = [];
  let cur: UploadItem[] = [];
  let bytes = 0;
  for (const it of items) {
    if (cur.length && (cur.length >= UPLOAD_BATCH_FILES || bytes + it.file.size > UPLOAD_BATCH_BYTES)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.file.size;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export function UploadPanel({ eventId, disabled, onUploaded }: {
  eventId: string;
  disabled?: boolean;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const itemsRef = useRef(items);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patch = useCallback((ids: Set<number>, update: Partial<UploadItem> | ((it: UploadItem) => Partial<UploadItem>)) => {
    setItems((prev) => {
      const next = prev.map((it) => (ids.has(it.id) ? { ...it, ...(typeof update === "function" ? update(it) : update) } : it));
      itemsRef.current = next;
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setFatal(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let created = 0;
    let stopAll = false;

    // Keep draining: files added while uploading are picked up in the next round.
    for (;;) {
      const queued = itemsRef.current.filter((i) => i.status === "queued");
      if (!queued.length || ctrl.signal.aborted || stopAll) break;
      const batches = makeBatches(queued);
      let cursor = 0;
      const worker = async () => {
        while (cursor < batches.length && !ctrl.signal.aborted && !stopAll) {
          const batch = batches[cursor++];
          const ids = new Set(batch.map((b) => b.id));
          patch(ids, { status: "uploading", progress: 0, message: undefined });
          try {
            const { body } = await uploadPhotos(eventId, batch.map((b) => b.file), (p) => patch(ids, { progress: p }), ctrl.signal);
            setItems((prev) => {
              const next = prev.map((it) => {
                const idx = batch.findIndex((b) => b.id === it.id);
                if (idx < 0) return it;
                const r = body.items[idx];
                if (!r) return { ...it, status: "error" as const, progress: 0, message: "No result returned" };
                return { ...it, status: r.status, progress: 1, message: r.error ?? undefined };
              });
              itemsRef.current = next;
              return next;
            });
            created += body.created;
          } catch (err) {
            const aborted = err instanceof ApiError && err.code === "aborted";
            patch(ids, { status: aborted ? "queued" : "error", progress: 0, message: aborted ? undefined : errorMessage(err) });
            if (err instanceof ApiError && (err.status === 401 || err.code === "event_archived" || err.status === 409)) {
              stopAll = true;
              setFatal(err.status === 401 ? "Your session expired. Sign in again to continue uploading." : errorMessage(err));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    }

    runningRef.current = false;
    setRunning(false);
    abortRef.current = null;
    if (created) {
      toast.success(`${formatNumber(created)} photo${created === 1 ? "" : "s"} uploaded`, "Processing has started.");
      onUploaded();
    }
  }, [eventId, onUploaded, patch, toast]);

  function addFiles(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const added: UploadItem[] = Array.from(list).map((file) => {
      const problem = preValidate(file);
      return { id: nextId++, file, status: problem ? "rejected" : "queued", progress: 0, message: problem ?? undefined };
    });
    if (!added.length) return;
    setItems((prev) => {
      const next = [...prev, ...added];
      itemsRef.current = next;
      return next;
    });
    if (added.some((a) => a.status === "queued")) void run();
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  const counts = items.reduce((acc, it) => ({ ...acc, [it.status]: (acc[it.status] ?? 0) + 1 }), {} as Partial<Record<ItemStatus, number>>);
  const active = items.filter((i) => i.status === "uploading");
  const totalBytes = items.reduce((s, i) => s + i.file.size, 0);
  const doneBytes = items.reduce((s, i) => s + (["created", "duplicate", "rejected", "error"].includes(i.status) ? i.file.size : i.file.size * i.progress), 0);
  const failedCount = (counts.error ?? 0);

  return (
    <div className="space-y-4">
      {disabled && <Alert tone="warning" title="This event is archived">Un-archive it in Settings to upload more photos.</Alert>}
      {fatal && <Alert tone="error" title="Upload stopped">{fatal}</Alert>}

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("relative rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:py-14",
          dragging ? "border-brand-500 bg-brand-50" : "border-line bg-surface",
          disabled && "pointer-events-none opacity-50")}
      >
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
          <UploadCloud className="h-7 w-7" aria-hidden />
        </div>
        <p className="text-base font-semibold text-ink">Drag photos here</p>
        <p className="mt-1 text-sm text-muted">JPEG, PNG or WebP · up to {MAX_UPLOAD_MB} MB each · duplicates are skipped automatically</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileInput.current?.click()} icon={<UploadCloud className="h-4 w-4" />}>Choose photos</Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()} icon={<FolderUp className="h-4 w-4" />}>Choose folder</Button>
        </div>
        <input ref={fileInput} type="file" multiple accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(",")} className="sr-only" tabIndex={-1}
               onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1}
               {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
               onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      {items.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                {running ? `Uploading… ${active.length ? `(${formatNumber(active.length)} in flight)` : ""}` : "Upload queue"}
              </p>
              <p className="text-xs text-muted">
                {formatNumber(counts.created ?? 0)} uploaded · {formatNumber(counts.duplicate ?? 0)} duplicates ·{" "}
                {formatNumber((counts.rejected ?? 0) + failedCount)} problems · {formatNumber(counts.queued ?? 0)} waiting
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {running && (
                <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()} icon={<Square className="h-3.5 w-3.5" />}>Stop</Button>
              )}
              {!running && failedCount > 0 && (
                <Button size="sm" variant="outline" icon={<RotateCcw className="h-4 w-4" />} onClick={() => {
                  patch(new Set(items.filter((i) => i.status === "error").map((i) => i.id)), { status: "queued", message: undefined });
                  void run();
                }}>Retry {failedCount}</Button>
              )}
              {!running && (counts.queued ?? 0) > 0 && <Button size="sm" onClick={() => void run()}>Resume</Button>}
              {!running && (
                <Button size="sm" variant="ghost" onClick={() => setItems((prev) => prev.filter((i) => i.status === "queued"))}>Clear finished</Button>
              )}
            </div>
          </div>
          <div className="px-5 pt-4">
            <ProgressBar value={totalBytes ? doneBytes / totalBytes : 0} label="Overall upload progress" />
            <p className="mt-1.5 text-xs tabular-nums text-muted">{formatBytes(doneBytes)} of {formatBytes(totalBytes)}</p>
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto px-5 py-2">
            {items.slice().reverse().map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2.5">
                <StatusIcon status={it.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-ink">{it.file.name}</p>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{formatBytes(it.file.size)}</span>
                  </div>
                  {it.status === "uploading" ? (
                    <ProgressBar value={it.progress} className="mt-1.5 h-1.5" label={`Uploading ${it.file.name}`} />
                  ) : (
                    <p className={cn("text-xs", it.status === "rejected" || it.status === "error" ? "text-red-600" : "text-muted")}>
                      {it.message ?? STATUS_TEXT[it.status]}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  const cls = "h-5 w-5 shrink-0";
  switch (status) {
    case "uploading": return <Loader2 className={cn(cls, "animate-spin text-brand-600")} aria-label="Uploading" />;
    case "created": return <CheckCircle2 className={cn(cls, "text-emerald-600")} aria-label="Uploaded" />;
    case "duplicate": return <Copy className={cn(cls, "text-zinc-400")} aria-label="Duplicate" />;
    case "rejected":
    case "error": return <XCircle className={cn(cls, "text-red-500")} aria-label="Failed" />;
    default: return <span className={cn(cls, "rounded-full border-2 border-zinc-200")} aria-label="Waiting" />;
  }
}

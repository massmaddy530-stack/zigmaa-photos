import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import type { UploadResponse } from "./types";
import { backoffDelay, CaptureBuffer, classifyUpload, UploadQueue, type UploadFn, type UploadQueueOptions } from "./upload-queue";

const EVENT = "11111111-1111-1111-1111-111111111111";

function photo(name = "IMG_0001.jpg", bytes = 1024, type = "image/jpeg") {
  return new File([new Uint8Array(bytes).fill(7)], name, { type });
}

function reply(status: "created" | "duplicate" | "rejected", extra: Partial<UploadResponse["items"][number]> = {}, http = 201) {
  return {
    status: http,
    body: {
      created: status === "created" ? 1 : 0, duplicates: status === "duplicate" ? 1 : 0, rejected: status === "rejected" ? 1 : 0,
      items: [{ filename: "x.jpg", status, photo_id: status === "rejected" ? null : "p1", error_code: null, error: null, ...extra }],
    } satisfies UploadResponse,
  };
}

const queues: UploadQueue[] = [];

function makeQueue(idb: IDBFactory, upload: UploadFn, opts: Partial<UploadQueueOptions> = {}) {
  const q = new UploadQueue({ eventId: EVENT, upload, idb, listen: false, baseDelayMs: 5, maxDelayMs: 20, random: () => 0, ...opts });
  queues.push(q);
  return q;
}

async function waitFor(cond: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 2));
  }
}

/** Reads the raw stored rows straight from IndexedDB, bypassing the queue. */
async function storedRows(idb: IDBFactory): Promise<{ id: string; status: string; data: ArrayBuffer }[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open("zigmaa-upload-queue", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const rows = await new Promise<{ id: string; status: string; data: ArrayBuffer }[]>((resolve, reject) => {
    const req = db.transaction("items", "readonly").objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows;
}

afterEach(() => {
  while (queues.length) queues.pop()!.dispose();
});

describe("backoffDelay", () => {
  it("doubles per attempt, applies jitter in [50%, 100%] and is capped", () => {
    expect(backoffDelay(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 60_000, () => 1)).toBe(4000);
    expect(backoffDelay(3, 1000, 60_000, () => 0)).toBe(2000);
    expect(backoffDelay(20, 1000, 60_000, () => 1)).toBe(60_000);
  });
});

describe("classifyUpload", () => {
  it("maps server results and errors to queue actions", () => {
    expect(classifyUpload(reply("created"))).toEqual({ kind: "done", result: "created", restored: false });
    expect(classifyUpload(reply("duplicate", { restored: true }, 200))).toEqual({ kind: "done", result: "duplicate", restored: true });
    expect(classifyUpload(reply("rejected", { error_code: "invalid_image", error: "Not an image" }, 422)).kind).toBe("rejected");
    expect(classifyUpload(reply("rejected", { error_code: "storage_error" }, 503)).kind).toBe("transient");
    expect(classifyUpload(null, new ApiError(0, "network_error", "offline")).kind).toBe("transient");
    expect(classifyUpload(null, new ApiError(502, "http_502", "bad gateway")).kind).toBe("transient");
    expect(classifyUpload(null, new ApiError(401, "unauthorized", "x"))).toMatchObject({ kind: "block", block: "signin" });
    expect(classifyUpload(null, new ApiError(409, "event_archived", "x"))).toMatchObject({ kind: "block", block: "archived" });
    expect(classifyUpload(null, new ApiError(413, "too_many_files", "x")).kind).toBe("permanent");
    expect(classifyUpload(null, new ApiError(0, "aborted", "x")).kind).toBe("aborted");
  });
});

describe("UploadQueue", () => {
  it("stores the photo before uploading and deletes it only after the server confirms it", async () => {
    const idb = new IDBFactory();
    let storedDuringUpload = -1;
    const upload = vi.fn<UploadFn>(async (_e, files) => {
      storedDuringUpload = (await storedRows(idb)).length;
      expect(files[0].name).toBe("IMG_0001.jpg");
      expect(files[0].size).toBe(1024);
      return reply("created");
    });
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().uploaded === 1);
    expect(storedDuringUpload).toBe(1);
    expect(upload).toHaveBeenCalledWith(EVENT, expect.any(Array), expect.any(Function), expect.any(AbortSignal));
    expect(q.snapshot().items).toHaveLength(0);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("treats a duplicate as confirmed and removes it", async () => {
    const idb = new IDBFactory();
    const q = makeQueue(idb, vi.fn<UploadFn>(async () => reply("duplicate", {}, 200)));
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().duplicates === 1);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("retries transient failures with backoff and keeps the photo stored until it succeeds", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>()
      .mockRejectedValueOnce(new ApiError(0, "network_error", "offline"))
      .mockRejectedValueOnce(new ApiError(503, "http_503", "unavailable"))
      .mockResolvedValueOnce(reply("created"));
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().items[0]?.status === "retrying");
    expect(q.snapshot().items[0].attempts).toBe(1);
    expect(await storedRows(idb)).toHaveLength(1);
    await waitFor(() => q.snapshot().uploaded === 1);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("gives up after maxAttempts, keeps the photo, and succeeds on a manual retry", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>().mockRejectedValue(new ApiError(0, "network_error", "offline"));
    const q = makeQueue(idb, upload, { maxAttempts: 3 });
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().items[0]?.status === "failed");
    expect(upload).toHaveBeenCalledTimes(3);
    expect((await storedRows(idb))[0].status).toBe("failed");

    upload.mockResolvedValue(reply("created"));
    await q.retry(q.snapshot().items[0].id);
    await waitFor(() => q.snapshot().uploaded === 1);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("marks a file the server rejects as rejected, keeps it, and does not retry it automatically", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>(async () => reply("rejected", { error_code: "invalid_image", error: "Not an image" }, 422));
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().items[0]?.status === "rejected");
    await new Promise((r) => setTimeout(r, 40));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(q.snapshot().items[0].message).toBe("Not an image");
    expect(await storedRows(idb)).toHaveLength(1);
    await q.discard(q.snapshot().items[0].id);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("pauses the whole queue on 401 without losing photos, and resumes after sign-in", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>().mockRejectedValueOnce(new ApiError(401, "unauthorized", "Please sign in."));
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo("a.jpg"));
    await waitFor(() => q.snapshot().block === "signin");
    await q.add(photo("b.jpg"));
    await new Promise((r) => setTimeout(r, 40));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(q.snapshot().items.map((i) => i.status)).toEqual(["pending", "pending"]);
    expect(await storedRows(idb)).toHaveLength(2);

    upload.mockResolvedValue(reply("created"));
    q.resume();
    await waitFor(() => q.snapshot().uploaded === 2);
    expect(q.snapshot().block).toBeNull();
  });

  it("pauses on an archived event and keeps the photos stored", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>().mockRejectedValue(new ApiError(409, "event_archived", "Cannot upload to an archived event"));
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo());
    await waitFor(() => q.snapshot().block === "archived");
    expect(q.snapshot().blockMessage).toBe("Cannot upload to an archived event");
    expect(q.snapshot().items[0].status).toBe("pending");
    expect(await storedRows(idb)).toHaveLength(1);
  });

  it("keeps queued photos across a reload and uploads them when the page opens again", async () => {
    const idb = new IDBFactory();
    // First page: the upload never finishes (e.g. the tab was closed mid-upload).
    const first = makeQueue(idb, vi.fn<UploadFn>(() => new Promise(() => {})));
    await first.open();
    await first.add(photo("a.jpg"));
    await first.add(photo("b.jpg", 2048));
    await waitFor(() => first.snapshot().items.some((i) => i.status === "uploading"));
    first.dispose();
    expect((await storedRows(idb)).map((r) => r.status).sort()).toEqual(["pending", "uploading"]);

    // Second page load: the interrupted item is re-queued and both are uploaded with their original bytes.
    const sizes: number[] = [];
    const second = makeQueue(idb, vi.fn<UploadFn>(async (_e, files) => {
      sizes.push(files[0].size);
      return reply("created");
    }));
    await second.open();
    await waitFor(() => second.snapshot().uploaded === 2);
    expect(sizes.sort((a, b) => a - b)).toEqual([1024, 2048]);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("rejects unsupported or oversized files without storing them", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>();
    const q = makeQueue(idb, upload);
    await q.open();
    expect(await q.add(photo("clip.mov", 10, "video/quicktime"))).toMatch(/Unsupported/);
    expect(await q.add(photo("empty.jpg", 0))).toBe("Empty file");
    expect(await storedRows(idb)).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it("never runs more than two uploads at once", async () => {
    const idb = new IDBFactory();
    let inFlight = 0;
    let peak = 0;
    const upload = vi.fn<UploadFn>(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return reply("created");
    });
    const q = makeQueue(idb, upload, { concurrency: 5 });
    await q.open();
    for (let i = 0; i < 5; i++) await q.add(photo(`p${i}.jpg`));
    await waitFor(() => q.snapshot().uploaded === 5);
    expect(peak).toBe(2);
  });
});

describe("continuous capture", () => {
  it("saves rapid captures in capture order with stable ids, and shows each as uploaded once confirmed", async () => {
    const idb = new IDBFactory();
    const sent: string[] = [];
    const upload = vi.fn<UploadFn>(async (_e, files) => {
      sent.push(files[0].name);
      return reply("created");
    });
    const q = makeQueue(idb, upload);
    await q.open();
    const buffer = new CaptureBuffer((file, id) => q.add(file, { id }), 20);
    const ids = Array.from({ length: 10 }, (_, i) => buffer.push(photo(`shot-${i}.jpg`)));
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(10);

    await waitFor(() => q.snapshot().uploaded === 10);
    expect(buffer.items).toHaveLength(0);
    expect(sent).toEqual(Array.from({ length: 10 }, (_, i) => `shot-${i}.jpg`));
    // The id assigned at capture is the id the upload completes under (most recent first).
    expect(q.snapshot().completed.map((c) => c.id)).toEqual([...ids].reverse());
    expect(q.snapshot().completed.every((c) => c.result === "uploaded")).toBe(true);
    expect(await storedRows(idb)).toHaveLength(0);
  });

  it("limits unsaved camera captures, then accepts more once earlier ones are saved", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const saved: string[] = [];
    const buffer = new CaptureBuffer(async (file, id) => {
      await gate;
      saved.push(file.name);
      return { id } as never;
    }, 3);
    expect(buffer.push(photo("a.jpg"))).not.toBeNull();
    expect(buffer.push(photo("b.jpg"))).not.toBeNull();
    expect(buffer.push(photo("c.jpg"))).not.toBeNull();
    expect(buffer.full).toBe(true);
    expect(buffer.push(photo("d.jpg"))).toBeNull(); // camera capture refused while full; the caller keeps it
    expect(buffer.push(photo("gallery.jpg"), { bypassLimit: true })).not.toBeNull(); // gallery files are on disk
    release();
    await waitFor(() => buffer.items.length === 0);
    expect(saved).toEqual(["a.jpg", "b.jpg", "c.jpg", "gallery.jpg"]);
    expect(buffer.full).toBe(false);
    expect(buffer.push(photo("d.jpg"))).not.toBeNull();
  });

  it("keeps a photo whose save failed and saves it on retry, never dropping it", async () => {
    const idb = new IDBFactory();
    const q = makeQueue(idb, vi.fn<UploadFn>(() => new Promise(() => {})));
    await q.open();
    let failNext = true;
    const buffer = new CaptureBuffer(async (file, id) => {
      if (failNext) {
        failNext = false;
        throw new Error("QuotaExceededError");
      }
      return q.add(file, { id });
    }, 5);
    const id = buffer.push(photo("keep-me.jpg"))!;
    await waitFor(() => buffer.items[0]?.error === "QuotaExceededError");
    expect(buffer.items).toHaveLength(1);
    expect(buffer.items[0].id).toBe(id);
    expect(await storedRows(idb)).toHaveLength(0);

    buffer.retry(id);
    await waitFor(() => buffer.items.length === 0);
    expect((await storedRows(idb)).map((r) => r.id)).toEqual([id]);
  });

  it("marks files refused by validation as invalid without counting them against the limit", async () => {
    const idb = new IDBFactory();
    const q = makeQueue(idb, vi.fn<UploadFn>());
    await q.open();
    const buffer = new CaptureBuffer((file, id) => q.add(file, { id }), 1);
    buffer.push(photo("clip.mov", 10, "video/quicktime"), { bypassLimit: true });
    await waitFor(() => buffer.items[0]?.invalid === true);
    expect(buffer.items[0].error).toMatch(/Unsupported/);
    expect(buffer.full).toBe(false);
  });

  it("saving the same capture id twice stores one row", async () => {
    const idb = new IDBFactory();
    const q = makeQueue(idb, vi.fn<UploadFn>(() => new Promise(() => {})));
    await q.open();
    await q.add(photo("once.jpg"), { id: "fixed-id" });
    await q.add(photo("once.jpg"), { id: "fixed-id" });
    expect((await storedRows(idb)).map((r) => r.id)).toEqual(["fixed-id"]);
    expect(q.snapshot().items).toHaveLength(1);
  });

  it("lists confirmed duplicates separately from uploads", async () => {
    const idb = new IDBFactory();
    const upload = vi.fn<UploadFn>().mockResolvedValueOnce(reply("created")).mockResolvedValueOnce(reply("duplicate", {}, 200));
    const q = makeQueue(idb, upload);
    await q.open();
    await q.add(photo("first.jpg"));
    await waitFor(() => q.snapshot().uploaded === 1);
    await q.add(photo("again.jpg"));
    await waitFor(() => q.snapshot().duplicates === 1);
    expect(q.snapshot().completed.map((c) => [c.name, c.result])).toEqual([["again.jpg", "duplicate"], ["first.jpg", "uploaded"]]);
  });
});

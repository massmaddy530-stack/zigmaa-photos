"use client";

import { Check, CheckSquare, Download, ExternalLink, ImageIcon, RotateCcw, ScanFace, Search, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { downloadImage, downloadImagesInBatch, getSavedWatermarkConfig, fetchEventWatermarkConfig, type WatermarkConfig } from "@/lib/image";
import { cn, formatBytes, formatDateTime, formatNumber } from "@/lib/format";
import { useDebounced, useQuery } from "@/lib/hooks";
import type { PhotoDetailOut, PhotoOut, PhotoStatus } from "@/lib/types";
import { GridSkeleton, Lightbox, PhotoGrid, PhotoTile, type GalleryItem } from "./gallery";
import { PHOTO_STATUS_META, PhotoStatusBadge } from "./status-badges";
import { Button } from "./ui/button";
import { ConfirmDialog } from "./ui/modal";
import { Pagination } from "./ui/pagination";
import { Badge, Card, Input, Select, Skeleton } from "./ui/primitives";
import { EmptyState, ErrorState } from "./ui/states";
import { useToast } from "./ui/toast";

const LIMIT = 48;

export function EventPhotos({ eventId, refreshKey, pollWhileProcessing, onChanged, onGoUpload }: {
  eventId: string;
  refreshKey: string;
  pollWhileProcessing: boolean;
  onChanged: () => void;
  onGoUpload?: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<PhotoStatus | "">("");
  const [faces, setFaces] = useState<"" | "yes" | "no">("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [faceBoxes, setFaceBoxes] = useState<{ id: string; faces: PhotoDetailOut["faces"] } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [busyBatchDelete, setBusyBatchDelete] = useState(false);
  const [busyBatchRetry, setBusyBatchRetry] = useState(false);
  const [busyBatchDownload, setBusyBatchDownload] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number } | null>(null);
  const [eventWatermark, setEventWatermark] = useState<WatermarkConfig | undefined>(() => getSavedWatermarkConfig(eventId));
  const dq = useDebounced(q.trim(), 300);

  useEffect(() => {
    const localCfg = getSavedWatermarkConfig(eventId);
    if (localCfg) setEventWatermark(localCfg);
    void fetchEventWatermarkConfig(eventId).then((cfg) => {
      if (cfg) setEventWatermark(cfg);
    });
  }, [eventId, refreshKey]);

  const photos = useQuery(
    () => adminApi.listPhotos(eventId, {
      status, q: dq, has_faces: faces === "" ? null : faces === "yes", limit: LIMIT, offset,
    }),
    [eventId, status, dq, faces, offset, refreshKey],
    { pollMs: pollWhileProcessing ? 4000 : false },
  );
  const data = photos.data;
  const filtered = Boolean(status || dq || faces);
  const items: GalleryItem[] = (data?.items ?? []).map((p) => ({
    id: p.id, thumbnailUrl: p.thumbnail_url, previewUrl: p.preview_url, alt: p.original_filename,
  }));

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOnPage = () => {
    if (!data?.items) return;
    const pageIds = data.items.map((p) => p.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...pageIds]));
    }
  };

  const handleBatchRetry = async () => {
    if (selectedIds.size === 0) return;
    setBusyBatchRetry(true);
    try {
      const res = await adminApi.batchRetryPhotos(eventId, Array.from(selectedIds));
      toast.success(res.queued ? `Re-queued ${res.queued} photo${res.queued === 1 ? "" : "s"} for processing` : "No photos needed retry");
      setSelectedIds(new Set());
      setIsSelecting(false);
      photos.reload();
      onChanged();
    } catch (err) {
      toast.error("Could not retry selected photos", errorMessage(err));
    } finally {
      setBusyBatchRetry(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBusyBatchDelete(true);
    try {
      const res = await adminApi.batchDeletePhotos(eventId, Array.from(selectedIds));
      toast.success(`${res.deleted} photo${res.deleted === 1 ? "" : "s"} deleted permanently`);
      setSelectedIds(new Set());
      setIsSelecting(false);
      setConfirmBatchDelete(false);
      photos.reload();
      onChanged();
    } catch (err) {
      toast.error("Could not delete selected photos", errorMessage(err));
    } finally {
      setBusyBatchDelete(false);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.size === 0 || !data?.items) return;
    setBusyBatchDownload(true);
    setDownloadProgress({ done: 0, total: selectedIds.size });
    try {
      let wmConfig = getSavedWatermarkConfig(eventId) || eventWatermark;
      if (!wmConfig) {
        wmConfig = await fetchEventWatermarkConfig(eventId);
        if (wmConfig) setEventWatermark(wmConfig);
      }
      const selectedPhotos = data.items.filter((p) => selectedIds.has(p.id));
      const targets = selectedPhotos.map((p) => ({
        url: p.preview_url || p.thumbnail_url || "",
        filename: p.original_filename || `photo-${p.id.slice(0, 8)}.jpg`,
      })).filter((x) => Boolean(x.url));

      await downloadImagesInBatch(targets, wmConfig, (done, total) => {
        setDownloadProgress({ done, total });
      });
      toast.success(`Downloaded ${targets.length} photo${targets.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Download failed", errorMessage(err));
    } finally {
      setBusyBatchDownload(false);
      setDownloadProgress(null);
    }
  };

  const handleDownloadAllPhotos = async () => {
    if (!data || data.total === 0) return;
    setBusyBatchDownload(true);
    setDownloadProgress({ done: 0, total: data.total });
    try {
      let wmConfig = getSavedWatermarkConfig(eventId) || eventWatermark;
      if (!wmConfig) {
        wmConfig = await fetchEventWatermarkConfig(eventId);
        if (wmConfig) setEventWatermark(wmConfig);
      }

      // Fetch all photos across all pages for this event
      let allItems: PhotoOut[] = [];
      let curOffset = 0;
      const fetchLimit = 100;
      while (curOffset < data.total) {
        const res = await adminApi.listPhotos(eventId, {
          status,
          q: dq,
          has_faces: faces === "" ? null : faces === "yes",
          limit: fetchLimit,
          offset: curOffset,
        });
        allItems = [...allItems, ...res.items];
        curOffset += res.items.length;
        if (!res.items.length) break;
      }

      const targets = allItems.map((p) => ({
        url: p.preview_url || p.thumbnail_url || "",
        filename: p.original_filename || `photo-${p.id.slice(0, 8)}.jpg`,
      })).filter((x) => Boolean(x.url));

      await downloadImagesInBatch(targets, wmConfig, (done, total) => {
        setDownloadProgress({ done, total });
      });
      toast.success(`Successfully downloaded all ${targets.length} photos!`);
    } catch (err) {
      toast.error("Download all photos failed", errorMessage(err));
    } finally {
      setBusyBatchDownload(false);
      setDownloadProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input type="search" placeholder="Search filename" value={q} onChange={(e) => resetPage(setQ)(e.target.value)}
                 className="pl-10" aria-label="Search by filename" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={status} onChange={(e) => resetPage(setStatus)(e.target.value as PhotoStatus | "")} aria-label="Filter by status" className="sm:w-40">
            <option value="">All statuses</option>
            {(Object.keys(PHOTO_STATUS_META) as PhotoStatus[]).map((s) => <option key={s} value={s}>{PHOTO_STATUS_META[s].label}</option>)}
          </Select>
          <Select value={faces} onChange={(e) => resetPage(setFaces)(e.target.value as "" | "yes" | "no")} aria-label="Filter by faces" className="sm:w-40">
            <option value="">Any faces</option>
            <option value="yes">With faces</option>
            <option value="no">No faces</option>
          </Select>
          <Button
            type="button"
            variant={isSelecting ? "secondary" : "outline"}
            size="md"
            onClick={() => {
              setIsSelecting(!isSelecting);
              if (isSelecting) setSelectedIds(new Set());
            }}
            icon={<CheckSquare className="h-4 w-4" />}
          >
            {isSelecting ? "Cancel selection" : "Select photos"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={!data || data.total === 0 || busyBatchDownload}
            loading={busyBatchDownload}
            onClick={handleDownloadAllPhotos}
            icon={<Download className="h-4 w-4" />}
          >
            {busyBatchDownload && downloadProgress
              ? `Downloading (${downloadProgress.done}/${downloadProgress.total})…`
              : `Download all (${data?.total ?? 0})`}
          </Button>
          {onGoUpload && (
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={onGoUpload}
              icon={<UploadCloud className="h-4 w-4" />}
            >
              Upload
            </Button>
          )}
        </div>
        {data && <p className="text-sm text-muted sm:ml-auto">{formatNumber(data.total)} photo{data.total === 1 ? "" : "s"}</p>}
      </div>

      {isSelecting && data && data.items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50/70 p-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-7 items-center rounded-full bg-brand-600 px-3 text-xs font-semibold text-white">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={selectAllOnPage}
              className="text-xs font-medium text-brand-700 underline hover:text-brand-800"
            >
              {data.items.every((p) => selectedIds.has(p.id)) ? "Deselect page" : "Select all on page"}
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-muted hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || busyBatchDownload}
              loading={busyBatchDownload}
              onClick={handleDownloadSelected}
              icon={<Download className="h-4 w-4" />}
            >
              Download selected ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size === 0 || busyBatchRetry}
              loading={busyBatchRetry}
              onClick={handleBatchRetry}
              icon={<RotateCcw className="h-4 w-4" />}
            >
              Retry selected ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={selectedIds.size === 0}
              onClick={() => setConfirmBatchDelete(true)}
              icon={<Trash2 className="h-4 w-4" />}
            >
              Delete selected ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsSelecting(false);
                setSelectedIds(new Set());
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {photos.error && !data ? (
        <Card><ErrorState error={photos.error} onRetry={photos.reload} /></Card>
      ) : !data ? (
        <GridSkeleton />
      ) : data.items.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState icon={<Search className="h-5 w-5" />} title="No photos match these filters" />
          ) : (
            <EmptyState icon={<ImageIcon className="h-5 w-5" />} title="No photos yet"
              description="Photos synced from the camera or watch folder will appear here automatically."
              action={onGoUpload ? <Button onClick={onGoUpload} icon={<UploadCloud className="h-4 w-4" />}>Upload photos</Button> : undefined} />
          )}
        </Card>
      ) : (
        <div className={cn("space-y-4 transition-opacity", photos.loading && "opacity-70")}>
          <PhotoGrid>
            {data.items.map((p, i) => (
              <PhotoTile
                key={p.id}
                src={p.thumbnail_url}
                alt={p.original_filename}
                selected={selectedIds.has(p.id)}
                onClick={() => {
                  if (isSelecting) {
                    toggleSelect(p.id);
                  } else {
                    setOpen(i);
                  }
                }}
                placeholder={<TilePlaceholder photo={p} />}
                overlay={
                  <TileOverlay
                    photo={p}
                    selected={selectedIds.has(p.id)}
                    isSelecting={isSelecting}
                    onToggleSelect={(e) => {
                      e.stopPropagation();
                      if (!isSelecting) setIsSelecting(true);
                      toggleSelect(p.id);
                    }}
                  />
                }
              />
            ))}
          </PhotoGrid>
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={(o) => { setOffset(o); window.scrollTo({ top: 0, behavior: "smooth" }); }} noun="photos" />
        </div>
      )}

      <ConfirmDialog
        open={confirmBatchDelete}
        onClose={() => setConfirmBatchDelete(false)}
        onConfirm={handleBatchDelete}
        loading={busyBatchDelete}
        danger
        title={`Permanently delete ${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"}?`}
        confirmLabel={`Delete ${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"}`}
        description="The original files, previews and face data for these photos will be permanently deleted. This action cannot be undone."
      />

      <Lightbox
        items={items}
        index={open}
        onIndexChange={setOpen}
        onClose={() => setOpen(null)}
        toolbar={(item) => {
          const currentPhoto = data?.items.find((p) => p.id === item.id);
          const dlUrl = currentPhoto?.preview_url ?? item.previewUrl ?? item.thumbnailUrl;
          if (!dlUrl) return null;
          return (
            <Button
              size="sm"
              variant="outline"
              className="border-white/20 bg-black/40 text-white hover:bg-black/60"
              onClick={() => {
                downloadImage(dlUrl, currentPhoto?.original_filename || item.alt || "photo.jpg", getSavedWatermarkConfig(eventId) || eventWatermark);
              }}
              icon={<Download className="h-4 w-4" />}
            >
              Download
            </Button>
          );
        }}
        imageOverlay={(item) => (faceBoxes?.id === item.id ? <FaceBoxes faces={faceBoxes.faces} /> : null)}
        side={(item) => {
          const currentPhoto = data?.items.find((p) => p.id === item.id);
          return (
            <PhotoDetailPanel key={item.id} eventId={eventId} photoId={item.id}
              initialPhoto={currentPhoto}
              onLoaded={(d) => setFaceBoxes({ id: d.id, faces: d.faces })}
              onDeleted={() => { setOpen(null); photos.reload(); onChanged(); }}
              onRetried={() => { photos.reload(); onChanged(); }} />
          );
        }}
      />
    </div>
  );
}

function TilePlaceholder({ photo }: { photo: PhotoOut }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 text-center">
      <ImageIcon className="h-6 w-6" aria-hidden />
      <span className="line-clamp-2 break-all text-[11px] text-zinc-500">{photo.original_filename}</span>
    </div>
  );
}

function TileOverlay({
  photo,
  selected,
  isSelecting,
  onToggleSelect,
}: {
  photo: PhotoOut;
  selected?: boolean;
  isSelecting?: boolean;
  onToggleSelect?: (e: React.MouseEvent) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggleSelect}
        aria-label={selected ? "Deselect photo" : "Select photo"}
        className={cn(
          "absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-all",
          selected
            ? "border-brand-600 bg-brand-600 text-white shadow-brand-600/30"
            : isSelecting
              ? "border-white/90 bg-black/45 text-transparent hover:border-white hover:bg-black/65"
              : "opacity-0 group-hover:opacity-100 border-white/80 bg-black/40 text-transparent hover:bg-black/60",
        )}
      >
        <Check className={cn("h-3.5 w-3.5 stroke-[3]", selected ? "opacity-100" : "opacity-0")} />
      </button>
      {photo.status !== "indexed" && (
        <span className="absolute left-2 top-2"><PhotoStatusBadge status={photo.status} /></span>
      )}
      {photo.status === "indexed" && photo.face_count > 0 && (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          <ScanFace className="h-3 w-3" aria-hidden />{photo.face_count}
        </span>
      )}
    </>
  );
}

function PhotoDetailPanel({ eventId, photoId, initialPhoto, onLoaded, onDeleted, onRetried }: {
  eventId: string;
  photoId: string;
  initialPhoto?: PhotoOut;
  onLoaded: (detail: PhotoDetailOut) => void;
  onDeleted: () => void;
  onRetried: () => void;
}) {
  const toast = useToast();
  const detail = useQuery(() => adminApi.getPhoto(eventId, photoId), [eventId, photoId]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"delete" | "retry" | null>(null);
  const detailData = detail.data;
  const p = detailData ?? initialPhoto;
  useEffect(() => {
    if (detailData) onLoaded(detailData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailData]);

  const retry = useCallback(async () => {
    setBusy("retry");
    try {
      await adminApi.retryPhoto(eventId, photoId);
      toast.success("Photo re-queued for processing");
      onRetried();
      void detail.reload();
    } catch (err) {
      toast.error("Could not retry", errorMessage(err));
    } finally {
      setBusy(null);
    }
  }, [eventId, photoId, toast, onRetried, detail]);

  async function remove() {
    setBusy("delete");
    try {
      await adminApi.deletePhoto(eventId, photoId);
      toast.success("Photo deleted");
      setConfirm(false);
      onDeleted();
    } catch (err) {
      toast.error("Could not delete photo", errorMessage(err));
      setBusy(null);
    }
  }

  if (!p) {
    if (detail.error) return <ErrorState compact error={detail.error} onRetry={detail.reload} className="m-4" />;
    return <div className="space-y-3 p-5"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /></div>;
  }

  const downloadUrl = detailData?.original_url || p.preview_url || p.thumbnail_url;

  return (
    <div className="space-y-5 p-5 text-sm">
      <div>
        <p className="break-all font-semibold text-ink">{p.original_filename}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <PhotoStatusBadge status={p.status} />
          {p.status === "indexed" && <Badge tone="brand"><ScanFace className="h-3 w-3" />{p.face_count} face{p.face_count === 1 ? "" : "s"}</Badge>}
        </div>
      </div>
      {Boolean(detail.error) && (
        <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>Server busy. Full face details will refresh automatically.</span>
          <button type="button" onClick={() => detail.reload()} className="font-semibold underline ml-2">Retry</button>
        </div>
      )}
      {p.error_message && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{p.error_message}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Meta label="Dimensions" value={p.width && p.height ? `${p.width} × ${p.height}` : "—"} />
        <Meta label="Size" value={formatBytes(p.size_bytes)} />
        <Meta label="Uploaded" value={formatDateTime(p.created_at)} />
        <Meta label="Processed" value={formatDateTime(p.processed_at) || "—"} />
        <Meta label="Source" value={p.source} />
        <Meta label="Attempts" value={String(p.attempts)} />
      </dl>
      {detailData && detailData.faces.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Detected faces</p>
          <ul className="space-y-1 text-xs">
            {detailData.faces.map((f) => (
              <li key={f.face_index} className="flex justify-between">
                <span>Face {f.face_index + 1}</span>
                <span className="tabular-nums text-muted">detector score {f.det_score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {detailData && detailData.jobs.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Processing history</p>
          <ol className="space-y-2 text-xs">
            {detailData.jobs.map((j) => (
              <li key={j.id} className="rounded-lg border border-line px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span className={cn("font-medium", j.status === "failed" ? "text-red-700" : j.status === "succeeded" ? "text-emerald-700" : "text-ink")}>
                    Attempt {j.attempt} · {j.status}
                  </span>
                  <span className="tabular-nums text-muted">{j.duration_ms != null ? `${(j.duration_ms / 1000).toFixed(1)}s` : ""}</span>
                </div>
                <p className="text-muted">{formatDateTime(j.started_at ?? j.created_at)}</p>
                {j.error_message && <p className="mt-1 text-red-700">{j.error_message}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {p.status !== "indexed" && (
          <Button size="sm" variant="outline" onClick={retry} loading={busy === "retry"} icon={<RotateCcw className="h-4 w-4" />}>Retry</Button>
        )}
        {downloadUrl && (
          <>
            <Button size="sm" variant="outline" onClick={() => downloadImage(downloadUrl, p.original_filename || "photo.jpg", getSavedWatermarkConfig(eventId))} icon={<Download className="h-4 w-4" />}>
              Download
            </Button>
            {detailData?.original_url && (
              <a href={detailData.original_url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex h-8 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium hover:bg-canvas">
                <ExternalLink className="h-4 w-4" />Original
              </a>
            )}
          </>
        )}
        <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirm(true)}
                icon={<Trash2 className="h-4 w-4" />}>Delete</Button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={remove} loading={busy === "delete"} danger
        title="Delete this photo?" confirmLabel="Delete photo"
        description="The original, its previews and any face data for this photo are permanently removed." />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-medium text-ink">{value}</dd>
    </div>
  );
}

/** Detected face rectangles drawn over the preview (bbox values are normalised 0..1). */
function FaceBoxes({ faces }: { faces: PhotoDetailOut["faces"] }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {faces.map((f) => {
        const [x1, y1, x2, y2] = f.bbox;
        return (
          <div key={f.face_index} className="absolute rounded-md border-2 border-brand-300 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
               style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}>
            <span className="absolute -top-5 left-0 rounded bg-brand-600 px-1 text-[10px] font-medium text-white">{f.face_index + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

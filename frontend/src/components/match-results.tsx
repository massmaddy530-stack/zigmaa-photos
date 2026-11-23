"use client";

import { Check, Download, ImageOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { DownloadError, downloadImage, downloadImagesInBatch, urlExtension, type WatermarkConfig } from "@/lib/image";
import { cn } from "@/lib/format";
import type { MatchItem, MatchPage, MatchResponse } from "@/lib/types";
import { Lightbox, PhotoGrid, PhotoTile, type GalleryItem } from "./gallery";
import { Button } from "./ui/button";
import { Alert, EmptyState } from "./ui/states";

export function MatchResults({ initial, loadPage, showSimilarity, emptyTitle, emptyDescription, downloadPrefix = "photo", onExpired, watermarkConfig }: {
  initial: MatchResponse;
  loadPage: (token: string, cursor: number) => Promise<MatchPage>;
  showSimilarity?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  downloadPrefix?: string;
  onExpired?: () => void;
  watermarkConfig?: WatermarkConfig;
}) {
  const [items, setItems] = useState<MatchItem[]>(initial.items);
  const [cursor, setCursor] = useState<number | null>(initial.next_cursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<DownloadError | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const toggleSelect = (photoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((m) => m.photo_id)));
    }
  };

  async function downloadBatch(targetItems: MatchItem[]) {
    if (targetItems.length === 0) return;
    setBatchDownloading(true);
    setBatchProgress({ done: 0, total: targetItems.length });
    const downloadList = targetItems
      .map((m) => {
        const url = m.download_url ?? m.preview_url;
        if (!url) return null;
        return {
          url,
          filename: `${downloadPrefix}-${m.photo_id.slice(0, 8)}${urlExtension(url, m.download_url ? ".jpg" : ".webp")}`,
        };
      })
      .filter((x): x is { url: string; filename: string } => x !== null);

    try {
      await downloadImagesInBatch(downloadList, watermarkConfig, (done, total) => {
        setBatchProgress({ done, total });
      });
    } catch (err) {
      setError(err);
    } finally {
      setBatchDownloading(false);
      setBatchProgress(null);
    }
  }

  async function downloadAllMatches() {
    setBatchDownloading(true);
    try {
      let allItems = [...items];
      let cur = cursor;
      while (cur !== null && initial.match_token) {
        setBatchProgress({ done: allItems.length, total: Math.max(initial.total, allItems.length) });
        const page = await loadPage(initial.match_token, cur);
        const seen = new Set(allItems.map((p) => p.photo_id));
        allItems = [...allItems, ...page.items.filter((p) => !seen.has(p.photo_id))];
        cur = page.next_cursor;
        if (!page.items.length) break;
      }
      await downloadBatch(allItems);
    } catch (err) {
      setError(err);
    } finally {
      setBatchDownloading(false);
    }
  }

  async function download(m: MatchItem) {
    const url = m.download_url ?? m.preview_url;
    if (!url) return;
    setDownloading(m.photo_id);
    setDownloadError(null);
    try {
      await downloadImage(url, `${downloadPrefix}-${m.photo_id.slice(0, 8)}${urlExtension(url, m.download_url ? ".jpg" : ".webp")}`, watermarkConfig);
    } catch (err) {
      setDownloadError(err instanceof DownloadError ? err : new DownloadError("Download failed. Please try again."));
    } finally {
      setDownloading(null);
    }
  }

  async function more() {
    if (cursor === null || !initial.match_token) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadPage(initial.match_token, cursor);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.photo_id));
        return [...prev, ...page.items.filter((p) => !seen.has(p.photo_id))];
      });
      setCursor(page.next_cursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  if (initial.total === 0) {
    return <EmptyState icon={<ImageOff className="h-5 w-5" />} title={emptyTitle} description={emptyDescription} />;
  }

  const gallery: GalleryItem[] = items.map((m, i) => ({
    id: m.photo_id, thumbnailUrl: m.thumbnail_url, previewUrl: m.preview_url, alt: `Photo ${i + 1}`,
  }));
  const expired = error instanceof ApiError && error.code === "match_expired";
  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <div className="space-y-4">
      {/* Action / Selection Bar */}
      <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/95 p-3.5 shadow-md backdrop-blur-md sm:px-4">
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink select-none">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={selectAll}
              className="h-4 w-4 rounded border-zinc-300 text-brand-600 accent-brand-600 focus:ring-brand-500"
            />
            <span>{allSelected ? "Deselect all" : "Select all"}</span>
          </label>
          {selectedIds.size > 0 && (
            <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-medium text-brand-800">
              {selectedIds.size} of {items.length} selected
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              onClick={() => void downloadBatch(items.filter((m) => selectedIds.has(m.photo_id)))}
              disabled={batchDownloading}
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `Downloading (${batchProgress.done}/${batchProgress.total})…`
                : `Download selected (${selectedIds.size})`}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void downloadAllMatches()}
            disabled={batchDownloading}
            icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          >
            {batchDownloading && batchProgress
              ? `Downloading (${batchProgress.done}/${batchProgress.total})…`
              : `Download all (${initial.total || items.length})`}
          </Button>
        </div>
      </div>

      <PhotoGrid>
        {items.map((m, i) => {
          const isSelected = selectedIds.has(m.photo_id);
          return (
            <PhotoTile
              key={m.photo_id}
              src={m.thumbnail_url}
              alt={`Open photo ${i + 1}`}
              selected={isSelected}
              onClick={() => setOpen(i)}
              overlay={
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(m.photo_id);
                    }}
                    aria-label={isSelected ? "Deselect photo" : "Select photo"}
                    className={cn(
                      "absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-all",
                      isSelected
                        ? "border-brand-600 bg-brand-600 text-white shadow-brand-600/30"
                        : "border-white/80 bg-black/40 text-transparent hover:border-white hover:bg-black/60",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 stroke-[3]", isSelected ? "opacity-100" : "opacity-0")} />
                  </button>

                  {showSimilarity && (
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur">
                      {(m.similarity * 100).toFixed(0)}% similar
                    </span>
                  )}
                </>
              }
            />
          );
        })}
      </PhotoGrid>

      {error ? (
        <Alert tone={expired ? "warning" : "error"} title={expired ? "These results have expired" : "Couldn't load more photos"}>
          {expired ? (
            <>For your privacy, results are only kept for a short time.{" "}
              {onExpired && <button className="font-semibold underline" onClick={onExpired}>Search again</button>}</>
          ) : errorMessage(error)}
        </Alert>
      ) : null}

      {cursor !== null && !expired && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={more} loading={loading}>
            {loading ? "Loading…" : `Show more (${initial.total - items.length} left)`}
          </Button>
        </div>
      )}

      {/* Floating Bottom Bar for Mobile */}
      {items.length > 0 && (
        <div className="fixed bottom-4 left-3 right-3 z-50 flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur-lg dark:border-zinc-700 dark:bg-zinc-900/95 sm:hidden">
          <div className="flex items-center gap-2 min-w-0">
            {selectedIds.size > 0 ? (
              <>
                <span className="inline-flex h-6 items-center justify-center rounded-full bg-brand-600 px-2.5 text-xs font-bold text-white shadow-sm">
                  {selectedIds.size}
                </span>
                <span className="truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                  Selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs font-semibold text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-200 ml-1"
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                {initial.total || items.length} matches
              </span>
            )}
          </div>
          {selectedIds.size > 0 ? (
            <Button
              size="sm"
              onClick={() => void downloadBatch(items.filter((m) => selectedIds.has(m.photo_id)))}
              disabled={batchDownloading}
              className="bg-brand-600 text-white font-bold shadow-md active:scale-95 transition-transform"
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `${batchProgress.done}/${batchProgress.total}…`
                : `Download (${selectedIds.size})`}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void downloadAllMatches()}
              disabled={batchDownloading}
              className="bg-brand-600 text-white font-bold shadow-md active:scale-95 transition-transform"
              icon={batchDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            >
              {batchDownloading && batchProgress
                ? `${batchProgress.done}/${batchProgress.total}…`
                : `Download all (${initial.total || items.length})`}
            </Button>
          )}
        </div>
      )}

      <Lightbox items={gallery} index={open} onIndexChange={(i) => { setDownloadError(null); setOpen(i); }}
        onClose={() => { setDownloadError(null); setOpen(null); }}
        toolbar={(item) => {
          const m = items.find((x) => x.photo_id === item.id);
          if (!m || !(m.download_url ?? m.preview_url)) return null;
          const busy = downloading === m.photo_id;
          return (
            <div className="flex flex-col items-end gap-1">
              <button onClick={() => void download(m)} disabled={busy}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-medium text-white hover:bg-white/25 disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {busy ? "Downloading…" : downloadError ? "Retry download" : "Download"}
              </button>
              {downloadError && (
                <p role="alert" className="max-w-64 text-right text-xs text-amber-200">
                  {downloadError.message}
                  {downloadError.expired && onExpired && <> <button className="underline" onClick={onExpired}>New search</button></>}
                </p>
              )}
            </div>
          );
        }} />
    </div>
  );
}

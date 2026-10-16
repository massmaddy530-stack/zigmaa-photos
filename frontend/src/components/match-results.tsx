"use client";

import { Download, ImageOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { DownloadError, downloadImage, urlExtension } from "@/lib/image";
import type { MatchItem, MatchPage, MatchResponse } from "@/lib/types";
import { Lightbox, PhotoGrid, PhotoTile, type GalleryItem } from "./gallery";
import { Button } from "./ui/button";
import { Alert, EmptyState } from "./ui/states";

export function MatchResults({ initial, loadPage, showSimilarity, emptyTitle, emptyDescription, downloadPrefix = "photo", onExpired }: {
  initial: MatchResponse;
  loadPage: (token: string, cursor: number) => Promise<MatchPage>;
  showSimilarity?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  downloadPrefix?: string;
  onExpired?: () => void;
}) {
  const [items, setItems] = useState<MatchItem[]>(initial.items);
  const [cursor, setCursor] = useState<number | null>(initial.next_cursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<DownloadError | null>(null);

  async function download(m: MatchItem) {
    // Prefer the original (full quality); older API responses only had the preview.
    const url = m.download_url ?? m.preview_url;
    if (!url) return;
    setDownloading(m.photo_id);
    setDownloadError(null);
    try {
      await downloadImage(url, `${downloadPrefix}-${m.photo_id.slice(0, 8)}${urlExtension(url, m.download_url ? ".jpg" : ".webp")}`);
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

  return (
    <div className="space-y-5">
      <PhotoGrid>
        {items.map((m, i) => (
          <PhotoTile key={m.photo_id} src={m.thumbnail_url} alt={`Open photo ${i + 1}`} onClick={() => setOpen(i)}
            overlay={showSimilarity ? (
              <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur">
                {(m.similarity * 100).toFixed(0)}% similar
              </span>
            ) : undefined} />
        ))}
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

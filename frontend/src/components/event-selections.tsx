"use client";

import JSZip from "jszip";
import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FolderDown,
  Heart,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, Input, Skeleton } from "@/components/ui/primitives";
import { Alert, EmptyState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { adminApi, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";
import type { ClientSelectionOut } from "@/lib/types";

async function fetchPhotoBlob(url: string): Promise<Blob> {
  const isCrossOrigin =
    url.includes("r2.dev") ||
    url.includes("amazonaws.com") ||
    url.includes("cloudflarestorage.com") ||
    (typeof window !== "undefined" && !url.startsWith(window.location.origin) && !url.startsWith("/"));

  const target = isCrossOrigin ? `/api/download?url=${encodeURIComponent(url)}` : url;
  const res = await fetch(target);
  if (!res.ok) {
    throw new Error(`Failed to fetch photo (${res.status})`);
  }
  return await res.blob();
}

export function EventSelections({ eventId, eventName }: { eventId: string; eventName: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useQuery(() => adminApi.listSelections(eventId), [eventId]);

  const [copiedLink, setCopiedLink] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number } | null>(null);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState error={error} onRetry={reload} />;
  }

  if (!data) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "https://zigmaamoments.com";
  const fullUrl = `${origin}${data.selection_url_path}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedLink(true);
      toast.success("Client selection link copied");
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error("Could not copy link");
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await adminApi.regenerateSelectionLink(eventId);
      await reload();
      toast.success("Selection link regenerated", "Previous link is now disabled.");
    } catch (err) {
      toast.error("Failed to regenerate link", errorMessage(err));
    } finally {
      setRegenerating(false);
    }
  };

  const handleDownloadFolder = async (sel: ClientSelectionOut) => {
    if (sel.photos.length === 0) return;
    setDownloadingId(sel.id);
    setDlProgress({ done: 0, total: sel.photos.length });

    try {
      const zip = new JSZip();
      const safeEvent = eventName.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "event";
      const safeClient = sel.client_name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "client";
      const folderName = `${safeEvent}-${safeClient}-selected`;
      const folder = zip.folder(folderName) ?? zip;

      const usedNames = new Map<string, number>();
      let added = 0;

      for (let i = 0; i < sel.photos.length; i++) {
        const p = sel.photos[i];
        const url = p.download_url || p.preview_url || p.thumbnail_url || "";
        setDlProgress({ done: i + 1, total: sel.photos.length });
        if (!url) continue;

        try {
          const blob = await fetchPhotoBlob(url);
          let filename = p.original_filename || `photo-${p.photo_id.slice(0, 8)}.jpg`;
          const count = usedNames.get(filename) ?? 0;
          usedNames.set(filename, count + 1);
          if (count > 0) {
            const dot = filename.lastIndexOf(".");
            filename = dot > 0
              ? `${filename.slice(0, dot)}_${count}${filename.slice(dot)}`
              : `${filename}_${count}`;
          }
          folder.file(filename, blob);
          added++;
        } catch {
          // Continue packing remaining photos if one fails
        }
      }

      if (added === 0) {
        throw new Error("Could not download any of the selected photos.");
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${folderName}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);

      toast.success(`Downloaded folder (${added} photo${added === 1 ? "" : "s"})`);
    } catch (err) {
      toast.error("Folder download failed", errorMessage(err));
    } finally {
      setDownloadingId(null);
      setDlProgress(null);
    }
  };

  const handleDelete = async (sel: ClientSelectionOut) => {
    setDeletingId(sel.id);
    try {
      await adminApi.deleteSelection(eventId, sel.id);
      await reload();
      toast.success("Selection removed");
    } catch (err) {
      toast.error("Could not delete selection", errorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Private Client Selection Link Card */}
      <Card>
        <CardHeader
          title="Private Client Selection Link"
          description="Send this private link to your bride/groom/customer so only they can shortlist photos for their album."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              loading={regenerating}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Reset Link
            </Button>
          }
        />
        <div className="space-y-3 p-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={fullUrl} readOnly className="font-mono text-xs" />
            <div className="flex shrink-0 gap-2">
              <Button
                variant="primary"
                onClick={copyLink}
                icon={copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              >
                {copiedLink ? "Copied" : "Copy Link"}
              </Button>
              <a
                href={data.selection_url_path}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:bg-canvas"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            </div>
          </div>
          <Alert tone="info">
            <span className="text-xs">
              Regular guests on the public event link cannot see or modify this selection page.
            </span>
          </Alert>
        </div>
      </Card>

      {/* Submitted Client Selections */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">
            Submitted Selections ({data.selections.length})
          </h3>
        </div>

        {data.selections.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Heart className="h-6 w-6 text-rose-500" />}
              title="No client selections yet"
              description="Copy the private selection link above and send it to your client. Their shortlisted photos will appear right here."
            />
          </Card>
        ) : (
          data.selections.map((sel) => {
            const isDownloading = downloadingId === sel.id;
            return (
              <Card key={sel.id}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span>{sel.client_name}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                        <Heart className="h-3 w-3 fill-current" />
                        {sel.photo_count} photo{sel.photo_count === 1 ? "" : "s"}
                      </span>
                    </span>
                  }
                  description={`Updated ${formatDate(sel.updated_at)}`}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => void handleDownloadFolder(sel)}
                        disabled={isDownloading || sel.photos.length === 0}
                        icon={
                          isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FolderDown className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        {isDownloading && dlProgress
                          ? `Packing (${dlProgress.done}/${dlProgress.total})…`
                          : `Download Folder (${sel.photo_count})`}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleDelete(sel)}
                        loading={deletingId === sel.id}
                        aria-label="Delete selection"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                      </Button>
                    </div>
                  }
                />
                <div className="space-y-4 p-5">
                  {sel.note && (
                    <div className="rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-xs text-ink">
                      <span className="font-semibold text-muted">Client Note:</span> {sel.note}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                    {sel.photos.map((p) => (
                      <div
                        key={p.photo_id}
                        className="overflow-hidden rounded-xl border border-line bg-canvas"
                      >
                        <div className="aspect-square overflow-hidden">
                          <img
                            src={p.thumbnail_url || p.preview_url || ""}
                            alt={p.original_filename}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="truncate px-1.5 py-1 text-[10px] text-muted" title={p.original_filename}>
                          {p.original_filename}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

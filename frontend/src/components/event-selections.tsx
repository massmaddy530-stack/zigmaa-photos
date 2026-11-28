"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
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
import { downloadImagesInBatch, fetchEventWatermarkConfig, getSavedWatermarkConfig } from "@/lib/image";
import type { ClientSelectionOut } from "@/lib/types";

export function EventSelections({ eventId, eventName }: { eventId: string; eventName: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useQuery(() => adminApi.listSelections(eventId), [eventId]);

  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedNamesId, setCopiedNamesId] = useState<string | null>(null);
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

  const handleCopyFilenames = async (sel: ClientSelectionOut) => {
    const names = sel.photos.map((p) => p.original_filename).join(", ");
    try {
      await navigator.clipboard.writeText(names);
      setCopiedNamesId(sel.id);
      toast.success("Filenames copied", "Paste into Lightroom Classic or Windows Search to filter.");
      setTimeout(() => setCopiedNamesId(null), 2000);
    } catch {
      toast.error("Could not copy filenames");
    }
  };

  const handleDownloadTxt = (sel: ClientSelectionOut) => {
    const content = [
      `Event: ${eventName}`,
      `Client: ${sel.client_name}`,
      `Selected: ${sel.photo_count} photos`,
      sel.note ? `Note: ${sel.note}` : "",
      "",
      ...sel.photos.map((p) => p.original_filename),
    ]
      .filter(Boolean)
      .join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sel.client_name.replace(/[^\w-]+/g, "_")}-selected-photos.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleDownloadSelected = async (sel: ClientSelectionOut) => {
    setDownloadingId(sel.id);
    setDlProgress({ done: 0, total: sel.photos.length });
    try {
      let wmConfig = getSavedWatermarkConfig(eventId);
      if (!wmConfig) wmConfig = await fetchEventWatermarkConfig(eventId);
      const targets = sel.photos
        .map((p) => ({
          url: p.download_url || p.preview_url || p.thumbnail_url || "",
          filename: p.original_filename,
        }))
        .filter((x) => Boolean(x.url));
      await downloadImagesInBatch(targets, wmConfig ?? undefined, (done, total) => {
        setDlProgress({ done, total });
      });
      toast.success(`Downloaded ${targets.length} selected photo${targets.length === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error("Download failed", errorMessage(err));
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
                        variant="outline"
                        onClick={() => handleCopyFilenames(sel)}
                        icon={
                          copiedNamesId === sel.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        {copiedNamesId === sel.id ? "Copied Names" : "Copy Filenames"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadTxt(sel)}
                        icon={<FileText className="h-3.5 w-3.5" />}
                      >
                        Export .TXT
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleDownloadSelected(sel)}
                        disabled={isDownloading || sel.photos.length === 0}
                        icon={
                          isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        {isDownloading && dlProgress
                          ? `Downloading (${dlProgress.done}/${dlProgress.total})…`
                          : `Download (${sel.photo_count})`}
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

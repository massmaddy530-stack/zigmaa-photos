"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ImageIcon, MapPin, MoreVertical, ScanFace, Settings, Trash2 } from "lucide-react";
import { cn, formatDate, formatNumber } from "@/lib/format";
import type { EventOut } from "@/lib/types";
import { adminApi, errorMessage } from "@/lib/api";
import { Card, ProgressBar, Skeleton } from "./ui/primitives";
import { ConfirmDialog } from "./ui/modal";
import { useToast } from "./ui/toast";

export function processingSummary(e: EventOut) {
  const c = e.counts;
  const inFlight = c.pending + c.processing;
  const done = c.indexed + c.failed;
  return { inFlight, progress: c.total ? done / c.total : 1, failed: c.failed };
}

export function CoverImage({ src, name, className }: { src: string | null; name: string; className?: string }) {
  return src ? (
    <div className={cn("relative h-full w-full overflow-hidden bg-zinc-900/5", className)}>
      <img src={src} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-xl" aria-hidden loading="lazy" />
      <img src={src} alt="" className="relative z-10 h-full w-full object-contain" loading="lazy" />
    </div>
  ) : (
    <div className={cn("grid h-full w-full place-items-center bg-gradient-to-br from-brand-100 via-brand-50 to-white", className)}>
      <span className="font-display text-4xl font-medium text-brand-400" aria-hidden>{name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}

/**
 * `compact` (dashboard overview only): from 1180px wide the cover is a short banner and the photo counts
 * share a row with the processing status. Same content; smaller screens keep the regular card.
 */
export function EventCard({
  event,
  compact,
  onDeleted,
}: {
  event: EventOut;
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const { inFlight, progress, failed } = processingSummary(event);
  const router = useRouter();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <>
      <div className="relative group/card">
        <Link href={`/dashboard/events/${event.id}`} className="group block focus-visible:outline-none">
          <Card className="overflow-hidden transition-[box-shadow,border-color] group-hover:border-brand-200 group-hover:shadow-[var(--shadow-pop)] group-focus-visible:ring-2 group-focus-visible:ring-brand-500">
            <div className={cn("relative aspect-[16/9] overflow-hidden bg-canvas", compact && "min-[1180px]:aspect-[3/1]")}>
              <CoverImage src={event.cover_url} name={event.name} />
            </div>
            <div className={cn("space-y-3 p-4",
              compact && "min-[1180px]:grid min-[1180px]:grid-cols-[auto_minmax(0,1fr)] min-[1180px]:items-center min-[1180px]:gap-x-3 min-[1180px]:gap-y-1.5 min-[1180px]:space-y-0 min-[1180px]:px-3 min-[1180px]:py-2.5")}>
              <div className={compact ? "min-[1180px]:col-span-2" : undefined}>
                <h3 className={cn("truncate font-display text-lg font-medium text-ink", compact && "min-[1180px]:text-base")}>{event.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {event.event_date && (
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{formatDate(event.event_date)}</span>
                  )}
                  {event.venue && (
                    <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{event.venue}</span></span>
                  )}
                </div>
              </div>
              <div className={cn("flex items-center gap-4 text-sm", compact && "min-[1180px]:gap-3")}>
                <span className="inline-flex items-center gap-1.5 text-ink"><ImageIcon className="h-4 w-4 text-muted" aria-hidden />{formatNumber(event.counts.total)}</span>
                <span className="inline-flex items-center gap-1.5 text-ink"><ScanFace className="h-4 w-4 text-muted" aria-hidden />{formatNumber(event.counts.faces)}</span>
                {failed > 0 && <span className="text-xs font-medium text-red-600">{failed} failed</span>}
              </div>
              {inFlight > 0 ? (
                <div className={cn("space-y-1.5", compact && "min-[1180px]:space-y-1")}>
                  <ProgressBar value={progress} label="Processing progress" />
                  <p className="text-xs text-muted">Processing {formatNumber(inFlight)} photo{inFlight === 1 ? "" : "s"}…</p>
                </div>
              ) : (
                <p className={cn("text-xs text-muted", compact && "min-[1180px]:text-right min-[1180px]:text-[11px]")}>{event.counts.total ? "All photos processed" : "No photos yet"}</p>
              )}
            </div>
          </Card>
        </Link>

        {/* 3-dots More Options in Top Right */}
        <div className="absolute top-2.5 right-2.5 z-20" ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink shadow-sm backdrop-blur-xs transition-colors hover:bg-white hover:text-brand-700 focus:outline-none cursor-pointer"
            aria-label="More options"
            title="More options"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-9 z-30 min-w-[150px] rounded-xl border border-line bg-surface p-1 shadow-lg"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  router.push(`/dashboard/events/${event.id}?tab=settings`);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-canvas cursor-pointer"
              >
                <Settings className="h-3.5 w-3.5 text-muted" />
                <span>Update / Settings</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete event</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          try {
            setBusyDelete(true);
            await adminApi.deleteEvent(event.id);
            toast.success("Event deleted", `"${event.name}" was successfully deleted.`);
            setConfirmDelete(false);
            onDeleted?.();
          } catch (err) {
            toast.error("Could not delete event", errorMessage(err));
          } finally {
            setBusyDelete(false);
          }
        }}
        title={`Delete "${event.name}"?`}
        description="This will permanently delete this event, all uploaded photos, indexed faces, and guest links. This action cannot be undone."
        confirmLabel="Delete event"
        danger
        loading={busyDelete}
      />
    </>
  );
}

export function EventCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <Skeleton className={cn("aspect-[16/9] rounded-none", compact && "min-[1180px]:aspect-[3/1]")} />
      <div className={cn("space-y-3 p-4", compact && "min-[1180px]:space-y-2 min-[1180px]:px-3 min-[1180px]:py-2.5")}>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2 w-full" />
      </div>
    </Card>
  );
}

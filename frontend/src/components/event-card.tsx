import Link from "next/link";
import { CalendarDays, ImageIcon, MapPin, ScanFace } from "lucide-react";
import { cn, formatDate, formatNumber } from "@/lib/format";
import type { EventOut } from "@/lib/types";
import { EventStatusBadge } from "./status-badges";
import { Card, ProgressBar, Skeleton } from "./ui/primitives";

export function processingSummary(e: EventOut) {
  const c = e.counts;
  const inFlight = c.pending + c.processing;
  const done = c.indexed + c.failed;
  return { inFlight, progress: c.total ? done / c.total : 1, failed: c.failed };
}

export function CoverImage({ src, name, className }: { src: string | null; name: string; className?: string }) {
  return src ? (
    <img src={src} alt="" className={cn("h-full w-full object-cover", className)} loading="lazy" />
  ) : (
    <div className={cn("grid h-full w-full place-items-center bg-gradient-to-br from-brand-100 via-brand-50 to-white", className)}>
      <span className="text-3xl font-semibold text-brand-300" aria-hidden>{name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}

export function EventCard({ event }: { event: EventOut }) {
  const { inFlight, progress, failed } = processingSummary(event);
  return (
    <Link href={`/dashboard/events/${event.id}`} className="group block focus-visible:outline-none">
      <Card className="overflow-hidden transition-shadow group-hover:shadow-[var(--shadow-pop)] group-focus-visible:ring-2 group-focus-visible:ring-brand-500">
        <div className="relative aspect-[16/9] overflow-hidden bg-canvas">
          <CoverImage src={event.cover_url} name={event.name}
                      className="transition-transform duration-500 group-hover:scale-[1.03]" />
          <div className="absolute left-3 top-3"><EventStatusBadge status={event.status} /></div>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <h3 className="truncate font-semibold text-ink">{event.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {event.event_date && (
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{formatDate(event.event_date)}</span>
              )}
              {event.venue && (
                <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{event.venue}</span></span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink"><ImageIcon className="h-4 w-4 text-muted" aria-hidden />{formatNumber(event.counts.total)}</span>
            <span className="inline-flex items-center gap-1.5 text-ink"><ScanFace className="h-4 w-4 text-muted" aria-hidden />{formatNumber(event.counts.faces)}</span>
            {failed > 0 && <span className="text-xs font-medium text-red-600">{failed} failed</span>}
          </div>
          {inFlight > 0 ? (
            <div className="space-y-1.5">
              <ProgressBar value={progress} label="Processing progress" />
              <p className="text-xs text-muted">Processing {formatNumber(inFlight)} photo{inFlight === 1 ? "" : "s"}…</p>
            </div>
          ) : (
            <p className="text-xs text-muted">{event.counts.total ? "All photos processed" : "No photos yet"}</p>
          )}
        </div>
      </Card>
    </Link>
  );
}

export function EventCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[16/9] rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2 w-full" />
      </div>
    </Card>
  );
}

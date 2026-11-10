"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Camera, ChevronLeft, ExternalLink, Images, MapPin, Settings, Share2 } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { EventPhotos } from "@/components/event-photos";
import { EventSettings } from "@/components/event-settings";
import { EventShare } from "@/components/event-share";
import { ProcessingPanel } from "@/components/processing-panel";
import { EventStatusBadge } from "@/components/status-badges";
import { Card, Skeleton } from "@/components/ui/primitives";
import { ErrorState, EmptyState } from "@/components/ui/states";
import { adminApi, ApiError } from "@/lib/api";
import { cn, formatDate } from "@/lib/format";
import { useQuery } from "@/lib/hooks";

const TABS = [
  { id: "photos", label: "Photos", icon: Images },
  { id: "share", label: "Share", icon: Share2 },
  { id: "settings", label: "Settings", icon: Settings },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function EventDetailPage() {
  return (
    <Suspense fallback={<HeaderSkeleton />}>
      <EventDetailInner />
    </Suspense>
  );
}

function HeaderSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

function EventDetailInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "photos";

  const event = useQuery(() => adminApi.getEvent(id), [id]);
  // Poll every 3 s while photos are queued/processing; slowly otherwise (e.g. to catch camera-agent uploads).
  const [fastPoll, setFastPoll] = useState(true);
  const status = useQuery(() => adminApi.eventStatus(id), [id], { pollMs: fastPoll ? 3000 : 15000 });
  const processing = status.data ? !status.data.is_complete : false;
  useEffect(() => setFastPoll(processing), [processing]);
  const c = status.data?.counts;
  const refreshKey = c ? `${c.total}-${c.indexed}-${c.failed}-${c.processing}` : "";

  const setTab = useCallback((t: TabId) => {
    const sp = new URLSearchParams(params.toString());
    if (t === "photos") sp.delete("tab"); else sp.set("tab", t);
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }, [params, pathname, router]);

  const refreshAll = useCallback(() => {
    void status.reload();
    void event.reload();
  }, [status, event]);

  if (event.error && !event.data) {
    const notFound = event.error instanceof ApiError && event.error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Event not found"
            description="It may have been deleted." action={<Link className="text-sm font-medium text-brand-700" href="/dashboard/events">Back to events</Link>} />
        ) : <ErrorState error={event.error} onRetry={event.reload} />}
      </Card>
    );
  }
  if (!event.data) return <HeaderSkeleton />;
  const ev = event.data;

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/dashboard" className="inline-flex items-center gap-1 hover:text-ink"><ChevronLeft className="h-4 w-4" />Dashboard</Link>}
        title={<span className="flex flex-wrap items-center gap-3"><span className="min-w-0 break-words">{ev.name}</span><EventStatusBadge status={ev.status} /></span>}
        description={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {ev.event_date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(ev.event_date, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</span>}
            {ev.venue && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{ev.venue}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/events/${id}/capture`}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium shadow-sm hover:bg-canvas">
              <Camera className="h-4 w-4" />Camera
            </Link>
            <a href={ev.public_url} target="_blank" rel="noopener noreferrer"
               className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium shadow-sm hover:bg-canvas">
              <ExternalLink className="h-4 w-4" />Guest page
            </a>
          </div>
        }
      />

      <div className="mb-6">
        <ProcessingPanel eventId={id} status={status.data} error={status.error} onReload={status.reload} onChanged={refreshAll} />
      </div>

      <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Event sections" className="inline-flex min-w-full gap-1 border-b border-line sm:min-w-0">
          {TABS.map(({ id: t, label, icon: Icon }) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn("-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink")}>
              <Icon className="h-4 w-4" aria-hidden />{label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {tab === "photos" && (
          <EventPhotos eventId={id} refreshKey={refreshKey} pollWhileProcessing={false}
                       onChanged={refreshAll} />
        )}
        {tab === "share" && <EventShare event={ev} onChanged={(e) => event.setData(e)} />}
        {tab === "settings" && <EventSettings event={ev} onSaved={(e) => { event.setData(e); void status.reload(); }} />}
      </div>
      {processing && <span className="sr-only" aria-live="polite">Photos are being processed</span>}
    </>
  );
}

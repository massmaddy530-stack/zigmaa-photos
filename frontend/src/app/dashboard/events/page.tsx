"use client";

import { CalendarDays, Plus, Search, X } from "lucide-react";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { EventCard, EventCardSkeleton } from "@/components/event-card";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Card, Input } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/format";
import { useDebounced, useQuery } from "@/lib/hooks";
import type { EventStatus } from "@/lib/types";

const LIMIT = 12;
const FILTERS: { value: EventStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Live" },
  { value: "archived", label: "Archived" },
];

function EventsList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<EventStatus | "">("");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q.trim(), 300);
  const events = useQuery(() => adminApi.listEvents({ q: dq, status, limit: LIMIT, offset }), [dq, status, offset]);
  const data = events.data;
  const filtered = Boolean(dq || status);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input type="search" placeholder="Search by name or venue" value={q} aria-label="Search events"
                 onChange={(e) => { setQ(e.target.value); setOffset(0); }} className="pl-10" />
        </div>
        <div className="inline-flex rounded-xl border border-line bg-surface p-1 shadow-sm" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.label} role="tab" aria-selected={status === f.value}
                    onClick={() => { setStatus(f.value); setOffset(0); }}
                    className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      status === f.value ? "bg-brand-600 text-white shadow-sm" : "text-muted hover:text-ink")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {events.error && !data ? (
        <Card><ErrorState error={events.error} onRetry={events.reload} /></Card>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <EventCardSkeleton key={i} />)}
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState icon={<Search className="h-5 w-5" />} title="No matching events"
              description="Try a different search or filter."
              action={<button onClick={() => { setQ(""); setStatus(""); }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700"><X className="h-4 w-4" />Clear filters</button>} />
          ) : (
            <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Create your first event"
              description="Events hold your photos and give guests a private link and QR code to find themselves."
              action={<ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>New event</ButtonLink>} />
          )}
        </Card>
      ) : (
        <div className={cn("space-y-5 transition-opacity", events.loading && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((e) => <EventCard key={e.id} event={e} />)}
          </div>
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} noun="events" />
        </div>
      )}
    </>
  );
}

export default function EventsPage() {
  return (
    <>
      <PageHeader
        title="Events"
        description="Manage events, uploads and guest sharing."
        actions={<ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>New event</ButtonLink>}
      />
      <Suspense>
        <EventsList />
      </Suspense>
    </>
  );
}

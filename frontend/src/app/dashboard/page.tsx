"use client";

import {
  AlertTriangle,
  CalendarDays,
  Clock,
  ImageIcon,
  Plus,
  ScanFace,
  Search,
  X,
} from "lucide-react";
import { Suspense, useState } from "react";
import { EventCard, EventCardSkeleton } from "@/components/event-card";
import { StatCard } from "@/components/stat-card";
import { ButtonLink } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Card, Input } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi } from "@/lib/api";
import { cn, formatNumber } from "@/lib/format";
import { useDebounced, useQuery } from "@/lib/hooks";

const LIMIT = 12;

export default function DashboardPage() {
  const overview = useQuery(() => adminApi.overview(), [], { pollMs: 10_000 });
  const o = overview.data;
  const loading = overview.loading && !o;

  return (
    <div className="space-y-8">
      {/* Overview Stat Cards */}
      <section aria-label="Studio Overview">
        <div className="mb-4">
          <h1 className="font-display text-2xl font-medium leading-tight text-ink sm:text-3xl">
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted">
            Live statistics and event management at a glance.
          </p>
        </div>

        {overview.error && !o ? (
          <Card>
            <ErrorState error={overview.error} onRetry={overview.reload} />
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label="Events"
              loading={loading}
              icon={<CalendarDays className="h-[18px] w-[18px]" />}
              value={o ? formatNumber(o.events) : "—"}
            />
            <StatCard
              label="Photos"
              loading={loading}
              tone="blue"
              icon={<ImageIcon className="h-[18px] w-[18px]" />}
              value={o ? formatNumber(o.photos) : "—"}
            />
            <StatCard
              label="Indexed faces"
              loading={loading}
              tone="green"
              icon={<ScanFace className="h-[18px] w-[18px]" />}
              value={o ? formatNumber(o.indexed_faces) : "—"}
              hint="Searchable by guests"
            />
            <StatCard
              label="Failures"
              loading={loading}
              tone={o?.failures ? "red" : "amber"}
              icon={
                o?.failures ? (
                  <AlertTriangle className="h-[18px] w-[18px]" />
                ) : (
                  <Clock className="h-[18px] w-[18px]" />
                )
              }
              value={o ? formatNumber(o.failures) : "—"}
              hint={
                o
                  ? o.processing
                    ? `${formatNumber(o.processing)} in queue`
                    : "Queue is empty"
                  : undefined
              }
            />
          </div>
        )}
      </section>

      {/* Events Section (Search, Grid, Pagination) */}
      <section aria-label="Events List" className="border-t border-line pt-6">
        <Suspense>
          <EventsList />
        </Suspense>
      </section>
    </div>
  );
}

function EventsList() {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q.trim(), 300);
  const events = useQuery(
    () => adminApi.listEvents({ q: dq, limit: LIMIT, offset }),
    [dq, offset]
  );
  const data = events.data;
  const filtered = Boolean(dq);

  return (
    <>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-medium text-ink sm:text-2xl">
            Events
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Manage your photoshoot events, guest links, and photos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>
            New event
          </ButtonLink>
        </div>
      </div>

      <div className="mb-5">
        <div className="relative w-full max-w-sm">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            type="search"
            placeholder="Search by name or venue"
            value={q}
            aria-label="Search events"
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            className="pl-10"
          />
        </div>
      </div>

      {events.error && !data ? (
        <Card>
          <ErrorState error={events.error} onRetry={events.reload} />
        </Card>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <EventCardSkeleton key={i} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="No matching events"
              description="Try a different search query."
              action={
                <button
                  onClick={() => {
                    setQ("");
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-700"
                >
                  <X className="h-4 w-4" />
                  Clear search
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={<CalendarDays className="h-5 w-5" />}
              title="Create your first event"
              description="Events hold your photos and give guests a private link and QR code to find themselves."
              action={
                <ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>
                  New event
                </ButtonLink>
              }
            />
          )}
        </Card>
      ) : (
        <div className={cn("space-y-5 transition-opacity", events.loading && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
          <Pagination
            total={data.total}
            limit={LIMIT}
            offset={offset}
            onChange={setOffset}
            noun="events"
          />
        </div>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  ImageIcon,
  Plus,
  ScanFace,
  Server,
} from "lucide-react";
import { EventCard, EventCardSkeleton } from "@/components/event-card";
import { StatCard } from "@/components/stat-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader, ProgressBar, Skeleton } from "@/components/ui/primitives";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi, fetchHealth } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useQuery, type QueryState } from "@/lib/hooks";
import type { HealthOut } from "@/lib/types";

export default function DashboardPage() {
  const overview = useQuery(() => adminApi.overview(), [], { pollMs: 10_000 });
  const health = useQuery(() => fetchHealth(), [], { pollMs: 30_000 });
  const o = overview.data;
  const loading = overview.loading && !o;

  // From 1180px wide the overview switches to a dense layout meant to fit one laptop viewport (about 1265x590 CSS px):
  // dashboard-local header, slim stats, four events in a row, Processing and System status side by side. The negative
  // margin trims part of the shared page padding for this page only. Smaller screens keep the regular stacked layout.
  return (
    <div className="min-[1180px]:-my-3">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between min-[1180px]:mb-3 min-[1180px]:items-center">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-medium leading-tight text-ink sm:text-[32px] min-[1180px]:text-[26px]">Overview</h1>
          <span className="mt-2 block h-px w-12 bg-brand-400 min-[1180px]:hidden" aria-hidden />
          <div className="mt-2 text-sm text-muted min-[1180px]:mt-0.5">Your events, photo processing and face indexing at a glance.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>New event</ButtonLink>
        </div>
      </header>

      {overview.error && !o ? (
        <Card><ErrorState error={overview.error} onRetry={overview.reload} /></Card>
      ) : (
        <div className="space-y-6 min-[1180px]:space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 min-[1180px]:grid-cols-4 min-[1180px]:gap-3">
            <StatCard label="Events" loading={loading} icon={<CalendarDays className="h-[18px] w-[18px]" />}
                      value={o ? formatNumber(o.events) : "—"}
                      hint={o ? `${formatNumber(o.active_events)} live` : undefined} />
            <StatCard label="Photos" loading={loading} tone="blue" icon={<ImageIcon className="h-[18px] w-[18px]" />}
                      value={o ? formatNumber(o.photos) : "—"}
                      hint={o ? `${formatNumber(o.indexed_photos)} ready` : undefined} />
            <StatCard label="Indexed faces" loading={loading} tone="green" icon={<ScanFace className="h-[18px] w-[18px]" />}
                      value={o ? formatNumber(o.indexed_faces) : "—"} hint="Searchable by guests" />
            <StatCard label="Failures" loading={loading} tone={o?.failures ? "red" : "amber"}
                      icon={o?.failures ? <AlertTriangle className="h-[18px] w-[18px]" /> : <Clock className="h-[18px] w-[18px]" />}
                      value={o ? formatNumber(o.failures) : "—"}
                      hint={o ? (o.processing ? `${formatNumber(o.processing)} in queue` : "Queue is empty") : undefined} />
          </div>

          <div className="grid gap-6 min-[1180px]:gap-3">
            <section>
              <div className="mb-3 flex items-center justify-between min-[1180px]:mb-2">
                <h2 className="font-display text-xl font-medium min-[1180px]:text-lg">Recent events</h2>
                <Link href="/dashboard/events" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800">
                  View all <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              {loading ? (
                <div className="grid gap-4 sm:grid-cols-2 min-[1180px]:grid-cols-4 min-[1180px]:gap-3">{[0, 1].map((i) => <EventCardSkeleton key={i} compact />)}</div>
              ) : o && o.recent_events.length ? (
                <div className="grid gap-4 sm:grid-cols-2 min-[1180px]:grid-cols-4 min-[1180px]:gap-3">
                  {o.recent_events.slice(0, 4).map((e) => <EventCard key={e.id} event={e} compact />)}
                </div>
              ) : (
                <Card>
                  <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No events yet"
                    description="Create your first event, upload photos, and share the QR code with guests."
                    action={<ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>Create event</ButtonLink>} />
                </Card>
              )}
            </section>

            <div className="space-y-6 min-[1180px]:grid min-[1180px]:grid-cols-2 min-[1180px]:gap-3 min-[1180px]:space-y-0">
              <ProcessingCard loading={loading} total={o?.photos ?? 0} indexed={o?.indexed_photos ?? 0}
                              queued={o?.processing ?? 0} failed={o?.failures ?? 0} />
              <SystemCard health={health} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingCard({ loading, total, indexed, queued, failed }: {
  loading: boolean; total: number; indexed: number; queued: number; failed: number;
}) {
  const rows = [
    { label: "Ready", value: indexed, color: "bg-emerald-500" },
    { label: "In queue", value: queued, color: "bg-brand-500" },
    { label: "Failed", value: failed, color: "bg-red-500" },
  ];
  return (
    <Card>
      <CardHeader title="Processing" description="All events combined" className="min-[1180px]:py-2.5" />
      <div className="space-y-4 p-5 min-[1180px]:space-y-2.5 min-[1180px]:px-4 min-[1180px]:py-3">
        {loading ? <Skeleton className="h-2 w-full" /> : (
          <div className="flex h-2 overflow-hidden rounded-full bg-brand-100" aria-hidden>
            {total > 0 && rows.map((r) => (
              <div key={r.label} className={r.color} style={{ width: `${(r.value / total) * 100}%` }} />
            ))}
          </div>
        )}
        <dl className="space-y-2.5 min-[1180px]:grid min-[1180px]:grid-cols-3 min-[1180px]:gap-3 min-[1180px]:space-y-0">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-sm">
              <dt className="flex items-center gap-2 text-muted"><span className={`h-2 w-2 rounded-full ${r.color}`} />{r.label}</dt>
              <dd className="font-medium tabular-nums">{loading ? "—" : formatNumber(r.value)}</dd>
            </div>
          ))}
        </dl>
        {!loading && total > 0 && queued === 0 && failed === 0 && (
          <p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Everything is processed</p>
        )}
        {!loading && queued > 0 && <ProgressBar value={(indexed + failed) / Math.max(total, 1)} label="Overall progress" />}
      </div>
    </Card>
  );
}

function SystemCard({ health }: { health: QueryState<HealthOut> }) {
  const labels: Record<string, string> = {
    database: "Database", redis: "Task queue (Redis)", face_model: "Face model", storage: "Storage", task_mode: "Task mode",
  };
  const okish = (k: string, v: string) => (k === "storage" || k === "task_mode" ? "info" : v === "ok" ? "ok" : "bad");
  return (
    <Card>
      <CardHeader title="System status" action={<Server className="h-4 w-4 text-muted" aria-hidden />} className="min-[1180px]:py-2.5" />
      <div className="p-5 min-[1180px]:px-4 min-[1180px]:py-3">
        {health.loading && !health.data ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}</div>
        ) : health.error && !health.data ? (
          <ErrorState compact error={health.error} onRetry={health.reload} />
        ) : health.data ? (
          <dl className="space-y-2.5 min-[1180px]:grid min-[1180px]:grid-cols-2 min-[1180px]:gap-x-6 min-[1180px]:gap-y-1.5 min-[1180px]:space-y-0">
            {Object.entries(health.data.checks).map(([k, v]) => {
              const s = okish(k, v);
              return (
                <div key={k} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-muted">{labels[k] ?? k}</dt>
                  <dd className={`flex items-center gap-1.5 font-medium ${s === "bad" ? "text-red-600" : s === "ok" ? "text-emerald-700" : "text-ink"}`}>
                    {s !== "info" && <span className={`h-2 w-2 rounded-full ${s === "ok" ? "bg-emerald-500" : "bg-red-500"}`} />}
                    {v === "ok" ? "Operational" : v}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : null}
      </div>
    </Card>
  );
}

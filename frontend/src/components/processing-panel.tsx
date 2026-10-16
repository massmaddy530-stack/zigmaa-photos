"use client";

import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { adminApi, errorMessage } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import type { EventStatusOut } from "@/lib/types";
import { PHOTO_STATUS_META } from "./status-badges";
import { Button } from "./ui/button";
import { Card, ProgressBar, Skeleton } from "./ui/primitives";
import { ErrorState } from "./ui/states";
import { useToast } from "./ui/toast";

const ORDER = ["indexed", "processing", "pending", "failed"] as const;
const DOT: Record<(typeof ORDER)[number], string> = {
  indexed: "bg-emerald-500", processing: "bg-sky-500", pending: "bg-amber-500", failed: "bg-red-500",
};

export function ProcessingPanel({ eventId, status, error, onReload, onChanged }: {
  eventId: string;
  status: EventStatusOut | undefined;
  error: unknown;
  onReload: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [retrying, setRetrying] = useState(false);

  if (error && !status) return <Card className="p-2"><ErrorState compact error={error} onRetry={onReload} /></Card>;
  if (!status) return <Card className="space-y-3 p-5"><Skeleton className="h-4 w-40" /><Skeleton className="h-2 w-full" /></Card>;

  const c = status.counts;
  const inFlight = c.pending + c.processing;

  async function retryAll() {
    setRetrying(true);
    try {
      const r = await adminApi.retryFailed(eventId);
      toast.success(r.queued ? `Re-queued ${r.queued} photo${r.queued === 1 ? "" : "s"}` : "Nothing to retry");
      onChanged();
    } catch (err) {
      toast.error("Retry failed", errorMessage(err));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ${
            c.total === 0 ? "bg-zinc-50 text-zinc-500 ring-zinc-200"
              : inFlight ? "bg-sky-50 text-sky-600 ring-sky-100"
              : c.failed ? "bg-red-50 text-red-600 ring-red-100" : "bg-emerald-50 text-emerald-600 ring-emerald-100"}`}>
            {inFlight ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : c.failed ? <AlertTriangle className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">
              {c.total === 0 ? "No photos uploaded" : inFlight ? `Processing ${formatNumber(inFlight)} photo${inFlight === 1 ? "" : "s"}…`
                : c.failed ? `${formatNumber(c.failed)} photo${c.failed === 1 ? "" : "s"} failed` : "All photos processed"}
            </p>
            <p className="text-xs text-muted">
              {formatNumber(c.indexed)} of {formatNumber(c.total)} ready · {formatNumber(c.faces)} faces indexed
            </p>
          </div>
        </div>
        {c.failed > 0 && (
          <Button size="sm" variant="outline" onClick={retryAll} loading={retrying} icon={<RotateCcw className="h-4 w-4" />}>
            Retry failed
          </Button>
        )}
      </div>

      {c.total > 0 && (
        <>
          <ProgressBar value={status.progress} className="mt-4" tone={inFlight ? "brand" : c.failed ? "red" : "green"} label="Processing progress" />
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${DOT[s]}`} aria-hidden />
                <dt className="text-muted">{PHOTO_STATUS_META[s].label}</dt>
                <dd className="ml-auto font-medium tabular-nums text-ink sm:ml-0">{formatNumber(c[s])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {status.recent_failures.length > 0 && (
        <details className="group mt-4 rounded-xl border border-red-100 bg-red-50/50">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-red-800">
            Show recent errors ({status.recent_failures.length})
          </summary>
          <ul className="space-y-1.5 border-t border-red-100 px-3 py-2 text-xs">
            {status.recent_failures.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="max-w-[40%] shrink-0 truncate font-medium text-ink">{p.original_filename}</span>
                <span className="min-w-0 text-red-700">{p.error_message ?? "Unknown error"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

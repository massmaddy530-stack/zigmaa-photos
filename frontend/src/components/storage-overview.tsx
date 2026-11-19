"use client";

import { Cloud, HardDrive, RefreshCw } from "lucide-react";
import { useQuery } from "@/lib/hooks";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/format";
import type { StorageOverviewOut } from "@/lib/types";

interface StorageOverviewProps {
  initialData?: StorageOverviewOut;
  className?: string;
  compact?: boolean;
}

export function StorageOverview({ initialData, className, compact = false }: StorageOverviewProps) {
  const query = useQuery(() => adminApi.storageOverview(), [], {
    pollMs: 30_000,
  });

  const data: StorageOverviewOut = query.data || initialData || {
    used_bytes: 232357330944,
    quota_bytes: 322122547200,
    used_percent: 72,
    used_gb: 216.4,
    available_gb: 83.6,
    total_gb: 300,
    provider: "Cloudflare R2",
  };

  // SVG Donut calculation
  const size = compact ? 104 : 124;
  const strokeWidth = compact ? 12 : 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.min(100, Math.max(0, data.used_percent));
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface p-5 shadow-xs transition-shadow hover:shadow-sm",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-line/60">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[#e50914]" />
          <h3 className="font-display text-base font-bold tracking-tight text-ink">
            Storage Overview
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-200/50 dark:border-red-800/40 px-2 py-0.5 text-[11px] font-semibold text-[#e50914]">
            <Cloud className="h-3 w-3" />
            {data.provider || "Cloudflare R2"}
          </span>
          <button
            type="button"
            onClick={() => void query.reload()}
            title="Refresh storage statistics"
            className="grid h-6 w-6 place-items-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", query.loading ? "animate-spin text-brand-600" : "")} />
          </button>
        </div>
      </div>

      {/* Main Content Layout matching Image 4 */}
      <div className="flex flex-col sm:flex-row items-center sm:items-center justify-between gap-5 pt-4">
        {/* Left: Circular Donut Gauge */}
        <div className="relative flex shrink-0 items-center justify-center">
          <svg width={size} height={size} className="-rotate-90 transform">
            {/* Background Track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="currentColor"
              strokeWidth={strokeWidth}
              fill="transparent"
              className="text-slate-100 dark:text-zinc-800"
            />
            {/* Red Progress Bar */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke="#e50914"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700 ease-out"
            />
          </svg>
          {/* Centered Percentage & Label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-2xl font-bold leading-none tracking-tight text-ink">
              {percent}%
            </span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Used
            </span>
          </div>
        </div>

        {/* Right: Storage numbers & legend card */}
        <div className="flex flex-1 flex-col justify-center space-y-3 w-full">
          {/* Top text: 216.4 GB / 300 GB */}
          <div className="text-center sm:text-right">
            <p className="font-display text-xl sm:text-2xl font-bold tracking-tight text-ink">
              {data.used_gb.toFixed(1)} GB{" "}
              <span className="text-muted text-base font-semibold">/ {data.total_gb.toFixed(0)} GB</span>
            </p>
          </div>

          {/* Legend Box matching Image 4 */}
          <div className="rounded-xl border border-line/70 bg-canvas/60 p-3 space-y-2">
            {/* Used Storage row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#e50914] shrink-0 shadow-xs" />
                <span className="font-medium text-ink">Used Storage</span>
              </div>
              <span className="font-bold text-ink">{data.used_gb.toFixed(1)} GB</span>
            </div>

            {/* Available row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-zinc-600 shrink-0" />
                <span className="font-medium text-ink">Available</span>
              </div>
              <span className="font-bold text-ink">{data.available_gb.toFixed(1)} GB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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

function formatStorageSize(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageOverview({ initialData, className, compact = false }: StorageOverviewProps) {
  const query = useQuery(() => adminApi.storageOverview(), [], {
    pollMs: 30_000,
  });

  const data: StorageOverviewOut = query.data || initialData || {
    used_bytes: 0,
    quota_bytes: 10 * 1024 * 1024 * 1024,
    used_percent: 0,
    used_gb: 0,
    available_gb: 10,
    total_gb: 10,
    provider: "Cloudflare R2",
  };

  const usedDisplay = formatStorageSize(data.used_bytes);
  const availableBytes = Math.max(0, data.quota_bytes - data.used_bytes);
  const availableDisplay = formatStorageSize(availableBytes);

  let percentLabel = "0%";
  if (data.used_percent > 0 && data.used_percent < 0.1) {
    percentLabel = "< 0.1%";
  } else if (data.used_percent > 0 && data.used_percent < 1) {
    percentLabel = `${data.used_percent.toFixed(1)}%`;
  } else {
    percentLabel = `${Math.round(data.used_percent)}%`;
  }

  // SVG Donut calculation
  const size = compact ? 104 : 124;
  const strokeWidth = compact ? 12 : 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // If there are bytes, draw at least 1.5% so the user visually sees the arc
  const progressPercent = Math.min(100, Math.max(data.used_bytes > 0 ? 1.5 : 0, data.used_percent));
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  return (
    <div
      className={cn(
        "dashboard-card p-5 transition-shadow hover:shadow-md",
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
            Cloudflare R2 (10 GB Free Tier)
          </span>
          <button
            type="button"
            onClick={() => void query.reload()}
            title="Refresh real-time storage statistics"
            className="grid h-6 w-6 place-items-center rounded-lg text-muted hover:text-ink hover:bg-canvas transition-colors"
          >
            <RefreshCw className={cn("h-3 w-3", query.loading ? "animate-spin text-brand-600" : "")} />
          </button>
        </div>
      </div>

      {/* Main Content Layout with REAL Cloudflare R2 metrics */}
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
              {percentLabel}
            </span>
            <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Used
            </span>
          </div>
        </div>

        {/* Right: Real Storage numbers & legend card */}
        <div className="flex flex-1 flex-col justify-center space-y-3 w-full">
          {/* Top text: real used / 10 GB */}
          <div className="text-center sm:text-right">
            <p className="font-display text-xl sm:text-2xl font-bold tracking-tight text-ink">
              {usedDisplay}{" "}
              <span className="text-muted text-base font-semibold">/ {data.total_gb.toFixed(0)} GB</span>
            </p>
          </div>

          {/* Legend Box */}
          <div className="rounded-xl border border-line/70 bg-canvas/60 p-3 space-y-2">
            {/* Used Storage row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#e50914] shrink-0 shadow-xs" />
                <span className="font-medium text-ink">Used Storage</span>
              </div>
              <span className="font-bold text-ink">{usedDisplay}</span>
            </div>

            {/* Available row */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-zinc-600 shrink-0" />
                <span className="font-medium text-ink">Available</span>
              </div>
              <span className="font-bold text-ink">{availableDisplay}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

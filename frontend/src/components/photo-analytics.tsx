"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, TrendingUp } from "lucide-react";
import { cn, formatNumber } from "@/lib/format";

export type AnalyticsRange = "7d" | "14d" | "30d" | "90d" | "all";

interface PhotoAnalyticsProps {
  photosTotal?: number;
  eventsTotal?: number;
  className?: string;
}

export function PhotoAnalytics({ photosTotal = 480, className }: PhotoAnalyticsProps) {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Generate realistic data points based on total photos and selected range
  const chartData = useMemo(() => {
    const today = new Date();
    let numBars = 7;
    let labelFormat: "day" | "date" | "month" = "day";

    switch (range) {
      case "7d":
        numBars = 7;
        labelFormat = "day";
        break;
      case "14d":
        numBars = 14;
        labelFormat = "date";
        break;
      case "30d":
        numBars = 15; // 15 bi-daily bars
        labelFormat = "date";
        break;
      case "90d":
        numBars = 12; // 12 weekly bars
        labelFormat = "date";
        break;
      case "all":
        numBars = 10;
        labelFormat = "month";
        break;
    }

    // Weights representing natural photoshoot upload spikes
    const rawWeights = [24, 68, 32, 112, 85, 142, 95, 45, 80, 120, 90, 60, 130, 75, 105];
    const subset = rawWeights.slice(0, numBars);
    const weightSum = subset.reduce((acc, w) => acc + w, 0);

    return subset.map((w, i) => {
      const d = new Date(today);
      const daysBack = numBars - 1 - i;
      d.setDate(d.getDate() - (range === "all" ? daysBack * 14 : range === "90d" ? daysBack * 7 : daysBack));

      let label = "";
      if (labelFormat === "day") {
        label = d.toLocaleDateString("en-US", { weekday: "short" });
      } else if (labelFormat === "month") {
        label = d.toLocaleDateString("en-US", { month: "short" });
      } else {
        label = `${d.getDate()}/${d.getMonth() + 1}`;
      }

      const count = Math.max(8, Math.round((w / weightSum) * (photosTotal || 480)));

      return {
        label,
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        count,
      };
    });
  }, [range, photosTotal]);

  const maxVal = Math.max(...chartData.map((d) => d.count), 1);
  const rangeTotal = chartData.reduce((acc, d) => acc + d.count, 0);

  return (
    <div
      className={cn(
        "dashboard-card flex flex-col justify-between p-5 transition-shadow hover:shadow-md",
        className
      )}
    >
      {/* Header with Title & Filter Dropdown */}
      <div className="flex items-center justify-between border-b border-line/60 pb-3.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-[#e50914]" />
          <h3 className="font-display text-base font-bold tracking-tight text-ink">
            Photo Analytics
          </h3>
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as AnalyticsRange)}
            className="appearance-none cursor-pointer rounded-full border border-line bg-surface/90 py-1 pl-3 pr-8 text-xs font-semibold text-ink shadow-2xs hover:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 3 months</option>
            <option value="all">All time</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {/* Analytics Summary Stats & Bar Chart */}
      <div className="flex flex-1 flex-col justify-between pt-4">
        {/* Metric Overview Row */}
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <span className="font-display text-2xl font-bold tracking-tight text-ink">
              {formatNumber(rangeTotal)}
            </span>
            <span className="ml-1.5 text-xs text-muted">photos uploaded</span>
          </div>

          <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <TrendingUp className="h-3 w-3" />
            <span>+18% activity</span>
          </div>
        </div>

        {/* Bar Chart Area matching Image 2 */}
        <div className="relative flex h-24 items-end gap-1.5 sm:gap-2.5 pt-2">
          {chartData.map((item, idx) => {
            const heightPercent = Math.max(16, Math.round((item.count / maxVal) * 100));
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="group relative flex flex-1 flex-col items-center h-full justify-end"
              >
                {/* Tooltip on Hover */}
                {isHovered && (
                  <div className="absolute -top-8 z-30 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
                    {item.count} photos · {item.date}
                  </div>
                )}

                {/* Animated Gradient Bar */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className={cn(
                    "w-full rounded-t-md transition-all duration-300",
                    isHovered
                      ? "bg-gradient-to-t from-[#b91c1c] via-[#e50914] to-[#f87171] shadow-sm"
                      : idx % 2 === 0
                      ? "bg-gradient-to-t from-[#dc2626] to-[#f87171]"
                      : "bg-gradient-to-t from-[#ef4444] to-[#fca5a5]"
                  )}
                />

                {/* X-axis Label */}
                <span className="mt-1.5 text-[10px] font-medium text-muted transition-colors group-hover:text-ink select-none">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

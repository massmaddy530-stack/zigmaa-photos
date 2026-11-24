"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, ImageIcon } from "lucide-react";
import { cn, formatNumber } from "@/lib/format";

export type AnalyticsRange = "7d" | "14d" | "30d" | "90d" | "all";

interface PhotoAnalyticsProps {
  photosTotal?: number;
  eventsTotal?: number;
  timeline?: Array<{ date: string; count: number }>;
  className?: string;
}

export function PhotoAnalytics({ photosTotal = 0, timeline = [], className }: PhotoAnalyticsProps) {
  const [range, setRange] = useState<AnalyticsRange>("7d");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Build real timeline data from user's actual database photos
  const chartData = useMemo(() => {
    // If user has 0 photos, return completely empty 0-state
    if (!photosTotal || photosTotal <= 0) {
      const today = new Date();
      const numDays = range === "7d" ? 7 : range === "14d" ? 14 : range === "30d" ? 15 : 10;
      return Array.from({ length: numDays }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (numDays - 1 - i));
        return {
          label: d.toLocaleDateString("en-US", { weekday: "short" }),
          date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          count: 0,
        };
      });
    }

    // Map real date strings (YYYY-MM-DD) to photo counts
    const dateCountMap = new Map<string, number>();
    for (const item of timeline) {
      if (item.date && item.count) {
        dateCountMap.set(item.date, (dateCountMap.get(item.date) || 0) + item.count);
      }
    }

    const today = new Date();
    let numDays = 7;
    let stepDays = 1;
    let labelFormat: "day" | "date" | "month" = "day";

    switch (range) {
      case "7d":
        numDays = 7;
        stepDays = 1;
        labelFormat = "day";
        break;
      case "14d":
        numDays = 14;
        stepDays = 1;
        labelFormat = "date";
        break;
      case "30d":
        numDays = 15;
        stepDays = 2;
        labelFormat = "date";
        break;
      case "90d":
        numDays = 12;
        stepDays = 7;
        labelFormat = "date";
        break;
      case "all":
        numDays = 10;
        stepDays = 30;
        labelFormat = "month";
        break;
    }

    const result = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * stepDays);
      const isoDate = d.toISOString().split("T")[0];

      let label = "";
      if (labelFormat === "day") {
        label = d.toLocaleDateString("en-US", { weekday: "short" });
      } else if (labelFormat === "month") {
        label = d.toLocaleDateString("en-US", { month: "short" });
      } else {
        label = `${d.getDate()}/${d.getMonth() + 1}`;
      }

      // Check real count for this date/period
      let periodCount = 0;
      if (stepDays === 1) {
        periodCount = dateCountMap.get(isoDate) || 0;
      } else {
        // Aggregate days in this step interval
        for (let s = 0; s < stepDays; s++) {
          const stepDate = new Date(d);
          stepDate.setDate(stepDate.getDate() - s);
          const stepIso = stepDate.toISOString().split("T")[0];
          periodCount += dateCountMap.get(stepIso) || 0;
        }
      }

      // If user has photos overall but no specific date split was stored in timeline yet,
      // attribute to the most recent day (today)
      if (dateCountMap.size === 0 && i === 0 && photosTotal > 0) {
        periodCount = photosTotal;
      }

      result.push({
        label,
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        count: periodCount,
      });
    }

    return result;
  }, [range, photosTotal, timeline]);

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
            <span className="ml-1.5 text-xs text-muted">photos in this period</span>
          </div>

          <div className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
            <ImageIcon className="h-3 w-3 text-muted" />
            <span>Total: {formatNumber(photosTotal)}</span>
          </div>
        </div>

        {/* Bar Chart Area */}
        <div className="relative flex h-24 items-end gap-1.5 sm:gap-2.5 pt-2">
          {chartData.map((item, idx) => {
            const hasData = item.count > 0;
            const heightPercent = hasData ? Math.max(16, Math.round((item.count / maxVal) * 100)) : 4;
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

                {/* Bar */}
                <div
                  style={{ height: `${heightPercent}%` }}
                  className={cn(
                    "w-full rounded-t-md transition-all duration-300",
                    hasData
                      ? isHovered
                        ? "bg-gradient-to-t from-[#b91c1c] via-[#e50914] to-[#f87171] shadow-sm"
                        : idx % 2 === 0
                        ? "bg-gradient-to-t from-[#dc2626] to-[#f87171]"
                        : "bg-gradient-to-t from-[#ef4444] to-[#fca5a5]"
                      : "bg-slate-200/80 hover:bg-slate-300"
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

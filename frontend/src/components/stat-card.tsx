import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { Card, Skeleton } from "./ui/primitives";

export function StatCard({ label, value, icon, hint, tone = "brand", loading }: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  tone?: "brand" | "green" | "amber" | "red" | "blue";
  loading?: boolean;
}) {
  const tones = {
    brand: "bg-brand-50 text-brand-600 ring-brand-100",
    green: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    amber: "bg-amber-50 text-amber-600 ring-amber-100",
    red: "bg-red-50 text-red-600 ring-red-100",
    blue: "bg-sky-50 text-sky-600 ring-sky-100",
  };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1", tones[tone])}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink sm:text-3xl">{value}</p>
      )}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

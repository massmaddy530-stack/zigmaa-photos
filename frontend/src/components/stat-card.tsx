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
    // From 1180px (dashboard compact layout): a slim card, label/value/hint stacked left and the icon on the right.
    <Card className="p-4 sm:p-5 min-[1180px]:grid min-[1180px]:grid-cols-[minmax(0,1fr)_auto] min-[1180px]:items-center min-[1180px]:gap-x-3 min-[1180px]:px-4 min-[1180px]:py-2.5">
      <div className="flex items-start justify-between gap-3 min-[1180px]:contents">
        <p className="text-sm font-medium text-muted min-[1180px]:col-start-1 min-[1180px]:row-start-1 min-[1180px]:text-xs">{label}</p>
        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 min-[1180px]:col-start-2 min-[1180px]:row-span-3 min-[1180px]:row-start-1", tones[tone])}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20 min-[1180px]:col-start-1 min-[1180px]:mt-1 min-[1180px]:h-6" />
      ) : (
        <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink sm:text-3xl min-[1180px]:col-start-1 min-[1180px]:mt-0 min-[1180px]:text-xl min-[1180px]:leading-7">{value}</p>
      )}
      {hint && <div className="mt-1 text-xs text-muted min-[1180px]:col-start-1 min-[1180px]:mt-0 min-[1180px]:text-[11px] min-[1180px]:leading-4">{hint}</div>}
    </Card>
  );
}

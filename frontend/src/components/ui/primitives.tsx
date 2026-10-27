import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...rest} />;
}

export function CardHeader({ title, description, action, className }: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-canvas text-ink/80 ring-line",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-200",
  red: "bg-red-50 text-red-700 ring-red-200",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({ tone = "neutral", className, children, dot }: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
      badgeTones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-lg", className)} aria-hidden />;
}

export function Label({ className, ...rest }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...rest} />;
}

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink shadow-sm placeholder:text-muted/70 " +
  "transition focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-canvas";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(fieldBase, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldBase, "min-h-24 py-2.5", className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<"select">) {
  return <select className={cn(fieldBase, "h-10 pr-8", className)} {...rest} />;
}

export function Field({ label, htmlFor, hint, error, children }: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1.5 text-sm text-red-600" role="alert">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, className, tone = "brand", label }: {
  value: number;
  className?: string;
  tone?: "brand" | "green" | "red";
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color = tone === "green" ? "bg-emerald-500" : tone === "red" ? "bg-red-500" : "bg-brand-500";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-brand-100", className)} role="progressbar"
         aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

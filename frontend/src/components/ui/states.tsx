import { AlertTriangle, Loader2, RefreshCw, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { Button } from "./button";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-muted", className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon, title, description, action, className }: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, compact }: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const offline = error instanceof ApiError && ["network_error", "backend_unreachable", "timeout"].includes(error.code);
  const Icon = offline ? WifiOff : AlertTriangle;
  if (compact) {
    return (
      <div role="alert" className={cn("flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800", className)}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">{errorMessage(error)}</span>
        {onRetry && (
          <button onClick={onRetry} className="font-medium underline-offset-2 hover:underline">Retry</button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-ink">{offline ? "Connection problem" : "Something went wrong"}</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-5" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "info", title, children, icon, className }: {
  tone?: "info" | "warning" | "error" | "success";
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-brand-200 bg-brand-50 text-brand-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5" : undefined, "opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

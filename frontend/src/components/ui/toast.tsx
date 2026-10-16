"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

type Tone = "success" | "error" | "info";
interface Toast { id: number; tone: Tone; title: string; description?: string }

const ToastCtx = createContext<((t: Omit<Toast, "id">) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4000);
  }, [dismiss]);
  const icons = { success: CheckCircle2, error: XCircle, info: Info };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className="pointer-events-auto flex w-full max-w-sm animate-[var(--animate-scale-in)] items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-pop)]">
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0",
                t.tone === "success" ? "text-emerald-600" : t.tone === "error" ? "text-red-600" : "text-brand-600")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-muted hover:text-ink" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(() => {
    const fn = push ?? (() => undefined);
    return {
      success: (title: string, description?: string) => fn({ tone: "success", title, description }),
      error: (title: string, description?: string) => fn({ tone: "error", title, description }),
      info: (title: string, description?: string) => fn({ tone: "info", title, description }),
    };
  }, [push]);
}

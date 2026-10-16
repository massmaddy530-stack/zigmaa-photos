"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/format";
import { Button } from "./button";

export function Modal({ open, onClose, title, description, children, footer, size = "md", bare }: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /** No padding/header chrome (used by the lightbox). */
  bare?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab" && panel.current) {
        // Keep keyboard focus inside the dialog.
        const items = panel.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
        );
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-6xl", full: "max-w-none" };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 animate-[var(--animate-fade-in)] bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          "relative w-full animate-[var(--animate-scale-in)] overflow-hidden bg-surface shadow-[var(--shadow-pop)] focus:outline-none",
          "max-h-[92dvh] rounded-t-3xl sm:rounded-2xl",
          widths[size],
          bare ? "" : "flex flex-col",
        )}
      >
        {bare ? children : (
          <>
            {title && (
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
                  {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
                </div>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3">{footer}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", danger, loading, confirmDisabled, children }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>{confirmLabel}</Button>
        </>
      }>
      {description && <div className="text-sm text-muted">{description}</div>}
      {children}
    </Modal>
  );
}

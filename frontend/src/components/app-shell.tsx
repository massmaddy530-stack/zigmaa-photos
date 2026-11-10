"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CSRF_HEADER } from "@/lib/api";
import { cn } from "@/lib/format";
import { ButtonLink } from "./ui/button";

export function Logo({ className }: { className?: string; admin?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <img src="/logo.png" alt="MADX Logo" className="h-9 w-auto max-w-[48px] object-contain drop-shadow-sm" />
      <span className="font-display text-[21px] font-bold tracking-wide text-ink">
        MADX <span className="text-[var(--color-brand-600)]">Photos</span>
      </span>
    </span>
  );
}

export function SignOut({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/session", { method: "DELETE", headers: CSRF_HEADER }).catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
      className={cn("inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-brand-50 hover:text-ink disabled:opacity-50", className)}>
      <LogOut className="h-4 w-4" aria-hidden />
      <span>Sign out</span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      {/* Top Navigation Bar: Logo & Name in top-left, Actions & Sign Out in top-right */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="transition-opacity hover:opacity-90">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <ButtonLink href="/dashboard/events/new" icon={<Plus className="h-4 w-4" />}>
              New event
            </ButtonLink>
            <SignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumb }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-2 text-sm text-muted">{breadcrumb}</div>}
        <h1 className="font-display text-[26px] font-medium leading-tight text-ink sm:text-[32px]">{title}</h1>
        <span className="mt-2 block h-px w-12 bg-brand-400" aria-hidden />
        {description && <div className="mt-2 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, LayoutDashboard, LogOut, Menu, Plus, ScanFace, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { CSRF_HEADER } from "@/lib/api";
import { cn } from "@/lib/format";
import { ButtonLink } from "./ui/button";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/events", label: "Events", icon: CalendarDays },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-sm">
        <ScanFace className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">
        Zigmaa<span className="text-brand-600"> Photos</span>
      </span>
    </span>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link key={href} href={href} onClick={onNavigate} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-black/[0.04] hover:text-ink")}>
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOut() {
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
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-black/[0.04] hover:text-ink disabled:opacity-50">
      <LogOut className="h-[18px] w-[18px]" aria-hidden />
      Sign out
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-6 px-4 py-5">
      <Link href="/dashboard" onClick={onNavigate} className="px-2"><Logo /></Link>
      <ButtonLink href="/dashboard/events/new" onClick={onNavigate} icon={<Plus className="h-4 w-4" />} className="w-full">
        New event
      </ButtonLink>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto space-y-3">
        <div className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white p-4">
          <p className="text-sm font-semibold text-ink">Share with guests</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Open an event and use its QR code. Guests find their photos with a selfie — no app or account needed.
          </p>
        </div>
        <SignOut />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        {sidebar()}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden">
        <Link href="/dashboard"><Logo /></Link>
        <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-black/5"
                aria-label="Open menu" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-[var(--animate-fade-in)] bg-zinc-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-[var(--animate-scale-in)] bg-surface shadow-[var(--shadow-pop)]">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-xl hover:bg-black/5"
                    aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar(() => setOpen(false))}
          </div>
        </div>
      )}

      <main className="lg:pl-64">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
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
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

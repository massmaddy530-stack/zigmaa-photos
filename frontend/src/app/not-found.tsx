import Link from "next/link";
import { Compass } from "lucide-react";
import { Logo } from "@/components/app-shell";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-600 ring-1 ring-brand-100">
        <Compass className="h-6 w-6" aria-hidden />
      </div>
      <div>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      </div>
      <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:text-brand-800">Go to dashboard</Link>
    </div>
  );
}

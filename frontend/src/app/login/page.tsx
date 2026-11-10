import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/app-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: { absolute: "Sign in · MADX Photos" }, robots: { index: false } };

export default async function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:py-6">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12 lg:py-4">
          <h1 className="font-display text-3xl font-medium">Sign in to your studio</h1>
          <span className="mt-3 block h-px w-12 bg-brand-400 lg:mt-2" aria-hidden />
          <p className="mt-2 text-sm text-muted">Sign in with your admin username and password.</p>
          <div className="mt-6">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--color-brand-500)_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_left,_var(--color-brand-700)_0%,_transparent_50%)] opacity-70" />
        <div className="relative flex h-full flex-col justify-end p-10 text-white xl:p-12">
          <div className="mb-8 grid w-full max-w-[max(8rem,min(28rem,calc(80dvh_-_15rem)))] grid-cols-3 gap-3 opacity-90" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm" />
            ))}
          </div>
          <p className="font-display text-2xl font-medium leading-snug xl:text-3xl">
            Every guest, every photo &mdash; delivered in seconds with a single selfie.
          </p>
          <p className="mt-2 text-sm text-white/70">
            Upload event photos, let AI index the faces, and share one QR code.
          </p>
        </div>
      </div>
    </div>
  );
}

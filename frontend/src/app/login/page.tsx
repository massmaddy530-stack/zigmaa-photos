import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/app-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your studio</h1>
          <p className="mt-2 text-sm text-muted">
            Enter the admin API key configured on your backend (<code className="font-mono text-xs">ADMIN_API_KEY</code>).
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-xs leading-relaxed text-muted">
            The key is verified by the server and kept in a secure, httpOnly session cookie. It is never stored in
            browser JavaScript.
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--color-brand-500)_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_left,_var(--color-brand-700)_0%,_transparent_50%)] opacity-70" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <div className="mb-10 grid max-w-md grid-cols-3 gap-3 opacity-90" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className={`aspect-[4/5] rounded-2xl border border-white/10 ${i % 4 === 0 ? "bg-white/20" : "bg-white/[0.07]"}`} />
            ))}
          </div>
          <p className="max-w-md text-2xl font-semibold leading-snug">
            Every guest, every photo — delivered in seconds with a single selfie.
          </p>
          <p className="mt-3 max-w-md text-sm text-white/70">
            Upload event photos, let AI index the faces, and share one QR code.
          </p>
        </div>
      </div>
    </div>
  );
}

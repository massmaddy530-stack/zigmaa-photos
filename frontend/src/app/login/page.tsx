import type { Metadata } from "next";
import { Suspense } from "react";
import { Camera, Download, Share2, Sparkles } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Zigmaa Photos" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-white lg:grid-cols-[440px_1fr] xl:grid-cols-[480px_1fr]">
      {/* Left Column: Sign-in / Reset / Sign-up Forms (Strictly 1-page fit, no scroll) */}
      <div className="flex h-full w-full flex-col justify-center px-6 sm:px-10 lg:px-12 overflow-hidden bg-white">
        <div className="mx-auto w-full max-w-[380px]">
          {/* Brand Header: Crisp Red Wolf Badge + Typography */}
          <div className="mb-4 flex items-center justify-center gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#e50914] p-1.5 shadow-md shadow-red-500/25">
              <img
                src="/zigma_logo.webp"
                alt="Zigmaa Wolf"
                className="h-full w-full object-contain"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-display text-xl font-bold tracking-tight text-[#0f172a]">
                <span>ZIGMAA</span>
                <span className="text-[#e50914]">PHOTOS</span>
              </div>
              <p className="text-[11px] font-medium tracking-wide text-[#64748b]">
                Event Photo Management Platform
              </p>
            </div>
          </div>

          {/* Dynamic In-place Form (Sign in to your studio / Reset password / Create account) */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>

      {/* Right Column: AI-Generated Luxury Studio Photography Hero with Native Glassmorphic Showcase */}
      <div className="relative hidden h-full w-full overflow-hidden bg-[#0d0102] lg:flex flex-col justify-between p-10 xl:p-14 select-none">
        {/* Background AI Studio Photograph */}
        <img
          src="/zigmaa-login-hero.jpg"
          alt="Zigmaa Photos Studio Platform"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />

        {/* Cinematic atmospheric overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/25 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(229,9,20,0.15)_0%,transparent_60%)] pointer-events-none" />

        {/* Top Badge */}
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-black/50 px-3.5 py-1 text-xs font-semibold tracking-wider text-red-300 backdrop-blur-md shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[#e50914] animate-pulse" />
            <span>ZIGMAA STUDIO SUITE</span>
          </div>
        </div>

        {/* Middle Showcase Content */}
        <div className="relative z-10 max-w-xl space-y-4">
          <h2 className="font-display text-3xl xl:text-4xl font-extrabold tracking-tight text-white leading-tight">
            Complete Photo Management <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-rose-400 to-amber-200">
              for Your Events
            </span>
          </h2>

          <p className="text-sm text-slate-300/90 leading-relaxed font-light">
            Deliver every guest their event memories with instant AI face search, customized watermark templates, and lightning-fast cloud gallery sharing.
          </p>

          {/* 3 Glassmorphism Feature Cards */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="rounded-2xl border border-white/10 bg-black/45 p-3.5 backdrop-blur-md shadow-lg transition-transform hover:scale-[1.02]">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[#e50914]/20 text-[#e50914]">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="text-xs font-bold text-white">AI Face Search</div>
              <div className="mt-0.5 text-[10px] text-slate-400 leading-snug">Instant selfies match all event photos</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/45 p-3.5 backdrop-blur-md shadow-lg transition-transform hover:scale-[1.02]">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[#e50914]/20 text-[#e50914]">
                <Download className="h-4 w-4" />
              </div>
              <div className="text-xs font-bold text-white">Watermark Studio</div>
              <div className="mt-0.5 text-[10px] text-slate-400 leading-snug">Custom branding on high-res downloads</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/45 p-3.5 backdrop-blur-md shadow-lg transition-transform hover:scale-[1.02]">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-[#e50914]/20 text-[#e50914]">
                <Share2 className="h-4 w-4" />
              </div>
              <div className="text-xs font-bold text-white">Guest Portals</div>
              <div className="mt-0.5 text-[10px] text-slate-400 leading-snug">Instant QR codes & live mobile links</div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="relative z-10 flex items-center gap-2 text-xs text-white/50">
          <Camera className="h-3.5 w-3.5 text-[#e50914]" />
          <span>Professional AI Photography & Event Platform</span>
        </div>
      </div>
    </div>
  );
}

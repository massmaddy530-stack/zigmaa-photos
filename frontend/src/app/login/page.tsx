import type { Metadata } from "next";
import { Suspense } from "react";
import { Camera, Sparkles, Share2 } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Zigmaa Photos" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-white lg:grid-cols-[46%_54%] xl:grid-cols-[42%_58%]">
      {/* Left Column: In-place Sign-in / Reset / Sign-up Forms (Strictly 1-page fit, no scroll) */}
      <div className="flex h-full w-full flex-col justify-center px-6 sm:px-10 lg:px-12 xl:px-16 overflow-hidden">
        <div className="mx-auto w-full max-w-[430px]">
          {/* Brand Logo header */}
          <div className="mb-4 flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Zigmaa Logo"
              className="h-9 w-9 rounded-xl object-cover shadow-sm ring-1 ring-[#e50914]/20"
            />
            <div>
              <span className="font-display text-lg font-bold tracking-wider text-[#0f172a]">
                ZIGMAA <span className="text-[#e50914]">PHOTOS</span>
              </span>
              <p className="text-[10px] text-[#64748b] tracking-wide">
                AI Event Photography Studio
              </p>
            </div>
          </div>

          {/* Dynamic In-place Form (Welcome back / Reset password / Create account) */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>

      {/* Right Column: Luxury Dark Crimson Studio Showcase with Neon Red Highlights */}
      <div className="relative hidden h-full w-full overflow-hidden bg-gradient-to-br from-[#1c0205] via-[#0d0102] to-[#170003] lg:flex flex-col items-center justify-center p-10 text-center select-none">
        {/* Ambient atmospheric red spotlights */}
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[#e50914]/25 blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-[#e50914]/20 blur-[120px] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(229,9,20,0.15)_0%,transparent_70%)] pointer-events-none" />

        {/* Centerpiece Showcase */}
        <div className="relative z-10 w-full max-w-md space-y-6">
          {/* Glowing Red Zigmaa Wolf Emblem Badge */}
          <div className="relative mx-auto flex h-32 w-32 items-center justify-center rounded-3xl bg-[#e50914] p-5 shadow-[0_0_55px_rgba(229,9,20,0.55)] ring-4 ring-white/20 transform transition-transform duration-500 hover:scale-105">
            <img
              src="/zigma_logo.webp"
              alt="Zigmaa Wolf Logo"
              className="h-full w-full object-contain drop-shadow-md"
            />
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-3xl font-bold tracking-[0.3em] text-white">
              Z I G M A A
            </h2>
            <p className="font-sans text-[11px] font-semibold tracking-[0.45em] text-[#e50914] uppercase">
              Photography Studio Platform
            </p>
          </div>

          {/* Red line with diamond */}
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-16 bg-gradient-to-r from-transparent via-[#e50914] to-white/40" />
            <span className="text-xs text-[#e50914]">◆</span>
            <span className="h-px w-16 bg-gradient-to-l from-transparent via-[#e50914] to-white/40" />
          </div>

          <p className="font-display italic text-base text-white/90 font-light tracking-wide">
            &ldquo;Every Moment Tells a Story&rdquo;
          </p>

          {/* Feature Highlight Cards with Neon Accents */}
          <div className="grid grid-cols-3 gap-2.5 pt-4 border-t border-white/10 text-white/90">
            <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm shadow-inner">
              <Camera className="h-4 w-4 text-[#e50914]" />
              <span className="text-[11px] font-medium tracking-wide">AI Capture</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm shadow-inner">
              <Sparkles className="h-4 w-4 text-[#e50914]" />
              <span className="text-[11px] font-medium tracking-wide">Face Search</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 p-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm shadow-inner">
              <Share2 className="h-4 w-4 text-[#e50914]" />
              <span className="text-[11px] font-medium tracking-wide">Live Sharing</span>
            </div>
          </div>
        </div>

        {/* Bottom subtle copyright / branding */}
        <div className="absolute bottom-5 text-[10px] font-medium tracking-widest text-white/40 uppercase">
          Powered by Zigmaa AI Engine
        </div>
      </div>
    </div>
  );
}

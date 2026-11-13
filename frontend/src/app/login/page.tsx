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
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-white lg:grid-cols-[48%_52%] xl:grid-cols-[44%_56%]">
      {/* Left Half: Clean Crisp White Zigmaa Studio Sign-in */}
      <div className="flex h-full w-full flex-col justify-center px-6 py-6 sm:px-10 lg:px-12 xl:px-16 overflow-y-auto">
        <div className="mx-auto w-full max-w-[430px] lg:max-w-[450px]">
          {/* Brand Logo & Name Header */}
          <div className="mb-6 text-center sm:mb-7">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e50914] p-2.5 shadow-[0_8px_24px_rgba(229,9,20,0.35)] ring-4 ring-red-500/15">
              <img
                src="/zigma_logo.webp"
                alt="Zigmaa Logo"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="font-display text-2xl font-bold tracking-[0.25em] text-[#0f172a] sm:text-[26px]">
              ZIGMAA <span className="text-[#e50914]">PHOTOS</span>
            </div>
            <div className="text-xs font-medium tracking-wider text-muted sm:text-[13px] mt-0.5">
              AI-Powered Event Photography & Live Sharing
            </div>
          </div>

          {/* Heading & Subtitle */}
          <div className="text-center">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#0f172a] sm:text-3xl">
              Sign in to your studio
            </h1>
            <p className="mt-1 text-sm text-muted">
              Enter your studio credentials to access your events.
            </p>

            {/* Red Accent Divider */}
            <div className="my-4 flex items-center justify-center gap-3.5 sm:my-5">
              <span className="h-px w-16 bg-gradient-to-r from-transparent via-[#e50914] to-transparent" aria-hidden="true" />
              <span className="text-xs text-[#e50914]" aria-hidden="true">◆</span>
              <span className="h-px w-16 bg-gradient-to-l from-transparent via-[#e50914] to-transparent" aria-hidden="true" />
            </div>
          </div>

          {/* Form */}
          <div className="mt-2">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Right Half: Luxury Crimson & Dark Zigmaa Studio Showcase */}
      <div className="relative hidden h-full w-full overflow-hidden bg-gradient-to-br from-[#1c0205] via-[#0d0102] to-[#170003] lg:flex flex-col items-center justify-center p-12 text-center select-none">
        {/* Ambient atmospheric red spotlights */}
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-[#e50914]/20 blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-[#e50914]/25 blur-[120px] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(229,9,20,0.12)_0%,transparent_70%)] pointer-events-none" />

        {/* Centerpiece Branding Card */}
        <div className="relative z-10 max-w-lg space-y-6">
          {/* Glowing Red & White Emblem Badge */}
          <div className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-3xl bg-[#e50914] p-6 shadow-[0_0_60px_rgba(229,9,20,0.55)] ring-4 ring-white/20 transform transition-transform duration-500 hover:scale-105">
            <img
              src="/zigma_logo.webp"
              alt="Zigmaa Wolf Logo"
              className="h-full w-full object-contain drop-shadow-md"
            />
          </div>

          <div className="space-y-2">
            <h2 className="font-display text-4xl font-bold tracking-[0.3em] text-white">
              ZIGMAA
            </h2>
            <p className="font-sans text-xs font-semibold tracking-[0.45em] text-[#e50914] uppercase">
              Photography Studio Platform
            </p>
          </div>

          {/* Red line with diamond */}
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-20 bg-gradient-to-r from-transparent via-[#e50914] to-white/40" />
            <span className="text-xs text-[#e50914]">◆</span>
            <span className="h-px w-20 bg-gradient-to-l from-transparent via-[#e50914] to-white/40" />
          </div>

          <p className="font-display italic text-lg text-white/90 font-light tracking-wide">
            &ldquo;Every Moment Tells a Story&rdquo;
          </p>

          {/* Feature Badges Row */}
          <div className="grid grid-cols-3 gap-3 pt-6 border-t border-white/10 text-white/90">
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm">
              <Camera className="h-5 w-5 text-[#e50914]" />
              <span className="text-xs font-medium tracking-wide">Capture Moments</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm">
              <Sparkles className="h-5 w-5 text-[#e50914]" />
              <span className="text-xs font-medium tracking-wide">AI Face Search</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-sm">
              <Share2 className="h-5 w-5 text-[#e50914]" />
              <span className="text-xs font-medium tracking-wide">Instant Share</span>
            </div>
          </div>
        </div>

        {/* Bottom subtle copyright / branding */}
        <div className="absolute bottom-6 text-[11px] font-medium tracking-widest text-white/40 uppercase">
          Powered by Zigmaa AI Engine
        </div>
      </div>
    </div>
  );
}

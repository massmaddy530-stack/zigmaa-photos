import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Zigmaa Photos" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden bg-[#0d0102] flex items-center justify-center lg:justify-start">
      {/* Full-bleed Luxury Studio Photography Background */}
      <img
        src="/zigmaa-login-hero.png"
        alt="Zigmaa Photography Studio"
        className="absolute inset-0 h-full w-full object-cover object-center select-none pointer-events-none"
      />

      {/* Cinematic subtle contrast vignette & gradient overlays */}
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/65 via-black/30 to-black/10 pointer-events-none" />

      {/* Floating Glassmorphic Login Card positioned to the left (matching the reference design) */}
      <div className="relative z-10 w-full min-h-dvh flex items-center justify-center lg:justify-start px-4 sm:px-8 lg:px-16 xl:px-24 py-8">
        <div className="w-full max-w-[430px] rounded-[32px] border border-white/15 bg-black/50 backdrop-blur-2xl p-7 sm:p-8 shadow-[0_25px_60px_rgba(0,0,0,0.85),-8px_0_35px_rgba(229,9,20,0.28)] ring-1 ring-white/10 transition-all">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · MADX Moments" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-[#fdfbf7] lg:grid-cols-2">
      {/* Left Half: Clean White / Ivory Half (no floating card box) */}
      <div className="flex h-full w-full flex-col justify-center px-6 py-4 sm:px-12 lg:px-14 xl:px-16 overflow-hidden">
        <div className="mx-auto w-full max-w-sm">
          {/* Header Branding: Medallion + MADX MOMENTS */}
          <div className="mb-3.5 flex items-center gap-3.5 border-b border-[#e8dfd1]/80 pb-3 sm:mb-4">
            <img
              src="/login-medallion.png"
              alt="MADX Emblem"
              className="h-10 w-10 shrink-0 rounded-full object-contain drop-shadow sm:h-11 sm:w-11"
            />
            <div className="h-7 w-px bg-[#d5cbbe]" aria-hidden />
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-[0.2em] text-[#241d16] sm:text-base">
                MADX MOMENTS
              </div>
              <div className="font-display text-[10px] italic tracking-wide text-[#7d7061] sm:text-[11px]">
                Capturing Moments, Creating Memories
              </div>
            </div>
          </div>

          {/* Heading & Subtitle */}
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#1c1610] sm:text-[26px]">
              Sign in to your studio
            </h1>
            <p className="mt-0.5 text-xs text-[#786b5b] sm:text-sm">
              Sign in with your admin username and password.
            </p>

            {/* Golden Diamond Divider */}
            <div className="my-2.5 flex items-center justify-center gap-3 sm:my-3">
              <span className="h-px w-12 bg-gradient-to-r from-transparent to-[#cba34f]" aria-hidden />
              <span className="text-[10px] text-[#b88c30]" aria-hidden>◆</span>
              <span className="h-px w-12 bg-gradient-to-l from-transparent to-[#cba34f]" aria-hidden />
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

      {/* Right Half: High-Res Velvet Silk & Gold MADX Photography Hero Image */}
      <div className="relative hidden h-full w-full overflow-hidden bg-[#18080a] lg:block">
        <img
          src="/login-hero.jpg"
          alt="MADX Moments — Every Moment Tells a Story"
          className="h-full w-full object-cover object-center"
        />
      </div>
    </div>
  );
}

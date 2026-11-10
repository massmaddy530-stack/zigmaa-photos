import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · MADX Moments" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid min-h-dvh bg-[#f8f4ec] lg:grid-cols-2">
      {/* Left Column: Form Card with Brand Title */}
      <div className="flex flex-col justify-center px-4 py-8 sm:px-10 lg:px-12 xl:px-16">
        <div className="mx-auto w-full max-w-md rounded-3xl border border-[#e8dfd1] bg-[#faf6ee]/95 p-6 shadow-xl sm:p-10 backdrop-blur-sm">
          {/* Header Branding: Medallion + MADX MOMENTS */}
          <div className="mb-6 flex items-center gap-4 border-b border-[#e8dfd1]/80 pb-5">
            <img
              src="/login-medallion.png"
              alt="MADX Emblem"
              className="h-12 w-12 shrink-0 rounded-full object-contain drop-shadow"
            />
            <div className="h-9 w-px bg-[#d5cbbe]" aria-hidden />
            <div className="min-w-0">
              <div className="font-display text-base font-semibold tracking-[0.2em] text-[#241d16] sm:text-lg">
                MADX MOMENTS
              </div>
              <div className="font-display text-[11px] italic tracking-wide text-[#7d7061] sm:text-xs">
                Capturing Moments, Creating Memories
              </div>
            </div>
          </div>

          {/* Heading & Subtitle */}
          <div className="text-center">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[#1c1610] sm:text-3xl">
              Sign in to your studio
            </h1>
            <p className="mt-1.5 text-xs text-[#786b5b] sm:text-sm">
              Sign in with your admin username and password.
            </p>

            {/* Golden Diamond Divider */}
            <div className="my-5 flex items-center justify-center gap-3">
              <span className="h-px w-14 bg-gradient-to-r from-transparent to-[#cba34f]" aria-hidden />
              <span className="text-[10px] text-[#b88c30]" aria-hidden>◆</span>
              <span className="h-px w-14 bg-gradient-to-l from-transparent to-[#cba34f]" aria-hidden />
            </div>
          </div>

          {/* Form */}
          <div className="mt-4">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Right Column: High-Res Velvet Silk & Gold MADX Photography Hero Image */}
      <div className="relative hidden h-full w-full overflow-hidden bg-[#180a0a] lg:block">
        <img
          src="/login-hero.jpg"
          alt="MADX Moments — Every Moment Tells a Story"
          className="h-full w-full object-cover object-left"
        />
      </div>
    </div>
  );
}

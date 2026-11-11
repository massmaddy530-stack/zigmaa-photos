import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · MADX Photos" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-[#fdfbf7] lg:grid-cols-[46%_54%]">
      {/* Left Half: Clean Solid Ivory / White */}
      <div className="flex h-full w-full flex-col justify-center px-6 py-6 sm:px-10 lg:px-12 xl:px-16 overflow-hidden">
        <div className="mx-auto w-full max-w-[430px] lg:max-w-[450px]">
          {/* Header Branding: Medallion + MADX PHOTOS */}
          <div className="mb-4 flex items-center gap-3.5 border-b border-[#e8dfd1]/80 pb-3 sm:mb-5 sm:pb-3.5">
            <img
              src="/login-medallion.png"
              alt="MADX Emblem"
              className="h-11 w-11 shrink-0 rounded-full object-contain drop-shadow-md sm:h-12 sm:w-12"
            />
            <div className="h-8 w-px bg-[#d5cbbe]" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-display text-base font-semibold tracking-[0.22em] text-[#241d16] sm:text-lg">
                MADX PHOTOS
              </div>
              <div className="font-display text-xs italic tracking-wide text-[#7d7061] sm:text-[13px]">
                Capturing Moments, Creating Memories
              </div>
            </div>
          </div>

          {/* Heading & Subtitle - Centered */}
          <div className="text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#1c150c] sm:text-[34px]">
              Sign in to your studio
            </h1>
            <p className="mt-1 text-sm text-[#7a6c5b] sm:text-[15px]">
              Sign in with your admin username and password.
            </p>

            {/* Golden Diamond Divider */}
            <div className="my-4 flex items-center justify-center gap-3.5 sm:my-5">
              <span className="h-px w-16 bg-gradient-to-r from-transparent via-[#d6a847] to-[#b38421]" aria-hidden="true" />
              <span className="text-xs text-[#b88c30]" aria-hidden="true">◆</span>
              <span className="h-px w-16 bg-gradient-to-l from-transparent via-[#d6a847] to-[#b38421]" aria-hidden="true" />
            </div>
          </div>

          {/* Form */}
          <div className="mt-1">
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
          alt="MADX Photos — Every Moment Tells a Story"
          className="h-full w-full object-cover object-left"
        />
      </div>
    </div>
  );
}

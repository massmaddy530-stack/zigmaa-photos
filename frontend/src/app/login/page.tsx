import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: { absolute: "Sign in · Zigmaa Photos" },
  robots: { index: false },
};

export default async function LoginPage() {
  return (
    <div className="grid h-dvh max-h-dvh w-full overflow-hidden bg-white lg:grid-cols-[420px_1fr] xl:grid-cols-[460px_1fr]">
      {/* Left Column: Sign-in / Reset / Sign-up Forms (Strictly 1-page fit, no scroll) */}
      <div className="flex h-full w-full flex-col justify-center px-6 sm:px-8 lg:px-10 overflow-hidden bg-white">
        <div className="mx-auto w-full max-w-[370px]">
          {/* Brand Logo header from the exact user image (Red wolf + ZIGMAA PHOTOS + Camera + Subtitle) */}
          <div className="mb-2 text-center">
            <img
              src="/zigmaa-brand-logo.png"
              alt="Zigmaa Photos - Event Photo Management Platform"
              className="mx-auto h-16 sm:h-20 w-auto object-contain"
            />
          </div>

          {/* Dynamic In-place Form (Sign in to your studio / Reset password / Create account) */}
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>

      {/* Right Column: Hero Graphic from the exact user mockup (Red Swoosh + Dashboard Laptop + Feature Icons) */}
      <div className="relative hidden h-full w-full overflow-hidden bg-[#0d0102] lg:block select-none">
        <img
          src="/login-hero-2x.jpg"
          alt="Zigmaa Photos Studio Platform"
          className="h-full w-full object-cover object-left"
        />
      </div>
    </div>
  );
}

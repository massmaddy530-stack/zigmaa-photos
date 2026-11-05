import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/app-shell";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { googleConfig } from "@/lib/server-config";
import { LoginForm } from "./login-form";

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

// Generic messages for the Google callback: they never reveal which check failed or whether an email is allowed.
const GOOGLE_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't complete. Try again, or sign in with your username and password.",
  google_unavailable: "Google sign-in isn't available right now. Sign in with your username and password.",
};

// `absolute` skips the root template ("… · ZigMaa Photos"): the admin sign-in carries the Everframe name.
export const metadata: Metadata = { title: { absolute: "Sign in · Everframe" }, robots: { index: false } };

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const errorKey = typeof sp.error === "string" ? sp.error : "";
  const googleError = GOOGLE_ERRORS[errorKey];
  // Shown only when every Google setting is present and valid; the start route re-checks and sanitizes `next`.
  const googleEnabled = googleConfig() !== null;
  const next = typeof sp.next === "string" ? sp.next : "";
  const googleHref = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12 lg:py-4">
        <Logo admin />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12 lg:py-2">
          <h1 className="font-display text-3xl font-medium">Sign in to your studio</h1>
          <span className="mt-3 block h-px w-12 bg-brand-400 lg:mt-2" aria-hidden />
          <p className="mt-2 text-sm text-muted">Sign in with your admin username and password.</p>
          {googleError && <Alert tone="error" className="mt-6">{googleError}</Alert>}
          <Suspense>
            <LoginForm />
          </Suspense>
          {/* No self-service reset exists (the admin account is defined in the server environment): a native
              disclosure shows a message only. No form, no request, no email. */}
          <div className="mt-3 flex items-start gap-4 text-sm">
            <details className="group min-w-0 flex-1">
              <summary className="w-fit cursor-pointer list-none rounded font-medium text-brand-700 hover:text-brand-800 [&::-webkit-details-marker]:hidden">
                Forgot password?
              </summary>
              <p className="mt-1.5 rounded-lg bg-brand-50 px-3 py-2 text-muted ring-1 ring-inset ring-brand-200">
                Password reset is not set up yet. Please contact the site owner.
              </p>
            </details>
            {/* Registration is not implemented (single admin account): visible but disabled, so it cannot navigate
                anywhere or create an account. */}
            <button type="button" disabled title="Sign up isn't available yet" aria-describedby="signup-unavailable"
                    className="shrink-0 rounded font-medium text-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
              Sign up
            </button>
            <span id="signup-unavailable" className="sr-only">Sign up isn&apos;t available yet.</span>
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </div>
          {googleEnabled ? (
            // A plain link to the server route (not client-side navigation): the server performs the OAuth flow.
            <a href={googleHref} className={buttonClass("outline", "md", "mt-3 w-full")}>
              {GOOGLE_ICON}
              Continue with Google
            </a>
          ) : (
            // Not configured yet: shown for layout only. Disabled, so it cannot start a sign-in or navigate anywhere.
            <>
              <button type="button" disabled aria-describedby="google-setup-note" className={buttonClass("outline", "md", "mt-3 w-full")}>
                {GOOGLE_ICON}
                Continue with Google
              </button>
              <p id="google-setup-note" className="mt-1.5 text-center text-xs text-muted">Google Sign-In setup coming soon</p>
            </>
          )}
          <p className="mt-3 text-[11px] leading-snug text-muted">
            Your password is checked on the server. This browser only keeps a signed, httpOnly session cookie that
            expires after 12 hours.
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-950 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--color-brand-500)_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_left,_var(--color-brand-700)_0%,_transparent_50%)] opacity-70" />
        {/* The decorative grid also scales with viewport height (max 28rem wide, as before), so the panel never forces
            the page taller than a short laptop viewport. Same nine empty boxes; nothing is clipped. */}
        <div className="relative flex h-full flex-col justify-end p-10 text-white xl:p-12">
          <div className="mb-8 grid w-full max-w-[max(8rem,min(28rem,calc(80dvh_-_15rem)))] grid-cols-3 gap-3 opacity-90" aria-hidden>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className={`aspect-[4/5] rounded-2xl border border-white/10 ${i % 4 === 0 ? "bg-white/20" : "bg-white/[0.07]"}`} />
            ))}
          </div>
          <p className="max-w-md font-display text-3xl font-medium leading-snug">
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

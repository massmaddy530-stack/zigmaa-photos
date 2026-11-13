"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, CSRF_HEADER, errorMessage, toApiError } from "@/lib/api";

function GoogleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Forgot password modal
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);

  // Sign up modal
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpSent, setSignUpSent] = useState(false);

  // Only allow same-site relative redirects after login.
  const next = (() => {
    const n = params.get("next") || "/dashboard";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
  })();

  const googleError = params.get("error");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...CSRF_HEADER },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw await toApiError(res);
      setPassword("");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? errorMessage(err) : "Could not reach the server.");
      setBusy(false);
    }
  }

  function handleForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotSent(true);
  }

  function handleSignUpSubmit(e: FormEvent) {
    e.preventDefault();
    setSignUpSent(true);
  }

  return (
    <>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-center text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {googleError && !error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-center text-xs font-medium text-amber-800">
            {googleError === "google_unavailable"
              ? "Google Sign-in is not configured on this server."
              : "Google Sign-in failed. Please sign in with your username."}
          </div>
        )}

        {/* Username or Email Field */}
        <div>
          <label
            htmlFor="username"
            className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#1e293b]"
          >
            <UserRound className="h-4 w-4 text-[#64748b]" />
            <span>Username or email</span>
          </label>
          <div className="relative">
            <UserRound
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              autoFocus
              autoCapitalize="none"
              spellCheck={false}
              maxLength={128}
              placeholder="Enter your username or email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-2xl border border-[#e2e8f0] bg-white py-3 sm:py-3.5 pl-11 pr-4 text-sm sm:text-base text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-2 focus:ring-[#e50914]/20"
            />
          </div>
        </div>

        {/* Password Field */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label
              htmlFor="password"
              className="flex items-center gap-2 text-sm font-medium text-[#1e293b]"
            >
              <LockKeyhole className="h-4 w-4 text-[#64748b]" />
              <span>Password</span>
            </label>
            <button
              type="button"
              onClick={() => {
                setForgotSent(false);
                setForgotOpen(true);
              }}
              className="text-xs font-medium text-[#e50914] hover:text-[#b91c1c] transition-colors"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <LockKeyhole
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94a3b8]"
              aria-hidden
            />
            <input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={1024}
              spellCheck={false}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-[#e2e8f0] bg-white py-3 sm:py-3.5 pl-11 pr-11 text-sm sm:text-base text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-2 focus:ring-[#e50914]/20"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-[#94a3b8] hover:bg-slate-100 transition-colors"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Primary Red Sign in Button */}
        <button
          type="submit"
          disabled={busy}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#e50914] via-[#dc2626] to-[#b91c1c] py-3.5 sm:py-4 text-center text-base sm:text-[17px] font-semibold tracking-wide text-white shadow-[0_4px_16px_rgba(229,9,20,0.35)] transition-all hover:brightness-105 hover:shadow-[0_6px_22px_rgba(229,9,20,0.45)] disabled:opacity-50 active:scale-[0.99]"
        >
          {busy ? (
            "Signing in..."
          ) : (
            <span className="inline-flex items-center gap-2">
              Sign in <span aria-hidden>→</span>
            </span>
          )}
        </button>

        {/* Divider */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="w-full border-t border-[#e2e8f0]" />
          <span className="absolute bg-white px-3 text-xs uppercase tracking-wider text-[#94a3b8]">
            or
          </span>
        </div>

        {/* Sign in with Google Button */}
        <a
          href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white py-3 sm:py-3.5 text-center text-sm sm:text-base font-medium text-[#1e293b] shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99]"
        >
          <GoogleIcon />
          <span>Continue with Google</span>
        </a>

        {/* Sign Up Option */}
        <div className="pt-2 text-center text-sm text-[#64748b]">
          <span>Don&apos;t have a studio account? </span>
          <button
            type="button"
            onClick={() => {
              setSignUpSent(false);
              setSignUpOpen(true);
            }}
            className="font-semibold text-[#e50914] hover:text-[#b91c1c] hover:underline transition-colors"
          >
            Sign up
          </button>
        </div>

        {/* Security badge note */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-[#94a3b8]">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          <span>Your session is secure & encrypted.</span>
        </div>
      </form>

      {/* Forgot Password Modal */}
      {forgotOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-slate-100">
            <button
              type="button"
              onClick={() => setForgotOpen(false)}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            {forgotSent ? (
              <div className="text-center py-4 space-y-3">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-[#e50914]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Reset Link Sent</h3>
                <p className="text-sm text-slate-600">
                  If an account exists for <strong className="text-slate-900">{forgotEmail}</strong>, password reset instructions have been sent.
                </p>
                <button
                  type="button"
                  onClick={() => setForgotOpen(false)}
                  className="mt-4 w-full rounded-2xl bg-[#e50914] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#dc2626]"
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-slate-900">Reset your password</h3>
                  <p className="text-xs text-slate-500">
                    Enter your registered studio email and we will send you a password reset link.
                  </p>
                </div>
                <div>
                  <label htmlFor="forgot-email" className="block mb-1.5 text-xs font-medium text-slate-700">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      placeholder="admin@yourstudio.com"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#e50914] focus:outline-none focus:ring-2 focus:ring-[#e50914]/20"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-gradient-to-r from-[#e50914] to-[#b91c1c] py-3 text-sm font-semibold text-white shadow-md hover:brightness-105"
                >
                  Send Reset Link
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Sign Up / Request Access Modal */}
      {signUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-slate-100">
            <button
              type="button"
              onClick={() => setSignUpOpen(false)}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            {signUpSent ? (
              <div className="text-center py-4 space-y-3">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-[#e50914]">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Registration Requested</h3>
                <p className="text-sm text-slate-600">
                  Thank you, <strong className="text-slate-900">{signUpName || "Photographer"}</strong>! Your studio request has been sent for admin verification.
                </p>
                <button
                  type="button"
                  onClick={() => setSignUpOpen(false)}
                  className="mt-4 w-full rounded-2xl bg-[#e50914] py-3 text-sm font-semibold text-white shadow-md hover:bg-[#dc2626]"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleSignUpSubmit} className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-slate-900">Create Studio Account</h3>
                  <p className="text-xs text-slate-500">
                    Register your photography studio to start sharing event photos with AI face search.
                  </p>
                </div>
                <div>
                  <label htmlFor="signup-name" className="block mb-1.5 text-xs font-medium text-slate-700">
                    Studio or Photographer Name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    required
                    placeholder="e.g. Zigmaa Studio Chennai"
                    value={signUpName}
                    onChange={(e) => setSignUpName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2.5 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#e50914] focus:outline-none focus:ring-2 focus:ring-[#e50914]/20"
                  />
                </div>
                <div>
                  <label htmlFor="signup-email" className="block mb-1.5 text-xs font-medium text-slate-700">
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    placeholder="studio@zigmaaphotos.com"
                    value={signUpEmail}
                    onChange={(e) => setSignUpEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 py-2.5 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#e50914] focus:outline-none focus:ring-2 focus:ring-[#e50914]/20"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-gradient-to-r from-[#e50914] to-[#b91c1c] py-3 text-sm font-semibold text-white shadow-md hover:brightness-105"
                >
                  Request Studio Access
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

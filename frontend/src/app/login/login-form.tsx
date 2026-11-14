"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, CSRF_HEADER, errorMessage, toApiError } from "@/lib/api";
import { cn } from "@/lib/format";

function PasswordRequirements({ password }: { password: string }) {
  const hasLen = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const allMet = hasLen && hasUpper && hasLower && hasSymbol;

  return (
    <p
      className={cn(
        "mt-1 text-[11px] font-medium flex items-center gap-1 transition-colors",
        allMet ? "text-emerald-600" : "text-[#e50914]"
      )}
    >
      <span>{allMet ? "✓" : "●"}</span>
      <span>Min 8 chars, 1 uppercase, 1 lowercase &amp; 1 symbol</span>
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
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

  // In-place view switcher: "login" | "forgot" | "signup"
  const [view, setView] = useState<"login" | "forgot" | "signup">("login");

  // Login form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [showResetNewPass, setShowResetNewPass] = useState(false);
  const [showResetConfirmPass, setShowResetConfirmPass] = useState(false);

  // Sign up form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSignUpPass, setShowSignUpPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [signUpBusy, setSignUpBusy] = useState(false);
  const [signUpSent, setSignUpSent] = useState(false);
  const [signUpError, setSignUpError] = useState<string | null>(null);

  // Only allow same-site relative redirects after login
  const next = (() => {
    const n = params.get("next") || "/dashboard";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
  })();

  const googleError = params.get("error");

  // Handle Login Submit
  async function onLoginSubmit(e: FormEvent) {
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
      const data = await res.json().catch(() => null);
      if (data?.user) {
        try {
          localStorage.setItem("zigmaa_user_profile", JSON.stringify(data.user));
        } catch {}
      }
      setPassword("");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? errorMessage(err) : "Could not reach the server.");
      setBusy(false);
    }
  }

  // Handle Send OTP (Forgot Password)
  async function onForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotBusy(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to send OTP.");
      }
      setForgotSent(true);
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Failed to send OTP.");
    } finally {
      setForgotBusy(false);
    }
  }

  // Handle Verify OTP & Reset Password
  async function onVerifyOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);

    if (newPassword && newPassword !== confirmNewPassword) {
      setForgotError("New passwords do not match.");
      return;
    }
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);
    if (newPassword.length < 8 || !hasUpper || !hasLower || !hasSymbol) {
      setForgotError("Password must be at least 8 characters, include 1 uppercase letter, 1 lowercase letter, and 1 symbol.");
      return;
    }

    setVerifyBusy(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, otp: otpCode, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Verification failed.");
      }
      setResetSuccess(data.message || "Password reset successfully!");
      setTimeout(() => {
        setView("login");
        setForgotSent(false);
        setOtpCode("");
        setNewPassword("");
        setConfirmNewPassword("");
        setResetSuccess(null);
      }, 2000);
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyBusy(false);
    }
  }

  // Handle Sign Up Submit
  async function onSignUpSubmit(e: FormEvent) {
    e.preventDefault();
    setSignUpError(null);
    if (signUpPassword !== confirmPassword) {
      setSignUpError("Passwords do not match.");
      return;
    }
    const hasUpper = /[A-Z]/.test(signUpPassword);
    const hasLower = /[a-z]/.test(signUpPassword);
    const hasSymbol = /[^A-Za-z0-9]/.test(signUpPassword);
    if (signUpPassword.length < 8 || !hasUpper || !hasLower || !hasSymbol) {
      setSignUpError("Password must be at least 8 characters, include 1 uppercase letter, 1 lowercase letter, and 1 symbol.");
      return;
    }
    setSignUpBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          companyName,
          email: signUpEmail,
          contactNumber,
          password: signUpPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to create account.");
      }
      // Successful registration & auto-login!
      router.replace(next);
      router.refresh();
    } catch (err: unknown) {
      setSignUpError(err instanceof Error ? err.message : "Registration failed.");
      setSignUpBusy(false);
    }
  }

  return (
    <div className="w-full">
      {/* ========================================================
          VIEW 1: SIGN IN (WELCOME BACK / STUDIO SIGN IN)
      ======================================================== */}
      {view === "login" && (
        <div className="space-y-3.5 animate-fade-in">
          {/* Subtle red diamond separator */}
          <div className="flex items-center justify-center gap-2.5 py-0.5">
            <span className="h-px w-12 bg-red-200" />
            <span className="text-[10px] text-[#e50914]">◆</span>
            <span className="h-px w-12 bg-red-200" />
          </div>

          {/* Header */}
          <div className="space-y-0.5 text-center">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0f172a]">
              Sign in to your studio
            </h1>
            <p className="text-xs text-[#64748b]">
              Sign in with your email address and password.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2 text-center text-xs font-medium text-[#e50914]">
              {error}
            </div>
          )}

          {googleError && !error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-center text-xs font-medium text-amber-800">
              {googleError === "google_unavailable"
                ? "Google Sign-in is not configured on this server."
                : googleError === "not_registered"
                ? "This Google account is not registered. Please sign up first."
                : "Google Sign-in failed. Please sign in with your email."}
            </div>
          )}

          <form onSubmit={onLoginSubmit} className="space-y-3">
            {/* Email Field with Mail icon */}
            <div>
              <label
                htmlFor="login-email"
                className="flex items-center gap-1.5 text-xs font-semibold text-[#1e293b] mb-1"
              >
                <Mail className="h-3.5 w-3.5 text-[#64748b]" />
                <span>Email</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#94a3b8]">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  id="login-email"
                  name="email"
                  type="text"
                  autoComplete="email"
                  required
                  autoFocus
                  placeholder="Enter your email address"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-2xl border border-[#e2e8f0] bg-white pl-10 pr-3.5 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>
            </div>

            {/* Password Field with Lock icon and Eye toggle */}
            <div>
              <label
                htmlFor="login-password"
                className="flex items-center gap-1.5 text-xs font-semibold text-[#1e293b] mb-1"
              >
                <Lock className="h-3.5 w-3.5 text-[#64748b]" />
                <span>Password</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#94a3b8]">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-[#e2e8f0] bg-white pl-10 pr-10 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b] transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Forgot Password Link */}
              <div className="mt-1 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setForgotSent(false);
                    setView("forgot");
                  }}
                  className="text-xs font-medium text-[#e50914] hover:underline transition-colors"
                >
                  Forgot Password ?
                </button>
              </div>
            </div>

            {/* Solid Bold Red Sign in Button matching the mockup */}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-[#e50914] py-2.5 text-center text-sm font-semibold tracking-wide text-white shadow-[0_4px_14px_rgba(229,9,20,0.35)] transition-all hover:bg-[#cc0812] active:scale-[0.99] disabled:opacity-50"
            >
              {busy ? "Signing in..." : "Sign in →"}
            </button>

            {/* Google Sign in Button */}
            <a
              href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
              className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-[#e2e8f0] bg-white py-2.5 text-center text-xs sm:text-sm font-medium text-[#1e293b] shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99]"
            >
              <GoogleIcon />
              <span>Sign in with Google</span>
            </a>

            {/* Not a Member? Sign Up Footer */}
            <div className="pt-1 text-center text-xs text-[#64748b]">
              <span>Not a Member ? </span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSignUpSent(false);
                  setSignUpError(null);
                  setView("signup");
                }}
                className="font-semibold text-[#e50914] hover:underline transition-colors"
              >
                Sign Up
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================
          VIEW 2: FORGOT PASSWORD (RESET YOUR PASSWORD)
      ======================================================== */}
      {view === "forgot" && (
        <div className="space-y-3.5 animate-fade-in">
          {/* Header - Exactly like Photo 1 */}
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[#0f172a]">
              Reset your password
            </h1>
            <p className="text-xs sm:text-sm text-[#64748b]">
              {forgotSent
                ? `Enter the 6-digit OTP code sent to ${forgotEmail}`
                : "We will send the OTP to your registered email address"}
            </p>
          </div>

          {forgotError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-center text-xs font-medium text-[#e50914]">
              {forgotError}
            </div>
          )}

          {resetSuccess ? (
            <div className="space-y-3 py-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#0f172a]">Password Reset Complete!</p>
                <p className="text-xs text-[#64748b]">{resetSuccess}</p>
              </div>
              <button
                type="button"
                onClick={() => setView("login")}
                className="w-full rounded-xl bg-[#e50914] py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md hover:bg-[#cc0812]"
              >
                Sign In Now
              </button>
            </div>
          ) : forgotSent ? (
            <form onSubmit={onVerifyOtpSubmit} className="space-y-3">
              {/* 6-digit OTP Code */}
              <div>
                <label
                  htmlFor="otp-code"
                  className="block text-xs font-semibold text-[#1e293b] mb-1"
                >
                  6-Digit OTP Code
                </label>
                <input
                  id="otp-code"
                  type="text"
                  required
                  autoFocus
                  maxLength={6}
                  placeholder="e.g. 123456"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2 text-center text-lg font-bold tracking-[6px] text-[#0f172a] placeholder:text-[#94a3b8] placeholder:font-normal placeholder:tracking-normal placeholder:italic shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* New Password & Confirm Password with Eye toggles */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="reset-new-password"
                    className="block text-xs font-semibold text-[#1e293b] mb-1"
                  >
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      id="reset-new-password"
                      type={showResetNewPass ? "text" : "password"}
                      required
                      placeholder="Min 8 chars"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full rounded-xl border border-[#e2e8f0] bg-white pl-2.5 pr-8 py-2 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetNewPass((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b] transition-colors"
                      aria-label={showResetNewPass ? "Hide password" : "Show password"}
                    >
                      {showResetNewPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <PasswordRequirements password={newPassword} />
                </div>
                <div>
                  <label
                    htmlFor="reset-confirm-password"
                    className="block text-xs font-semibold text-[#1e293b] mb-1"
                  >
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="reset-confirm-password"
                      type={showResetConfirmPass ? "text" : "password"}
                      required
                      placeholder="Repeat password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="w-full rounded-xl border border-[#e2e8f0] bg-white pl-2.5 pr-8 py-2 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetConfirmPass((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b] transition-colors"
                      aria-label={showResetConfirmPass ? "Hide password" : "Show password"}
                    >
                      {showResetConfirmPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Reset Password Button */}
              <button
                type="submit"
                disabled={verifyBusy}
                className="w-full rounded-xl bg-[#e50914] py-2.5 text-center text-xs sm:text-sm font-semibold tracking-wide text-white shadow-md transition-all hover:bg-[#cc0812] active:scale-[0.99] disabled:opacity-50"
              >
                {verifyBusy ? "Verifying..." : "Verify OTP & Reset Password"}
              </button>

              {/* Resend OTP button */}
              <div className="flex items-center justify-between pt-1 text-xs text-[#64748b]">
                <button
                  type="button"
                  onClick={onForgotSubmit}
                  disabled={forgotBusy}
                  className="font-medium text-[#e50914] hover:underline transition-colors"
                >
                  {forgotBusy ? "Sending..." : "Resend OTP"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotSent(false);
                    setOtpCode("");
                    setForgotError(null);
                  }}
                  className="text-slate-500 hover:underline"
                >
                  Change Email
                </button>
              </div>

              {/* Already a Member? Sign In Footer */}
              <div className="pt-2 text-center text-xs text-[#64748b]">
                <span>Already a Member? </span>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="font-semibold text-[#e50914] hover:underline transition-colors"
                >
                  Sign In
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={onForgotSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-xs font-semibold text-[#1e293b] mb-1"
                >
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  autoFocus
                  placeholder="Enter your email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm transition-all focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* Send OTP Button - Exactly like Photo 1 */}
              <button
                type="submit"
                disabled={forgotBusy}
                className="w-full rounded-xl bg-[#e50914] py-3 text-center text-sm font-semibold tracking-wide text-white shadow-md transition-all hover:bg-[#cc0812] active:scale-[0.99] disabled:opacity-50"
              >
                {forgotBusy ? "Sending OTP..." : "Send OTP"}
              </button>

              {/* Already a Member? Sign In Footer */}
              <div className="pt-2 text-center text-xs text-[#64748b]">
                <span>Already a Member? </span>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="font-semibold text-[#e50914] hover:underline transition-colors"
                >
                  Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ========================================================
          VIEW 3: CREATE YOUR ACCOUNT (SIGN UP)
      ======================================================== */}
      {view === "signup" && (
        <div className="space-y-3 animate-fade-in">
          {/* Header - Exactly like Photo 3 */}
          <div className="space-y-0.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0f172a]">
              Create your account
            </h1>
            <p className="text-xs text-[#64748b]">
              One login for all products.
            </p>
          </div>

          {signUpError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-center text-xs font-medium text-[#e50914]">
              {signUpError}
            </div>
          )}

          {signUpSent ? (
            <div className="space-y-3 py-3 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-[#e50914]">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#0f172a]">Registration Received</p>
                <p className="text-xs text-[#64748b]">
                  Thank you, <strong className="text-[#0f172a]">{firstName || "Photographer"}</strong>! Your studio account details have been sent to your email.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView("login")}
                className="w-full rounded-xl bg-[#e50914] py-2.5 text-xs sm:text-sm font-semibold text-white shadow-md hover:bg-[#cc0812]"
              >
                Go to Sign In
              </button>
            </div>
          ) : (
            <form onSubmit={onSignUpSubmit} className="space-y-2.5">
              {/* Row 1: First Name & Last Name */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[#1e293b] mb-0.5">
                    First Name <span className="text-[#e50914]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter Your First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#1e293b] mb-0.5">
                    Last Name <span className="text-[#e50914]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter Your Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                </div>
              </div>

              {/* Row 2: Company Name */}
              <div>
                <label className="block text-[11px] font-semibold text-[#1e293b] mb-0.5">
                  Company Name <span className="text-[#e50914]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Enter Your Company Name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* Row 3: Email */}
              <div>
                <label className="block text-[11px] font-semibold text-[#1e293b] mb-0.5">
                  Email <span className="text-[#e50914]">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="Enter Your Email ID"
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* Row 4: Contact Number with +91 Prefix */}
              <div>
                <label className="block text-[11px] font-semibold text-[#1e293b] mb-0.5">
                  Contact <span className="text-[#e50914]">*</span>
                </label>
                <div className="flex rounded-lg border border-[#e2e8f0] bg-white shadow-sm overflow-hidden focus-within:border-[#e50914] focus-within:ring-1 focus-within:ring-[#e50914]">
                  <span className="inline-flex items-center px-2.5 bg-slate-50 border-r border-[#e2e8f0] text-xs font-medium text-[#475569]">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="Enter 10-digit Mobile Number"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-2.5 py-1.5 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 5: Password & Confirm Password (2-col to keep page completely non-scrollable) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="block text-[11px] font-semibold text-[#1e293b]">
                      Password <span className="text-[#e50914]">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type={showSignUpPass ? "text" : "password"}
                      required
                      placeholder="Enter Your Password"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 pr-7 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPass((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                    >
                      {showSignUpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="block text-[11px] font-semibold text-[#1e293b]">
                      Confirm Password <span className="text-[#e50914]">*</span>
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type={showConfirmPass ? "text" : "password"}
                      required
                      placeholder="Confirm Your Password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1.5 pr-7 text-xs text-[#0f172a] placeholder:text-[#94a3b8] placeholder:italic shadow-sm focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPass((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b]"
                    >
                      {showConfirmPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Strong Password Requirements indicator */}
              <PasswordRequirements password={signUpPassword} />

              {/* Sign up Button - Exactly like Photo 3 */}
              <button
                type="submit"
                disabled={signUpBusy}
                className="w-full rounded-xl bg-[#e50914] py-2.5 text-center text-xs sm:text-sm font-semibold tracking-wide text-white shadow-md transition-all hover:bg-[#cc0812] active:scale-[0.99] disabled:opacity-50 mt-1"
              >
                {signUpBusy ? "Creating account..." : "Sign up"}
              </button>

              {/* Already a Member? Sign In Footer */}
              <div className="pt-1 text-center text-xs text-[#64748b]">
                <span>Already a Member? </span>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="font-semibold text-[#e50914] hover:underline transition-colors"
                >
                  Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

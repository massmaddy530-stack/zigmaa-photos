"use client";

import { useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState, useRef, type FormEvent } from "react";
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
        "mt-1 text-[10px] sm:text-[11px] font-medium flex items-center gap-1 transition-colors",
        allMet ? "text-emerald-400" : "text-red-400"
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

function BrandHeader() {
  return (
    <div className="mb-4 text-center select-none flex flex-col items-center">
      <div className="relative flex items-center justify-center">
        {/* Soft atmospheric ambient glow behind the logo */}
        <div className="absolute inset-0 -m-4 rounded-full bg-red-600/20 blur-xl pointer-events-none" />
        <img
          src="/zigmaa-logo.png"
          alt="Zigmaa Moments"
          width={260}
          height={100}
          style={{ width: "auto", height: "auto" }}
          className="relative mx-auto h-16 sm:h-[76px] w-auto max-w-[250px] sm:max-w-[270px] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.85)] drop-shadow-[0_0_14px_rgba(229,9,20,0.4)]"
        />
      </div>
      <p className="mt-2.5 text-xs font-medium tracking-wide text-white/80">
        Event Photo Management Platform
      </p>
      <div className="flex items-center justify-center gap-3 my-3.5 w-full">
        <span className="h-px w-10 bg-white/20" />
        <span className="h-1.5 w-1.5 rotate-45 bg-[#e50914]" />
        <span className="h-px w-10 bg-white/20" />
      </div>
    </div>
  );
}

export function LoginForm() {
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
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [otpVerified, setOtpVerified] = useState(false);
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);
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
      window.location.href = next;
    } catch (err) {
      setPassword("");
      setError(err instanceof ApiError ? errorMessage(err) : "Could not reach the server.");
      setBusy(false);
    }
  }

  // Handle OTP digit box changes
  function handleOtpChange(index: number, val: string) {
    const clean = val.replace(/\D/g, "");
    if (clean.length > 1) {
      // Pasted or typed multi-character string
      const chars = clean.slice(0, 6).split("");
      const nextDigits = [...otpDigits];
      chars.forEach((c, i) => {
        if (index + i < 6) nextDigits[index + i] = c;
      });
      setOtpDigits(nextDigits);
      const focusTarget = Math.min(5, index + chars.length);
      otpInputsRef.current[focusTarget]?.focus();
      return;
    }

    const nextDigits = [...otpDigits];
    nextDigits[index] = clean;
    setOtpDigits(nextDigits);

    if (clean && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      if (!otpDigits[index] && index > 0) {
        otpInputsRef.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const nextDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = pasted[i] || "";
    }
    setOtpDigits(nextDigits);
    const focusTarget = Math.min(5, pasted.length);
    otpInputsRef.current[focusTarget]?.focus();
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
      setOtpVerified(false);
      setOtpDigits(["", "", "", "", "", ""]);
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 50);
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Failed to send OTP.");
    } finally {
      setForgotBusy(false);
    }
  }

  // Handle Resend OTP
  async function onResendOtp() {
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
        throw new Error(data.error || "Failed to resend OTP.");
      }
      setOtpDigits(["", "", "", "", "", ""]);
      otpInputsRef.current[0]?.focus();
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Failed to resend OTP.");
    } finally {
      setForgotBusy(false);
    }
  }

  // Step 1: Handle Verify OTP (Image 1)
  async function onVerifyOtpCode(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    const code = otpDigits.join("");
    if (code.length !== 6) {
      setForgotError("Please enter all 6 digits of the OTP code.");
      return;
    }

    setVerifyBusy(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, otp: code }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Invalid verification code.");
      }
      setOtpVerified(true);
      setForgotError(null);
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifyBusy(false);
    }
  }

  // Step 2: Handle Set New Password (Image 2)
  async function onUpdatePassword(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);

    if (newPassword !== confirmNewPassword) {
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
      const code = otpDigits.join("");
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, otp: code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Password update failed.");
      }
      setResetSuccess(data.message || "Your password has been reset successfully. You can now log in.");
    } catch (err: unknown) {
      setForgotError(err instanceof Error ? err.message : "Failed to update password.");
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
      window.location.href = next;
    } catch (err: unknown) {
      setSignUpError(err instanceof Error ? err.message : "Registration failed.");
      setSignUpBusy(false);
    }
  }

  return (
    <div className="w-full">
      {/* ========================================================
          VIEW 1: SIGN IN (STUDIO SIGN IN)
          Matches user's reference mockup (Image 2)
      ======================================================== */}
      {view === "login" && (
        <div className="space-y-4 animate-fade-in">
          {/* Brand Logo, Tagline & Diamond Separator */}
          <BrandHeader />

          {/* Heading */}
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Sign in to your studio
            </h1>
            <p className="text-xs text-white/60">
              Sign in with your email address and password.
            </p>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-2.5 text-center text-xs font-medium text-red-300">
              {error}
            </div>
          )}

          {googleError && !error && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-center text-xs font-medium text-amber-200 shadow-sm space-y-1">
              <div className="font-semibold text-amber-100 flex items-center justify-center gap-1.5">
                <span>⚠️</span>
                <span>
                  {googleError === "google_unavailable"
                    ? "Google Sign-In Unavailable"
                    : "Account Not Registered"}
                </span>
              </div>
              <p className="text-[11px] text-amber-200/80 leading-snug">
                {googleError === "google_unavailable"
                  ? "Google sign-in is not configured on this server."
                  : "This Google account is not registered with Zigmaa Moments. Only registered studio accounts can sign in."}
              </p>
              {googleError !== "google_unavailable" && (
                <button
                  type="button"
                  onClick={() => {
                    setView("signup");
                    setError(null);
                  }}
                  className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 underline cursor-pointer"
                >
                  Create an account now →
                </button>
              )}
            </div>
          )}

          <form onSubmit={onLoginSubmit} className="space-y-3.5">
            {/* Email Field - Pill with Mail Icon */}
            <div>
              <label htmlFor="login-email" className="sr-only">
                Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/50">
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
                  className="w-full rounded-full border border-white/15 bg-white/[0.07] hover:bg-white/[0.1] pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/40 shadow-inner transition-all focus:border-[#e50914] focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>
            </div>

            {/* Password Field - Pill with Lock Icon and Eye Toggle */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="sr-only">
                Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/50">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-full border border-white/15 bg-white/[0.07] hover:bg-white/[0.1] pl-11 pr-11 py-3 text-sm text-white placeholder:text-white/40 shadow-inner transition-all focus:border-[#e50914] focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Forgot Password Link - Right Aligned (matches Image 2) */}
              <div className="text-right pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setForgotSent(false);
                    setView("forgot");
                  }}
                  className="text-xs font-medium text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
                >
                  Forgot Password ?
                </button>
              </div>
            </div>

            {/* Glowing Red Pill Button: Sign In → */}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-center text-sm font-semibold tracking-wide text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
            >
              {busy ? "Signing in..." : "Sign In →"}
            </button>

            {/* Translucent Dark Pill Button: Sign in with Google */}
            <a
              href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
              className="flex w-full items-center justify-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] py-3 text-center text-sm font-medium text-white shadow-sm transition-all active:scale-[0.99]"
            >
              <GoogleIcon />
              <span>Sign in with Google</span>
            </a>

            {/* Footer: Not a Member ? Sign Up */}
            <div className="pt-2 text-center text-xs text-white/60">
              <span>Not a Member ? </span>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSignUpSent(false);
                  setSignUpError(null);
                  setView("signup");
                }}
                className="font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
              >
                Sign Up
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================
          VIEW 2: FORGOT PASSWORD (RESET YOUR PASSWORD)
          Matches Image 1 (Step 1: OTP with 6 individual boxes)
          and Image 2 (Step 2: Password setup after verification)
      ======================================================== */}
      {view === "forgot" && (
        <div className="space-y-4 animate-fade-in">
          {/* Top Green Notification Banner if OTP was sent / verified */}
          {forgotSent && !otpVerified && !resetSuccess && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 sm:p-3 text-xs text-emerald-300 flex items-center justify-between gap-2 shadow-sm animate-fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="leading-tight">
                  Verification code sent successfully to <strong className="text-white font-medium">{forgotEmail}</strong>
                </span>
              </div>
            </div>
          )}

          {forgotSent && otpVerified && !resetSuccess && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5 sm:p-3 text-xs text-emerald-300 flex items-center gap-2 shadow-sm animate-fade-in">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="leading-tight">Code verified! Please enter your new password below.</span>
            </div>
          )}

          {/* Brand Logo, Tagline & Diamond Separator */}
          <BrandHeader />

          {/* Header */}
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Reset your password
            </h1>
            <p className="text-xs text-white/60">
              {forgotSent
                ? "We've sent the 6 Digit OTP to your registered email address."
                : "We will send the 6 Digit OTP to your registered email address."}
            </p>
          </div>

          {forgotError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-2.5 text-center text-xs font-medium text-red-300">
              {forgotError}
            </div>
          )}

          {resetSuccess ? (
            /* Success State */
            <div className="space-y-4 py-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Password Reset Complete!</p>
                <p className="text-xs text-white/60">{resetSuccess}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setView("login");
                  setForgotSent(false);
                  setOtpVerified(false);
                  setOtpDigits(["", "", "", "", "", ""]);
                  setResetSuccess(null);
                }}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-sm font-semibold text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] hover:brightness-110 cursor-pointer"
              >
                Sign In Now →
              </button>
            </div>
          ) : !forgotSent ? (
            /* Initial State: Enter Email to Send OTP */
            <form onSubmit={onForgotSubmit} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-xs font-semibold text-white/80 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-white/50">
                    <Mail className="h-4 w-4" />
                  </div>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    autoFocus
                    placeholder="Enter your email address"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    className="w-full rounded-full border border-white/15 bg-white/[0.07] hover:bg-white/[0.1] pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/40 shadow-inner transition-all focus:border-[#e50914] focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={forgotBusy}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-center text-sm font-semibold tracking-wide text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {forgotBusy ? "Sending OTP..." : "Send OTP →"}
              </button>

              <div className="pt-2 text-center text-xs text-white/60">
                <span>Already a Member? </span>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
                >
                  Sign In
                </button>
              </div>
            </form>
          ) : !otpVerified ? (
            /* Step 1: Enter 6 Individual Digit Boxes (Exact Image 1 Match) */
            <form onSubmit={onVerifyOtpCode} className="space-y-4">
              {/* Read-only Email display */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-white/80">Email</label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotSent(false);
                      setOtpDigits(["", "", "", "", "", ""]);
                      setForgotError(null);
                    }}
                    className="text-[11px] text-white/60 hover:text-white hover:underline cursor-pointer"
                  >
                    Change Email
                  </button>
                </div>
                <div className="w-full rounded-full border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm text-white/80 select-none">
                  {forgotEmail}
                </div>
              </div>

              {/* 6 Individual Square OTP Boxes */}
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-2">
                  Enter 6-digit OTP
                </label>
                <div className="grid grid-cols-6 gap-2 sm:gap-2.5">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpInputsRef.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      autoFocus={idx === 0}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      className="h-12 w-full rounded-2xl border border-white/20 bg-white/[0.08] text-center text-xl font-bold text-white shadow-inner focus:border-[#e50914] focus:bg-white/[0.12] focus:outline-none focus:ring-1 focus:ring-[#e50914] transition-all"
                    />
                  ))}
                </div>
              </div>

              {/* Verify OTP Button */}
              <button
                type="submit"
                disabled={verifyBusy || otpDigits.join("").length !== 6}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-center text-sm font-semibold tracking-wide text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {verifyBusy ? "Verifying OTP..." : "Verify OTP"}
              </button>

              {/* Bottom links: Already a Member? Sign In | Didn't Received? Resend OTP */}
              <div className="space-y-1.5 pt-1 text-center text-xs text-white/60">
                <div>
                  <span>Already a Member? </span>
                  <button
                    type="button"
                    onClick={() => setView("login")}
                    className="font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
                  >
                    Sign In
                  </button>
                </div>
                <div>
                  <span>Didn&apos;t Received? </span>
                  <button
                    type="button"
                    onClick={onResendOtp}
                    disabled={forgotBusy}
                    className="font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
                  >
                    {forgotBusy ? "Resending..." : "Resend OTP"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            /* Step 2: Password Setup (Exact Image 2 Match) */
            <form onSubmit={onUpdatePassword} className="space-y-3.5">
              {/* New Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-white/80">
                    New Password <span className="text-[#e50914]">*</span>
                  </label>
                  <span className="text-[10px] text-white/50">
                    (Min. 8 chars, 1 uppercase, 1 lowercase, 1 symbol)
                  </span>
                </div>
                <div className="relative">
                  <input
                    type={showResetNewPass ? "text" : "password"}
                    required
                    autoFocus
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-full border border-white/15 bg-white/[0.07] pl-4 pr-11 py-3 text-sm text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetNewPass((s) => !s)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors cursor-pointer"
                    aria-label={showResetNewPass ? "Hide password" : "Show password"}
                  >
                    {showResetNewPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm New Password */}
              <div>
                <label className="block text-xs font-semibold text-white/80 mb-1">
                  Confirm New Password <span className="text-[#e50914]">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showResetConfirmPass ? "text" : "password"}
                    required
                    placeholder="Re-enter your new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full rounded-full border border-white/15 bg-white/[0.07] pl-4 pr-11 py-3 text-sm text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetConfirmPass((s) => !s)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white transition-colors cursor-pointer"
                    aria-label={showResetConfirmPass ? "Hide password" : "Show password"}
                  >
                    {showResetConfirmPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <PasswordRequirements password={newPassword} />

              {/* Update Password Button */}
              <button
                type="submit"
                disabled={verifyBusy}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-center text-sm font-semibold tracking-wide text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {verifyBusy ? "Updating Password..." : "Update Password"}
              </button>

              {/* Back to Sign In Link */}
              <div className="pt-2 text-center text-xs text-white/60">
                <button
                  type="button"
                  onClick={() => {
                    setView("login");
                    setForgotSent(false);
                    setOtpVerified(false);
                    setOtpDigits(["", "", "", "", "", ""]);
                    setForgotError(null);
                  }}
                  className="text-white/70 hover:text-white hover:underline transition-colors cursor-pointer"
                >
                  Back to Sign In
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
        <div className="space-y-3.5 animate-fade-in">
          {/* Brand Logo, Tagline & Diamond Separator */}
          <BrandHeader />

          {/* Header */}
          <div className="space-y-1 text-center">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Create your studio
            </h1>
            <p className="text-xs text-white/60">
              One login for all products.
            </p>
          </div>

          {signUpError && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-2.5 text-center text-xs font-medium text-red-300">
              {signUpError}
            </div>
          )}

          {signUpSent ? (
            <div className="space-y-3.5 py-3 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10 text-red-400 ring-1 ring-red-500/20">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Registration Received</p>
                <p className="text-xs text-white/60">
                  Thank you, <strong className="text-white">{firstName || "Photographer"}</strong>! Your studio account details have been sent to your email.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView("login")}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-3 text-sm font-semibold text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] hover:brightness-110 cursor-pointer"
              >
                Go to Sign In →
              </button>
            </div>
          ) : (
            <form onSubmit={onSignUpSubmit} className="space-y-2.5">
              {/* Row 1: First Name & Last Name */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="sr-only">First Name</label>
                  <input
                    type="text"
                    required
                    placeholder="First Name *"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                </div>
                <div>
                  <label className="sr-only">Last Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Last Name *"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                  />
                </div>
              </div>

              {/* Row 2: Company / Studio Name */}
              <div>
                <label className="sr-only">Studio Name</label>
                <input
                  type="text"
                  required
                  placeholder="Studio / Company Name *"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* Row 3: Email */}
              <div>
                <label className="sr-only">Work Email</label>
                <input
                  type="email"
                  required
                  placeholder="Email Address *"
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  className="w-full rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                />
              </div>

              {/* Row 4: Contact Number with +91 Prefix */}
              <div>
                <label className="sr-only">Contact Number</label>
                <div className="flex rounded-full border border-white/15 bg-white/[0.07] shadow-inner overflow-hidden focus-within:border-[#e50914] focus-within:ring-1 focus-within:ring-[#e50914]">
                  <span className="inline-flex items-center px-3 bg-white/5 border-r border-white/15 text-xs font-medium text-white/70">
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="10-digit Mobile Number *"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-2 text-xs text-white placeholder:text-white/40 bg-transparent focus:outline-none"
                  />
                </div>
              </div>

              {/* Row 5: Password & Confirm Password (2-col) */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="relative">
                    <input
                      type={showSignUpPass ? "text" : "password"}
                      required
                      placeholder="Password *"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      className="w-full rounded-full border border-white/15 bg-white/[0.07] pl-3.5 pr-8 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignUpPass((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white cursor-pointer"
                    >
                      {showSignUpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="relative">
                    <input
                      type={showConfirmPass ? "text" : "password"}
                      required
                      placeholder="Confirm *"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-full border border-white/15 bg-white/[0.07] pl-3.5 pr-8 py-2 text-xs text-white placeholder:text-white/40 shadow-inner focus:border-[#e50914] focus:outline-none focus:ring-1 focus:ring-[#e50914]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPass((s) => !s)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white cursor-pointer"
                    >
                      {showConfirmPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Strong Password Requirements indicator */}
              <PasswordRequirements password={signUpPassword} />

              {/* Sign up Button */}
              <button
                type="submit"
                disabled={signUpBusy}
                className="w-full rounded-full bg-gradient-to-r from-red-600 via-red-500 to-red-600 py-2.5 text-center text-xs sm:text-sm font-semibold tracking-wide text-white shadow-[0_4px_24px_rgba(229,9,20,0.5)] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 mt-1 cursor-pointer"
              >
                {signUpBusy ? "Creating studio account..." : "Create Studio Account →"}
              </button>

              {/* Already a Member? Sign In Footer */}
              <div className="pt-1 text-center text-xs text-white/60">
                <span>Already a Member? </span>
                <button
                  type="button"
                  onClick={() => setView("login")}
                  className="font-semibold text-red-500 hover:text-red-400 hover:underline transition-colors cursor-pointer"
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

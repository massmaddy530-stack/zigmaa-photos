"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, CSRF_HEADER, errorMessage, toApiError } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only allow same-site relative redirects after login.
  const next = (() => {
    const n = params.get("next") || "/dashboard";
    return n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard";
  })();

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

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 p-2.5 text-center text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Username Field */}
      <div>
        <label
          htmlFor="username"
          className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#2d241a]"
        >
          <UserRound className="h-3.5 w-3.5 text-[#887865]" />
          <span>Username</span>
        </label>
        <div className="relative">
          <UserRound
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a8a77]"
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
            placeholder="eg : muthu subash"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-xl border border-[#ded5c8] bg-[#fdfbf7] py-2 pl-9 pr-3 text-sm text-[#261f17] placeholder:text-[#ab9d8c] shadow-sm transition-all focus:border-[#c59b27] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c59b27]/25"
          />
        </div>
      </div>

      {/* Password Field */}
      <div>
        <label
          htmlFor="password"
          className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#2d241a]"
        >
          <LockKeyhole className="h-3.5 w-3.5 text-[#887865]" />
          <span>Password</span>
        </label>
        <div className="relative">
          <LockKeyhole
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a8a77]"
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
            className="w-full rounded-xl border border-[#ded5c8] bg-[#fdfbf7] py-2 pl-9 pr-9 text-sm text-[#261f17] placeholder:text-[#ab9d8c] shadow-sm transition-all focus:border-[#c59b27] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c59b27]/25"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-[#9a8a77] hover:bg-black/5"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Golden Sign in Button */}
      <button
        type="submit"
        disabled={busy}
        className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#dfb75c] via-[#c69c34] to-[#a3761c] py-2.5 text-center text-sm font-semibold tracking-wide text-[#1c1507] shadow-[0_3px_12px_rgba(184,134,40,0.30)] transition-all hover:from-[#e5c068] hover:to-[#b08122] hover:shadow-[0_5px_16px_rgba(184,134,40,0.40)] disabled:opacity-50 active:scale-[0.99]"
      >
        {busy ? (
          "Signing in..."
        ) : (
          <span className="inline-flex items-center gap-1.5 font-display text-sm tracking-wide sm:text-base">
            Sign in <span aria-hidden>→</span>
          </span>
        )}
      </button>

      {/* Security Note */}
      <div className="pt-2 flex items-start justify-center gap-2 text-center text-[11px] text-[#8c7d6c]">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b88c30]" />
        <span className="leading-tight">
          Your password is secure and encrypted.<br />
          This browser only keeps you signed in for 12 hours.
        </span>
      </div>
    </form>
  );
}

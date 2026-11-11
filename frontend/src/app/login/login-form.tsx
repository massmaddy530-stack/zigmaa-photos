"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
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
    <form onSubmit={onSubmit} className="space-y-4 sm:space-y-4.5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50/90 p-2.5 text-center text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Username Field */}
      <div>
        <label
          htmlFor="username"
          className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#2d2318]"
        >
          <UserRound className="h-4 w-4 text-[#8a7965]" />
          <span>Username</span>
        </label>
        <div className="relative">
          <UserRound
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a8976]"
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
            placeholder="Enter your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-2xl border border-[#d8ccba] bg-white py-3 sm:py-3.5 pl-11 pr-4 text-sm sm:text-base text-[#261f17] placeholder:text-[#9e8f7e] shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-all focus:border-[#c59b27] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c59b27]/25"
          />
        </div>
      </div>

      {/* Password Field */}
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#2d2318]"
        >
          <LockKeyhole className="h-4 w-4 text-[#8a7965]" />
          <span>Password</span>
        </label>
        <div className="relative">
          <LockKeyhole
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a8976]"
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
            className="w-full rounded-2xl border border-[#d8ccba] bg-white py-3 sm:py-3.5 pl-11 pr-11 text-sm sm:text-base text-[#261f17] placeholder:text-[#9e8f7e] shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition-all focus:border-[#c59b27] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c59b27]/25"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-[#9a8976] hover:bg-black/5"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Golden Sign in Button */}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#dfa843] via-[#c99525] to-[#996b17] py-3.5 sm:py-4 text-center text-base sm:text-[17px] font-semibold tracking-wide text-[#1c1305] shadow-[0_4px_18px_rgba(180,125,30,0.38)] transition-all hover:from-[#e5b24f] hover:to-[#a8751b] hover:shadow-[0_6px_22px_rgba(180,125,30,0.48)] disabled:opacity-50 active:scale-[0.99]"
      >
        {busy ? (
          "Signing in..."
        ) : (
          <span className="inline-flex items-center gap-2 font-display text-base sm:text-[17px] font-semibold tracking-wide">
            Sign in <span aria-hidden>→</span>
          </span>
        )}
      </button>
    </form>
  );
}

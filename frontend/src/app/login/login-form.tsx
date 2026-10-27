"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
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
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Field label="Username" htmlFor="username">
        <div className="relative">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input id="username" name="username" type="text" autoComplete="username" required autoFocus
                 autoCapitalize="none" spellCheck={false} maxLength={128}
                 value={username} onChange={(e) => setUsername(e.target.value)} className="pl-10" />
        </div>
      </Field>
      <Field label="Password" htmlFor="password" error={error}>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password"
                 required maxLength={1024} spellCheck={false}
                 value={password} onChange={(e) => setPassword(e.target.value)} className="pl-10 pr-10" />
          <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-black/5"
                  aria-label={show ? "Hide password" : "Show password"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
    </form>
  );
}

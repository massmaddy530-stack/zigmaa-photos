"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { ApiError, CSRF_HEADER, errorMessage, toApiError } from "@/lib/api";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [apiKey, setApiKey] = useState("");
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
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) throw await toApiError(res);
      setApiKey("");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? errorMessage(err) : "Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <Field label="Admin API key" htmlFor="apiKey" error={error}>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input id="apiKey" type={show ? "text" : "password"} autoComplete="current-password" required autoFocus
                 value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="pl-10 pr-10" spellCheck={false} />
          <button type="button" onClick={() => setShow((s) => !s)}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-black/5"
                  aria-label={show ? "Hide key" : "Show key"}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
    </form>
  );
}

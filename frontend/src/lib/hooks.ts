"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Re-run the query. Background reloads keep showing current data. */
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Minimal data-fetching hook: fetches on mount and when `deps` change, optional polling,
 * ignores stale responses, and redirects to /login when the admin session has expired.
 */
export function useQuery<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  opts: { pollMs?: number | false; enabled?: boolean } = {},
): QueryState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(opts.enabled !== false);
  const seq = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    const id = ++seq.current;
    try {
      const result = await fetcherRef.current();
      if (id === seq.current) {
        setDataState(result);
        setError(null);
      }
    } catch (err) {
      if (id !== seq.current) return;
      if (err instanceof ApiError && err.status === 401 && typeof window !== "undefined" &&
          window.location.pathname.startsWith("/dashboard")) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      setError(err);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts.enabled === false) return;
    setLoading(true);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.enabled]);

  useEffect(() => {
    if (!opts.pollMs || opts.enabled === false) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, opts.enabled, run]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload: run, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

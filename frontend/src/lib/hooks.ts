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
  const inFlightRef = useRef(false);
  const errorBackoffUntilRef = useRef<number>(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const execute = useCallback(async (isPolling = false) => {
    if (isPolling) {
      if (inFlightRef.current) return;
      if (Date.now() < errorBackoffUntilRef.current) return;
    } else {
      // User action or filter/dependency change: always run immediately and reset backoff
      errorBackoffUntilRef.current = 0;
    }
    const id = ++seq.current;
    inFlightRef.current = true;
    try {
      const result = await fetcherRef.current();
      if (id === seq.current) {
        setDataState(result);
        setError(null);
        errorBackoffUntilRef.current = 0;
      }
    } catch (err) {
      if (id !== seq.current) return;
      if (err instanceof ApiError && err.status === 401 && typeof window !== "undefined" &&
          window.location.pathname.startsWith("/dashboard")) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      if (err instanceof ApiError && err.status === 429) {
        // Back off background polling for 10s so server/gateway can recover
        errorBackoffUntilRef.current = Date.now() + 10000;
      } else {
        // General background error backoff 4s
        errorBackoffUntilRef.current = Date.now() + 4000;
      }
      setError(err);
    } finally {
      inFlightRef.current = false;
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (opts.enabled === false) return;
    setLoading(true);
    void execute(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.enabled]);

  useEffect(() => {
    if (!opts.pollMs || opts.enabled === false) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void execute(true);
    }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, opts.enabled, execute]);

  const reload = useCallback(() => execute(false), [execute]);

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | undefined) => T)(prev) : updater));
  }, []);

  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

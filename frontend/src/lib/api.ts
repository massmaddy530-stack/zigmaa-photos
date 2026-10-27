import { PUBLIC_API_BASE_URL } from "./config";
import { browserMediaUrl } from "./image";
import type {
  ApiErrorBody,
  EventCreate,
  EventOut,
  EventStatus,
  EventStatusOut,
  EventUpdate,
  HealthOut,
  MatchItem,
  MatchPage,
  MatchResponse,
  OverviewOut,
  Page,
  PhotoDetailOut,
  PhotoOut,
  PhotoStatus,
  PublicEventOut,
  RetryResponse,
  UploadResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const FRIENDLY: Record<string, string> = {
  network_error: "Can't reach the server. Check your connection and try again.",
  timeout: "The request took too long. Please try again.",
  backend_unreachable: "The API server is not reachable. Is the backend running?",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return FRIENDLY[err.code] ?? err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function parseRetryAfter(res: Response): number | undefined {
  const v = res.headers.get("retry-after");
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
}

export async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  const e = body?.error;
  return new ApiError(
    res.status,
    e?.code ?? `http_${res.status}`,
    e?.message ?? `Request failed (${res.status})`,
    e?.details,
    parseRetryAfter(res),
  );
}

interface RequestOpts {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function qs(query?: RequestOpts["query"]): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function request<T>(url: string, opts: RequestOpts = {}, extraHeaders: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), opts.timeoutMs ?? 30_000);
  opts.signal?.addEventListener("abort", () => controller.abort(opts.signal?.reason));
  const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let res: Response;
  try {
    res = await fetch(url + qs(opts.query), {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason === "timeout") {
      throw new ApiError(0, "timeout", FRIENDLY.timeout);
    }
    if (opts.signal?.aborted) throw err;
    throw new ApiError(0, "network_error", FRIENDLY.network_error);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------------------------
// Admin API: same-origin calls to the Next.js proxy (/api/admin/* -> backend /api/v1/*).
// The proxy attaches the admin key from an httpOnly cookie, so no secret ever reaches the browser.
// ---------------------------------------------------------------------------------------------

export const ADMIN_PROXY = "/api/admin";
export const CSRF_HEADER = { "X-Requested-With": "evp" };

const MEDIA_URL_FIELDS = new Set(["cover_url", "thumbnail_url", "preview_url", "original_url", "download_url"]);

/** Makes loopback media links in an admin response same-origin, so the dashboard also works from a phone. */
function withBrowserMediaUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withBrowserMediaUrls);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, MEDIA_URL_FIELDS.has(k) && typeof v === "string" ? browserMediaUrl(v) : withBrowserMediaUrls(v)]));
}

function admin<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  return request<T>(`${ADMIN_PROXY}/${path}`, opts, CSRF_HEADER).then((data) => withBrowserMediaUrls(data) as T);
}

export const adminApi = {
  overview: () => admin<OverviewOut>("dashboard/overview"),

  listEvents: (params: { q?: string; status?: EventStatus | ""; limit?: number; offset?: number }) =>
    admin<Page<EventOut>>("events", { query: params }),
  getEvent: (id: string) => admin<EventOut>(`events/${id}`),
  createEvent: (body: EventCreate) => admin<EventOut>("events", { method: "POST", json: body }),
  updateEvent: (id: string, body: EventUpdate) => admin<EventOut>(`events/${id}`, { method: "PATCH", json: body }),
  deleteEvent: (id: string) => admin<void>(`events/${id}`, { method: "DELETE" }),
  uploadCover: (id: string, file: Blob, name = "cover.jpg") => {
    const fd = new FormData();
    fd.append("file", file, name);
    return admin<EventOut>(`events/${id}/cover`, { method: "PUT", body: fd, timeoutMs: 120_000 });
  },
  rotateLink: (id: string) => admin<EventOut>(`events/${id}/rotate-link`, { method: "POST" }),
  purgeFaces: (id: string) => admin<{ deleted_faces: number }>(`events/${id}/faces`, { method: "DELETE" }),
  eventStatus: (id: string) => admin<EventStatusOut>(`events/${id}/status`),

  listPhotos: (
    id: string,
    params: { status?: PhotoStatus | ""; q?: string; has_faces?: boolean | null; limit?: number; offset?: number },
  ) => admin<Page<PhotoOut>>(`events/${id}/photos`, { query: params }),
  getPhoto: (eventId: string, photoId: string) => admin<PhotoDetailOut>(`events/${eventId}/photos/${photoId}`),
  deletePhoto: (eventId: string, photoId: string) =>
    admin<void>(`events/${eventId}/photos/${photoId}`, { method: "DELETE" }),
  retryPhoto: (eventId: string, photoId: string) =>
    admin<RetryResponse>(`events/${eventId}/photos/${photoId}/retry`, { method: "POST" }),
  retryFailed: (eventId: string, includePending = false) =>
    admin<RetryResponse>(`events/${eventId}/photos/retry-failed`, {
      method: "POST",
      query: { include_pending: includePending },
    }),

  match: (eventId: string, selfie: Blob, pageSize = 48) => {
    const fd = new FormData();
    fd.append("selfie", selfie, "face.jpg");
    return admin<MatchResponse>(`events/${eventId}/match`, {
      method: "POST",
      body: fd,
      query: { page_size: pageSize },
      timeoutMs: 90_000,
    });
  },
  matchPage: (eventId: string, token: string, cursor: number, limit = 48) =>
    admin<MatchPage>(`events/${eventId}/matches/${encodeURIComponent(token)}`, { query: { cursor, limit } }),
};

/** Upload a batch of photos through the proxy with progress events (fetch has no upload progress). */
export function uploadPhotos(
  eventId: string,
  files: File[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; body: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${ADMIN_PROXY}/events/${eventId}/photos`);
    xhr.setRequestHeader("X-Requested-With", "evp");
    xhr.responseType = "json";
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const data = xhr.response as UploadResponse | ApiErrorBody | null;
      if ((xhr.status === 200 || xhr.status === 201) && data && "items" in data) {
        resolve({ status: xhr.status, body: data });
        return;
      }
      const err = data && "error" in data ? data.error : undefined;
      // 422/503 carry per-file results in error.details
      const details = err?.details as UploadResponse | undefined;
      if (details && Array.isArray(details.items)) {
        resolve({ status: xhr.status, body: details });
        return;
      }
      reject(new ApiError(xhr.status, err?.code ?? `http_${xhr.status}`, err?.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error", FRIENDLY.network_error));
    xhr.ontimeout = () => reject(new ApiError(0, "timeout", FRIENDLY.timeout));
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    fd.append("source", "dashboard");
    xhr.send(fd);
  });
}

// ---------------------------------------------------------------------------------------------
// Public API: guest endpoints called directly on the backend (CORS-restricted, rate-limited).
// ---------------------------------------------------------------------------------------------

/** Guests may be on another device (phone on the LAN): make loopback media links same-origin. */
function guestMatchItems<T extends { items: MatchItem[] }>(data: T): T {
  return {
    ...data,
    items: data.items.map((m) => ({
      ...m,
      thumbnail_url: browserMediaUrl(m.thumbnail_url),
      preview_url: browserMediaUrl(m.preview_url),
      download_url: browserMediaUrl(m.download_url),
    })),
  };
}

export const publicApi = {
  event: (slug: string) =>
    request<PublicEventOut>(`${PUBLIC_API_BASE_URL}/api/v1/public/events/${encodeURIComponent(slug)}`)
      .then((e) => ({ ...e, cover_url: browserMediaUrl(e.cover_url) })),
  qrUrl: (slug: string) => `${PUBLIC_API_BASE_URL}/api/v1/public/events/${encodeURIComponent(slug)}/qr.svg`,
  /** Upload a selfie and match it; reports upload progress (0..1). `consent` is the guest's checkbox state:
   *  the backend refuses to process the selfie (400 consent_required) unless it is true. */
  match: (slug: string, selfie: Blob, consent: boolean, signal?: AbortSignal, onProgress?: (fraction: number) => void,
          pageSize = 48) =>
    new Promise<MatchResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${PUBLIC_API_BASE_URL}/api/v1/public/events/${encodeURIComponent(slug)}/match${qs({ page_size: pageSize })}`);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.responseType = "json";
      xhr.timeout = 90_000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        const data = xhr.response as MatchResponse | ApiErrorBody | null;
        if (xhr.status === 200 && data && "items" in data) return resolve(guestMatchItems(data));
        const err = data && "error" in data ? data.error : undefined;
        const ra = xhr.getResponseHeader("retry-after");
        reject(new ApiError(xhr.status, err?.code ?? `http_${xhr.status}`, err?.message ?? `Request failed (${xhr.status})`,
          err?.details, ra && /^\d+$/.test(ra) ? Number(ra) : undefined));
      };
      xhr.onerror = () => reject(new ApiError(0, "network_error", FRIENDLY.network_error));
      xhr.ontimeout = () => reject(new ApiError(0, "timeout", FRIENDLY.timeout));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", () => xhr.abort());
      const fd = new FormData();
      fd.append("selfie", selfie, "selfie.jpg");
      fd.append("consent", consent ? "true" : "false");
      xhr.send(fd);
    }),
  matchPage: (slug: string, token: string, cursor: number, limit = 48) =>
    request<MatchPage>(
      `${PUBLIC_API_BASE_URL}/api/v1/public/events/${encodeURIComponent(slug)}/matches/${encodeURIComponent(token)}`,
      { query: { cursor, limit } },
    ).then(guestMatchItems),
};

/** Fetch backend health through the signed-in admin route; returns the body even when "degraded" (HTTP 503). */
export async function fetchHealth(): Promise<HealthOut> {
  try {
    const res = await fetch(`${ADMIN_PROXY}/health`, {
      cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => null)) as (HealthOut & Partial<ApiErrorBody>) | null;
    if (body && body.checks) return body;
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Request failed (${res.status})`);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, "backend_unreachable", FRIENDLY.backend_unreachable);
  }
}

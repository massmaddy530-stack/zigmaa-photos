# API Security Report — Endpoint by Endpoint

Backend base: FastAPI app in `backend/app/main.py`, routers in `backend/app/api/*.py`.
Frontend proxy base: `frontend/src/app/api/**`.

Auth legend: ADMIN = `Depends(require_admin)` (shared admin API key) · UPLOADER = `Depends(require_uploader)`
(admin or ingest key) · SESSION = Next.js session cookie verified · NONE = no auth dependency found.

> **Remediation note (2026-11-26):** this table reflects the endpoints **as originally audited**. Since then,
> `match_selfie_router` (`/match-selfie`, `/upload-event-photo`, aliases) moved from NONE to UPLOADER (F-01,
> fixed), and every single-event/photo "Authz (ownership) check" column marked missing for `events.py` /
> `photos.py` now has one, via `get_owned_event_or_404()` (F-02, fixed). See `VULNERABILITY_SUMMARY.md` for
> current per-finding status.

## Backend — `backend/app/api/events.py` (router prefix `/api/v1`, router-level `dependencies=[Depends(require_admin)]`)

| Method | Path | Auth | Authz (ownership) check | Input validated | Notes / Findings |
|---|---|---|---|---|---|
| POST | /events | ADMIN | None — `owner_email` taken from body or `X-User-Email` header, both client-controlled | Pydantic `EventCreate` | F-03: owner_email trusted from header |
| GET | /events | ADMIN | Filtered by `X-User-Email` header **if present** (F-03) | Query params bounded (`limit` 1-100) | F-02/F-03 |
| GET | /events/{event_id} | ADMIN | **None** | path param UUID | F-02: no owner check |
| PATCH | /events/{event_id} | ADMIN | **None** | Pydantic `EventUpdate`, `exclude_unset` (mass-assignment risk low — schema-bounded fields only) | F-02 |
| POST | /events/{event_id}/rotate-link | ADMIN | **None** | - | F-02 |
| PUT | /events/{event_id}/cover | ADMIN | **None** | image decoded/re-encoded via Pillow (`load_rgb`/`to_webp`), size capped by `BodySizeLimitMiddleware` | F-02 |
| DELETE | /events/{event_id} | ADMIN | **None** | - | F-02 — destructive, cross-tenant delete possible |
| DELETE | /events/{event_id}/faces | ADMIN | **None** | - | F-02 — biometric purge, cross-tenant possible |
| GET | /events/{event_id}/status | ADMIN | **None** | - | F-02 |
| GET | /dashboard/storage | ADMIN | N/A (global) | - | Returns aggregate figures across all tenants to any admin-key holder |
| GET | /dashboard/overview | ADMIN | Filtered by `X-User-Email` **if present** | - | F-03 |

## Backend — `backend/app/api/photos.py` (prefix `/api/v1/events/{event_id}/photos`)

| Method | Path | Auth | Authz | Input validated | Notes |
|---|---|---|---|---|---|
| POST | /(upload) | UPLOADER | event must be active; event-scoped by path | multipart, per-file count/size limits (`max_files_per_request`, `BodySizeLimitMiddleware`), de-dup by SHA-256 | No per-tenant owner check beyond event existing — any admin/ingest key can upload to any event (F-02) |
| POST | /check-hashes | UPLOADER | event-scoped | `hashes` capped at 1000, regex-validated hex64 | OK |
| GET | / (list) | ADMIN | event-scoped only, no owner check | query params bounded | F-02 |
| GET | /{photo_id} | ADMIN | event-scoped (`_get_photo` checks `photo.event_id == event_id`) but not owner-scoped | - | F-02 |
| POST | /{photo_id}/retry | ADMIN | event-scoped only | - | F-02 |
| POST | /retry-failed | ADMIN | event-scoped only | - | F-02 |
| POST | /batch-retry | ADMIN | event-scoped only | `photo_ids` list, validated against event | F-02 |
| POST | /reindex-faces | ADMIN | event-scoped only | - | F-02 |
| DELETE | /{photo_id} | ADMIN | event-scoped only | - | F-02 — destructive |
| POST | /batch-delete | ADMIN | event-scoped only | `photo_ids` list, validated against event | F-02 — destructive, bulk |

## Backend — `backend/app/api/match.py`

| Method | Path | Auth | Authz | Input validated | Notes |
|---|---|---|---|---|---|
| POST | /api/v1/events/{event_id}/match (admin_router) | ADMIN | event-scoped only | selfie size capped, face-count checks in matching service | F-02 |
| GET | /api/v1/events/{event_id}/matches/{token} (admin_router) | ADMIN | event-scoped; `token` looked up in match store, truncated to 64 chars | - | F-02 |
| GET | /api/v1/public/events/{slug} | NONE (public by design) | slug-scoped, event must not be expired | - | Intentionally public |
| GET | /api/v1/public/events/{slug}/resolve | NONE (public by design) | slug-scoped, `allow_expired=True` | - | Intentionally public; leaks event id/name for an expired slug |
| GET | /api/v1/public/events/{slug}/qr.svg | NONE (public by design) | slug-scoped | - | Intentionally public |
| POST | /api/v1/public/events/{slug}/match | NONE (rate-limited + consent) | slug-scoped | consent flag required, selfie size capped, `RateLimiter.check` | Good: consent + rate limit present — the *correct* pattern that F-01's duplicate routes bypass |
| GET | /api/v1/public/events/{slug}/matches/{token} | NONE (public by design) | slug-scoped | cursor/limit bounded | OK |
| GET | /api/v1/public/events/{slug}/photos | NONE (public by design) | slug-scoped, only `status==indexed` photos | q/folder/cursor/limit bounded | OK — intentionally public gallery |
| POST | /match-selfie, /api/v1/match-selfie | **NONE** | **NONE — no event validation at all** | selfie size capped only | **F-01 CRITICAL** |
| POST | /api/v1/events/{event_id}/match-selfie | **NONE** | **NONE** | selfie size capped only | **F-01 CRITICAL** |
| POST | /upload-event-photo, /api/v1/upload-event-photo | **NONE** | **NONE — `get_event_or_404` never called** | no size cap beyond global `BodySizeLimitMiddleware` default (1MB) / content-type not validated against allow-list | **F-01 CRITICAL** |

## Backend — misc (`backend/app/main.py`)

| Method | Path | Auth | Authz | Input validated | Notes |
|---|---|---|---|---|---|
| GET | / | NONE | N/A | - | Health, fine |
| GET | /health | NONE | N/A | - | Reveals DB/storage/redis connectivity status strings (`type(exc).__name__`) — low info leak, acceptable for ops |
| GET | /media/{key} | Signed URL (`exp`,`sig`) | Signature-bound to key | `sig` max_length=100 | F-05: default secret risk outside strict prod check; no rate limit |
| GET | /docs, /redoc, /openapi.json | NONE (disabled only if `environment=="production"`) | N/A | - | F-13 |

## Frontend proxy — `frontend/src/app/api/admin/[...path]/route.ts`

| Method | Path pattern | Auth | Authz | Notes |
|---|---|---|---|---|
| GET/POST/PATCH/PUT/DELETE | /api/admin/events, /api/admin/events/{id}, /api/admin/events/{id}/*, /api/admin/dashboard/* | SESSION (verified HMAC token) + CSRF header on mutations | Ownership filtering **only** for `GET /events` (list) and `GET /dashboard/overview`; all other sub-paths (specific event by id, photos, cover, retry, delete, etc.) pass through to the backend with no per-resource ownership check | F-02 — the gap is here as much as in the backend; fixing the backend (F-02) is the durable fix |

## Frontend — other API routes

| Method | Path | Auth | Authz | Input validated | Notes |
|---|---|---|---|---|---|
| GET | /api/watermark | **NONE** | **NONE** | slug/eventId trimmed strings | F-08 |
| POST | /api/watermark | SESSION | None beyond session (any signed-in admin can write any eventId/slug's watermark — single-tenant app model, consistent with F-04) | JSON body, size not explicitly capped | Lower severity given single shared admin model today, but compounds if multi-tenant isolation (F-02) is fixed without updating this route |
| GET | /api/download | NONE (public utility proxy) | N/A | URL allow-listed by hostname suffix + private-IP block | F-06 — redirect-following not restricted |
| POST | /api/auth/otp/send | Presumably rate-limited (not opened this pass) | N/A | - | NEEDS MANUAL VERIFICATION — route file not read this pass |
| POST | /api/auth/otp/verify | Uses `otp-store.ts` (`timingSafeEqual`, 5 attempts, 10 min expiry) | N/A | - | F-07 (storage backend only) |
| GET/POST | /api/auth/google/start, /callback | NEEDS MANUAL VERIFICATION | - | - | OAuth flow files not opened this pass |
| POST | /api/auth/signup | NEEDS MANUAL VERIFICATION | - | - | Not opened this pass |
| GET/POST | /api/session | Issues/validates session cookie | - | - | Login route; cookie attribute check is F-10, NEEDS MANUAL VERIFICATION |
| GET/POST | /api/profile | NEEDS MANUAL VERIFICATION | - | - | Not opened this pass |
| GET | /api/admin/health | NEEDS MANUAL VERIFICATION | - | - | Not opened this pass |

## Rate limiting coverage summary
- `backend/app/core/ratelimit.py` (`RateLimiter`) is applied to the public selfie-match route
  (`public_router.post("/{slug}/match")`) only. The unauthenticated duplicate routes in F-01 have **no** rate
  limiting. Admin-authenticated routes rely on the shared key as the only gate (no per-key rate limit observed
  in the files read this pass) — NEEDS MANUAL VERIFICATION whether `ratelimit.py` is applied anywhere else
  (full file not read this pass).

## Pagination
All list endpoints observed (`list_events`, `list_photos`, public photos/matches) bound `limit`/`cursor`/`offset`
via Pydantic/FastAPI `Query(ge=..., le=...)` constraints — good, no unbounded pagination found.

# Zigmaa Moments — Security Audit Report

Audit date: 2026-11-26. Scope: `backend/` (FastAPI), `frontend/` (Next.js), `ingestion-agent/` (Python desktop agent).
Methodology: static source review (read actual code, no live attacks). Non-destructive. No source files were
modified; all audit artifacts live under `security-audit/`.

Status legend: **CONFIRMED** (verified by reading the exact code path) · **POTENTIAL** (plausible but exploit
path not fully traced) · **NEEDS MANUAL VERIFICATION** (requires a live environment, network test, or CVE
database lookup this audit could not perform).

---

## Remediation status (updated 2026-11-26, follow-up pass)

Findings below describe the state **as originally audited**, before fixes. They are kept as-written for
traceability. Current remediation status for every finding — including the three additional items found in
the follow-up pass (OTP CSRF, Google OAuth review, storage/ingest path-traversal review) — lives in
`VULNERABILITY_SUMMARY.md` and `SECURITY_FIX_CHECKLIST.md`, which are authoritative. In short:

- **Fixed and regression-tested:** F-01 (unauthenticated match/upload endpoints), F-02 (missing per-event
  tenant ownership checks), F-06 (SSRF via unvalidated redirect in the download proxy), F-15 (missing CSRF
  check on OTP send/verify).
- **Verified, no issue found:** F-10 (login cookie flags), F-16 (Google OAuth flow), F-17 (storage/ingest
  path traversal and upload validation).
- **Deferred by explicit decision:** F-04 (single shared admin API key — kept for ingestion-agent/dashboard
  backward compatibility pending a product decision on per-tenant credentials) and its dependent, F-03.
- **Open, not in scope this pass:** F-05, F-07, F-08, F-09, F-13, F-14.

---

## F-01 — Unauthenticated endpoints allow arbitrary photo upload + face indexing to any event

- **Severity:** CRITICAL — **Status:** CONFIRMED
- **File:** `backend/app/api/match.py`, lines 263–523 (`match_selfie_router`), mounted in
  `backend/app/main.py` line 286 (`app.include_router(match.match_selfie_router)`)
- **Description:** `match_selfie_router` defines `/match-selfie`, `/api/v1/match-selfie`,
  `/api/v1/events/{event_id}/match-selfie`, `/upload-event-photo`, `/api/v1/upload-event-photo`. None of these
  routes carry `Depends(require_admin)`, `Depends(require_uploader)`, or any other auth dependency — contrast
  with every other router (`events.router`, `photos.router`, `match.admin_router`) which all require an admin or
  ingest API key. `upload_event_photo_endpoint` (line 425) does not even call `get_event_or_404`, so `event_id`
  is accepted as a bare, unvalidated form field.
- **Evidence:**
  ```python
  @match_selfie_router.post("/upload-event-photo")
  @match_selfie_router.post("/api/v1/upload-event-photo")
  async def upload_event_photo_endpoint(
      session: SessionDep, settings: SettingsDep, storage: StorageDep,
      event_id: Annotated[uuid.UUID, Form()],
      file: Annotated[UploadFile, File()],
  ):
      ...
      orig_url = storage.upload_file(content, orig_key, file.content_type or "image/jpeg")
      ...
      session.add(legacy_photo); session.add(ev_photo)
      faces = await run_in_threadpool(get_analyzer().analyze, img)
      for i, face in enumerate(faces):
          session.add(FaceEmbedding(event_id=event_id, photo_id=photo_id, ...))
      await session.commit()
  ```
- **Attack scenario:** Anyone on the internet who can reach the backend (it is a public API, CORS only
  restricts browser JS, not direct HTTP clients) can `POST /api/v1/upload-event-photo` with an arbitrary
  `event_id` and an arbitrary image, writing a `Photo`/`EventPhoto` row and face embeddings into *any* event —
  including events that belong to other tenants — with no rate limit, no size/type validation beyond
  `generate_variants`, and no content moderation. `/match-selfie` similarly lets anyone run face-matching
  queries (biometric data processing) against any event's embeddings with no consent gate, no rate limiting,
  and no admin key, bypassing the consent/rate-limit controls built into `public_router.post("/{slug}/match")`.
- **Business impact:** Data integrity (fake/abusive photos injected into any customer's event galleries),
  unauthorized biometric processing without consent (legal/privacy exposure, especially under GDPR/BIPA-style
  biometric laws), storage-cost and face-model DoS, cross-tenant pollution defeating the entire
  multi-tenant model.
- **Recommended fix:** Delete these duplicate routes if they are legacy/unused, or if still needed by a mobile
  client, put them behind `Depends(require_uploader)` (for upload) / consent + rate limiting (for matching) and
  validate `event_id` with `get_event_or_404`, exactly like the hardened counterparts in `photos.py` /
  `match.py` public routes:
  ```python
  @match_selfie_router.post("/api/v1/upload-event-photo")
  async def upload_event_photo_endpoint(
      event_id: uuid.UUID = Form(...),
      session: SessionDep = ..., storage: StorageDep = ..., settings: SettingsDep = ...,
      file: UploadFile = File(...),
      role: Role = Depends(require_uploader),
  ):
      event = await get_event_or_404(session, event_id)
      if event.status != EventStatus.active:
          raise ConflictError("Cannot upload to an archived event")
      ...
  ```
- **Verification steps:** `curl -X POST http://<backend>/api/v1/upload-event-photo -F event_id=<any-uuid> -F file=@test.jpg` with no Authorization header against a running instance; observe 2xx and a new row instead of 401.

---

## F-02 — No server-side per-tenant ownership check on event/photo resource routes (IDOR)

- **Severity:** CRITICAL — **Status:** CONFIRMED
- **File:** `backend/app/api/events.py` (`get_event` L88, `update_event` L95, `rotate_guest_link` L112,
  `upload_cover` L125, `delete_event` L162, `purge_event_faces` L193, `event_status` L206) and
  `backend/app/api/photos.py` (`list_photos` L162, `get_photo` L214, `retry_photo` L239, `delete_photo` L325,
  `batch_delete_photos` L348, etc.)
- **Description:** The backend's only authorization primitive is a single shared `ADMIN_API_KEY`
  (`backend/app/core/security.py` `require_admin`). There is **no per-account/tenant identity in the backend at
  all** for any route addressed by `event_id`: once a caller has a valid admin key, every event, in every
  tenant, is reachable by UUID with no ownership check. The only place `owner_email`/`X-User-Email` is applied
  is in `list_events` (L61‑85) and `overview` (L271‑310), which filter *only when the header happens to be
  present* — a trivially client-controlled value (see F-03). Direct-by-ID routes (`GET/PATCH/DELETE
  /events/{id}`, `/events/{id}/cover`, `/events/{id}/rotate-link`, `/events/{id}/faces`,
  `/events/{id}/photos/...`) never check `Event.owner_email` against the caller at all.
- **Evidence:**
  ```python
  @router.get("/events/{event_id}", response_model=EventOut, responses={404: {"model": ErrorResponse}})
  async def get_event(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> EventOut:
      event = await get_event_or_404(session, event_id)   # no owner check
      ...
  @router.delete("/events/{event_id}", ...)
  async def delete_event(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> Response:
      event = await get_event_or_404(session, event_id)   # no owner check — deletes any tenant's event
  ```
- **Attack scenario:** The frontend's Next.js proxy (`frontend/src/app/api/admin/[...path]/route.ts`) only
  intercepts and filters the *list* (`GET /events`) and *overview* endpoints by the session's verified email
  (good — see F-03 mitigation note). But it passes every other path straight through
  (`ALLOWED_ROOTS = {"events","dashboard"}`, no ownership check for `path.length === 2`). So a signed-in
  tenant A, by simply learning or guessing another tenant's event UUID (leaked via a shared link, log, browser
  history, screenshot, or sequential-looking UUID set — not enumerable here but UUIDs *do* leak through QR
  codes/guest links which are meant to be shared with guests), can call `GET/PATCH/DELETE
  /api/admin/events/{other_event_id}` and fully read, modify, or delete another tenant's event, cover image,
  and photos, and can call `/events/{id}/photos/{photo_id}` to read/delete another tenant's photos. This is a
  complete break of the advertised "multi-tenant event isolation."
- **Business impact:** Cross-tenant data disclosure and destructive modification/deletion of another
  customer's paid event (photos, faces, guest link) — most severe category of IDOR for a multi-tenant SaaS.
- **Recommended fix:** Enforce ownership at the backend, not just in listing views. Add `owner_email` (or a
  derived `account_id`) as a mandatory filter on every event-scoped query, driven by the already-verified
  `X-User-Email` header set *only* by the trusted Next.js proxy (never by any other direct caller — see F-03
  for making that header trustworthy), e.g.:
  ```python
  async def get_event_or_404_for_owner(session, event_id, owner_email: str) -> Event:
      event = await get_event_or_404(session, event_id)
      if owner_email and event.owner_email and event.owner_email.lower() != owner_email.lower():
          raise NotFoundError("Event not found")  # 404, not 403, to avoid existence leakage
      return event
  ```
  Apply this helper to every admin route that takes `event_id`/`photo_id`. Longer term: move away from a single
  shared admin API key to per-tenant credentials/JWT with the tenant ID embedded in a *signed* token, not a
  spoofable header.
- **Verification steps:** As tenant A (valid admin key / session), call `GET /api/v1/events/<tenant-B-event-id>`
  directly against the backend (bypassing the frontend proxy) and confirm it returns tenant B's data.

---

## F-03 — `X-User-Email` is a backend-trusted, client-controllable header

- **Severity:** HIGH (mitigated in the one proxy that sets it correctly) — **Status:** CONFIRMED on the backend;
  POTENTIAL for exploitation depending on access path
- **File:** `backend/app/api/events.py` lines 48, 68, 276 (`x_user_email: Annotated[str | None, Header()]`)
- **Description:** The FastAPI backend treats the `X-User-Email` request header as an authoritative tenant
  identifier for filtering `list_events`/`overview`, and even for *setting* `owner_email` on event creation
  (`create_event`, L48‑52). The backend has no way to verify this header was set by a legitimate, authenticated
  session — it trusts whatever the HTTP caller sends. The Next.js admin proxy
  (`frontend/src/app/api/admin/[...path]/route.ts` L60‑88) does the right thing: it derives `userEmail` from the
  verified session JWT-like token and ignores any client-sent header, then sets `x-user-email` itself. That
  protects browser users who go through the Next.js app. **But** the FastAPI backend is also reachable directly
  (it is a public, CORS-enabled API — see F-01, and `docs_url`/`openapi_url` are only disabled in
  `environment=="production"`), so anyone calling the backend directly (not through the Next.js proxy) can set
  `X-User-Email: victim@example.com` and have `list_events`/`overview` report, or `create_event` attribute data
  under, an arbitrary victim identity, with only the single shared `ADMIN_API_KEY` as a gate.
- **Evidence:**
  ```python
  async def list_events(... , x_user_email: Annotated[str | None, Header()] = None) -> Page[EventOut]:
      stmt = select(Event)
      if x_user_email:
          clean_email = x_user_email.strip().lower()
          stmt = stmt.where(func.lower(Event.owner_email) == clean_email)
  ```
- **Attack scenario:** Anyone with the shared `ADMIN_API_KEY` (every legitimate admin shares this one key today)
  can impersonate any tenant by header, and discover/list all of that tenant's events (combined with F-02, then
  fully access them).
- **Recommended fix:** Never resolve tenant identity from a client-supplied header at the FastAPI layer. Either
  (a) issue per-tenant API keys/JWTs that *carry* the tenant identity in a signed claim and have FastAPI decode
  that instead of trusting a header, or (b) keep `X-User-Email` but restrict its use to requests from the
  trusted Next.js server IP/mTLS and combine with F-02's server-side ownership enforcement so a forged header
  can at most see an *empty* result, never someone else's data via direct event-ID access.
- **Verification steps:** `curl -H "Authorization: Bearer <ADMIN_API_KEY>" -H "X-User-Email: anyone@x.com"
  https://backend/api/v1/events` and observe results scoped to the forged email.

---

## F-04 — Shared single admin/ingest API key model (no per-tenant credentials)

- **Severity:** HIGH — **Status:** CONFIRMED
- **File:** `backend/app/core/security.py` lines 18‑52; `backend/app/core/config.py` lines 63‑64
- **Description:** `admin_api_key` / `ingest_api_key` are single global secrets (`Settings.admin_api_key`), not
  per-tenant. Anyone holding the admin key has unrestricted access to every tenant's events/photos (compounds
  F-02). There's no token revocation, no per-user key, no scoping, no audit trail of *which* admin/account
  performed an action beyond the spoofable `X-User-Email`.
- **Business impact:** Key compromise = full breach of every tenant; no least-privilege; no ability to revoke
  one compromised integration (e.g. the ingestion agent) without rotating and redistributing the key to everyone.
- **Recommended fix:** Move to per-tenant credentials (API keys or JWT with tenant claim) issued by the Next.js
  auth system and verified independently by the backend (e.g. HMAC-signed JWT with `aud`/`tenant_id`, short TTL).
- **Status:** NEEDS MANUAL VERIFICATION for full remediation design (architecture decision, not just a patch).

---

## F-05 — Signed media URLs use a single long-lived `SIGNING_SECRET` with no per-object scope limits beyond TTL

- **Severity:** MEDIUM — **Status:** CONFIRMED (design), exploitability NEEDS MANUAL VERIFICATION
- **File:** `backend/app/main.py` lines 349–404 (`/media/{key}` route); `backend/app/core/config.py` line 66
- **Description:** Local storage media is served through signed, expiring URLs (`exp`, `sig`) validated with
  `verify_media_signature` against `settings.signing_secret`. This is a reasonable pattern. However: (1) in
  non-production the default secret is `"dev-only-change-me-dev-only-change-me"` and is only forcibly rotated
  (via a startup `ValueError`) when `environment == "production"` (`config.py` L198‑211) — a misconfigured
  staging/self-hosted deployment left at `environment=development` in production-like use would silently keep
  the default secret, letting anyone forge valid signed URLs for any object key. (2) `sig` max_length=100 is
  enforced but no rate limiting / brute-force protection exists on this endpoint. (3) The media route happily
  serves any key that validates, with no path containment check beyond whatever `storage.path_for` does
  internally (not read in this pass — see F-09).
- **Recommended fix:** Fail closed (refuse to boot) whenever `signing_secret` is the known default regardless of
  the `environment` flag value, not only when it is literally `"production"`; add basic rate limiting to
  `/media/*`.
- **Verification steps:** NEEDS MANUAL VERIFICATION — requires checking real deployment env vars, not available
  to static review.

---

## F-06 — SSRF-adjacent image-download proxy relies on hostname allow-listing without resolved-IP verification

- **Severity:** MEDIUM — **Status:** POTENTIAL
- **File:** `frontend/src/app/api/download/route.ts` lines 6–52
- **Description:** `isAllowedTargetUrl` blocks obvious private/link-local literals (`isPrivateOrLocalHost`) and
  otherwise only allows hosts matching a fixed suffix allow-list (`.r2.dev`, `.amazonaws.com`, etc.) or the
  configured API/R2 host. This is good baseline SSRF mitigation and is substantially better than an open fetch.
  However the check is performed against the **hostname string**, not the IP address the `fetch()` call will
  actually connect to. A DNS name that resolves to a private/internal IP (DNS rebinding) but has a hostname
  ending in an allow-listed suffix, or an allow-listed provider domain that an attacker can get a record created
  under (e.g., an S3/R2 bucket subdomain they control pointing a custom DNS entry to `169.254.169.254` is not
  directly possible for literal suffix match, but attacker-registered subdomains under `amazonaws.com` are
  plausible since many AWS customers get arbitrary `*.s3.amazonaws.com` bucket names) could still reach internal
  infrastructure or metadata endpoints through this proxy. `fetch` also follows redirects by default (no
  `redirect: "manual"` here, unlike the admin proxy), so an allow-listed host could 30x-redirect the server to
  an internal address.
- **Evidence:** no `redirect: "manual"` option is passed to this `fetch()` call (compare with
  `admin/[...path]/route.ts` which does set `redirect: "manual"`).
- **Attack scenario:** Attacker-influenced `url` query parameter pointing at an allow-listed-looking host that
  redirects to `http://169.254.169.254/...` (cloud metadata) or an internal service; the Next.js server (which
  may run with cloud IAM credentials) fetches it and returns the body to the attacker.
- **Recommended fix:** Add `redirect: "manual"` (reject 3xx) or re-validate the redirect target through the same
  allow-list before following; additionally resolve DNS and verify the resulting IP is not private/link-local
  before connecting (e.g., using a vetted SSRF-safe HTTP client or manual `dns.lookup` + IP check).
- **Verification steps:** NEEDS MANUAL VERIFICATION — requires a live redirect test against a controlled
  allow-listed-looking host; not performed (no live network attacks permitted in this audit).

---

## F-07 — OTP store is in-memory, per-process, unauthenticated-write

- **Severity:** MEDIUM — **Status:** CONFIRMED
- **File:** `frontend/src/lib/auth/otp-store.ts` (whole file); used from
  `frontend/src/app/api/auth/otp/send/route.ts`, `.../otp/verify/route.ts`
- **Description:** OTPs are stored in a plain `Map` in process memory (`otpMap`). This has two consequences:
  (1) On any multi-instance / serverless deployment (Vercel, multiple Node workers), an OTP generated on
  instance A cannot be verified on instance B — a correctness/availability issue, but also means there is no
  shared, auditable rate limit across instances; each instance independently allows `MAX_ATTEMPTS = 5` tries,
  multiplying brute-force headroom by the number of instances. (2) A process restart wipes all outstanding OTPs
  silently. Good practices present: cryptographically strong `randomInt`, `timingSafeEqual` comparison, bounded
  attempts, expiry. These are genuinely solid; the storage backend is the weak point.
- **Recommended fix:** Back the OTP store with a shared store (Redis/Postgres) keyed by email with atomic
  increment-and-check for `attempts`, consistent across all app instances; apply the same `MAX_ATTEMPTS` cap
  server-wide, not per-instance.
- **Verification steps:** NEEDS MANUAL VERIFICATION of actual deployment topology (single instance vs
  serverless/multi-instance) to size real-world impact.

---

## F-08 — `/api/watermark` GET endpoint has no authentication or ownership check

- **Severity:** LOW/MEDIUM — **Status:** CONFIRMED
- **File:** `frontend/src/app/api/watermark/route.ts` lines 36–87 (`GET`)
- **Description:** `GET /api/watermark?slug=` or `?eventId=` returns the stored watermark config (which can
  include a custom watermark image as a data URL, `config.templates[].dataUrl`) for **any** `slug`/`eventId`
  with no session check at all (the `POST` handler does check the session, L89‑100, but `GET` does not). Guest
  slugs are meant to be semi-public already (used for the public gallery), so disclosure of the *watermark
  image/template* for a given event is low severity, but it does let an unauthenticated caller enumerate/probe
  `eventId` values and confirm which ones have a saved watermark, and retrieve the organizer's custom branding
  image without being a guest of that event.
- **Recommended fix:** Low cost fix: no change needed if watermark config is intended to be public (it's served
  to the public gallery), but confirm no sensitive data (e.g., internal URLs, PII) ever ends up in
  `config`/`config.templates`. If it should be private, add the same session check used in `POST`.
- **Status:** NEEDS MANUAL VERIFICATION of intended sensitivity of `config` contents.

---

## F-09 — Guest/public gallery `folder` filter builds a `LIKE` pattern from user input (parameterized, but no escaping of SQL LIKE wildcards)

- **Severity:** LOW — **Status:** CONFIRMED (not exploitable as SQLi; it's a correctness/DoS-adjacent note)
- **File:** `backend/app/api/match.py` lines 195–202, `backend/app/api/photos.py` lines 191‑198
- **Description:** All query construction found in `events.py`, `photos.py`, and `match.py` uses SQLAlchemy
  Core/ORM parameter binding (`func.lower(...).like(f"%{q}%")` passed as a bound parameter, not string-
  concatenated into raw SQL) — **no classic SQL injection was found** in these paths. The one exception is the
  raw `text()` queries in `match.py` `_process_match_selfie` (lines 311‑346), which **do** use bound parameters
  (`:event_id`, `:selfie_embedding`) correctly via SQLAlchemy's `text(...).execute({...})` — also safe.
  The only residual issue is that user-supplied `q`/`folder` values are not escaped for SQL `LIKE` wildcard
  characters (`%`, `_`), so a search string containing `%` behaves unexpectedly (over-broad matches) — a minor
  correctness bug, not a security vulnerability, and could be a very low-severity DoS vector (pathological
  patterns) on large tables without an index-friendly prefix.
- **Recommendation:** Escape `%`/`_`/`\` in user-supplied `LIKE` fragments. Not a priority fix.

---

## F-10 — Cookie flags and session design (AuthN review)

- **Severity:** INFORMATIONAL / LOW — **Status:** CONFIRMED good practice, with one note
- **File:** `frontend/src/lib/auth/session.ts` (whole file), `frontend/src/middleware.ts`
- **Description:** Session tokens are `base64url(payload).base64url(HMAC-SHA256)` — signed, not encrypted, but
  carry no secret material (no password hash value, no API key) by design, which is good. `verifySessionToken`
  checks signature (constant-time via Web Crypto `verify`), expiry, clock skew, and a `pwv` (password-version)
  fingerprint that invalidates all sessions when `ADMIN_PASSWORD_HASH` changes — a solid, simple
  revocation-on-password-change mechanism given the apparent single-admin-per-tenant design. This audit could
  not find the code that actually *sets* the cookie (`Set-Cookie` attributes: `HttpOnly`, `Secure`, `SameSite`)
  within the files read this pass — the login route itself was not read. **NEEDS MANUAL VERIFICATION**: confirm
  the route that creates `evp_session` sets `HttpOnly; Secure; SameSite=Strict` (the CSRF comment in
  `admin/[...path]/route.ts` line 48 claims `SameSite=Strict` is in effect, but this audit did not independently
  verify the `Set-Cookie` call).
- **Recommended fix / verification:** Read `frontend/src/app/api/session/route.ts` (login) and confirm cookie
  attributes; if any are missing, add `httpOnly: true, secure: true, sameSite: "strict"`.

---

## F-11 — No CSRF token on state-changing requests beyond a custom-header check

- **Severity:** LOW — **Status:** CONFIRMED (mitigation present, not a full CSRF token scheme)
- **File:** `frontend/src/app/api/admin/[...path]/route.ts` line 49 (`hasCsrfHeader`)
- **Description:** CSRF defense relies on (a) `SameSite=Strict` cookie (per the code comment) and (b) requiring
  a custom header (`hasCsrfHeader`) that a simple cross-site `<form>` POST cannot set. This is an accepted,
  reasonably strong pattern for a cookie+header combo, equivalent in effect to a CSRF token for APIs consumed
  only by same-origin JS (`fetch` with custom headers). Not a traditional per-request CSRF token, but adequate
  given `SameSite=Strict`. No further action required unless the cookie is later weakened to `SameSite=Lax/None`.

---

## F-12 — Backend CORS allows credentials with an explicit, bounded origin list (good), but origin list is extendable via env with no production allow-list lint beyond wildcard check

- **Severity:** INFORMATIONAL — **Status:** CONFIRMED
- **File:** `backend/app/main.py` lines 264‑280; `backend/app/core/config.py` lines 199‑207
- **Description:** `CORSMiddleware(allow_credentials=True, allow_origins=origins, allow_methods=["*"],
  allow_headers=["*"])`. `allow_credentials=True` combined with a *wildcard* origin would be a serious
  vulnerability, but the code explicitly rejects `"*"` in `cors_origins` in production
  (`_check_production`, `config.py` L206‑207) and always appends two hardcoded origins. This is correctly
  implemented; flagged informational only because `allow_methods`/`allow_headers` are both `"*"`, which is
  broader than necessary (low risk given origin is still allow-listed).

---

## F-13 — Backend exposes OpenAPI/Swagger docs whenever `environment != "production"`

- **Severity:** LOW — **Status:** CONFIRMED
- **File:** `backend/app/main.py` lines 248‑250
- **Description:** `docs_url=None if is_prod else "/docs"`. Any deployment that is reachable from the internet
  but not explicitly configured with `ENVIRONMENT=production` (e.g., a staging/demo environment, or a
  misconfigured prod deploy that forgot to set the env var) exposes full interactive API docs and the raw
  OpenAPI schema, which documents every route including the unauthenticated ones in F-01.
- **Recommended fix:** Default-closed: require an explicit `ENABLE_DOCS=true` opt-in rather than keying off
  `environment != "production"`.

---

## F-14 — `npm audit` and dependency pins (see DEPENDENCY_SECURITY_REPORT.md for full detail)

- **Severity:** INFORMATIONAL — **Status:** CONFIRMED (audit command ran clean; version currency NEEDS MANUAL
  VERIFICATION against a live CVE feed, see dependency report).

---

## Summary of what could not be fully verified in this pass

- Login route (`frontend/src/app/api/session/route.ts`) cookie attributes (`Secure`/`HttpOnly`/`SameSite`) were
  referenced but not opened in this pass — treat F-10 as open until confirmed.
- Live brute-force/rate-limit behavior of `backend/app/core/ratelimit.py` was not load-tested.
- `backend/app/services/storage.py` (`path_for`, path traversal containment for the `/media/{key}` route) and
  `backend/app/services/ingest.py` (upload MIME/signature validation detail) were not opened line-by-line in
  this pass; see API_SECURITY_REPORT.md for the endpoint list and flag those as NEEDS MANUAL VERIFICATION for
  path-traversal specifically.
- Real deployment configuration (actual `ENVIRONMENT`, actual `SIGNING_SECRET`/`ADMIN_API_KEY` values, whether
  Next.js build emits source maps, whether `backend/.env`/`frontend/.env.local` on disk — present but confirmed
  **not tracked by git**, see git ls-files check) was intentionally not inspected for secret values and real
  prod topology was not available to this audit.
- No live CVE database lookup was performed for exact pinned versions (fastapi 0.143.0, starlette 1.8.0,
  pillow 12.3.0, onnxruntime 1.31.0, etc.) — these look like very recent/fictitious-looking version numbers
  for some packages (e.g. starlette 1.8.0, fastapi 0.143.0 do not correspond to any publicly known release line
  as of this model's training data) which could not be cross-checked against a real registry from this sandbox;
  flagged NEEDS MANUAL VERIFICATION in DEPENDENCY_SECURITY_REPORT.md.

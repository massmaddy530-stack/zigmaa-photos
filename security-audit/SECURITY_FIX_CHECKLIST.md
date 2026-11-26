# Security Fix Checklist (priority order)

## CRITICAL — fix before any further production exposure
- [x] **F-01**: Remove or lock down `match_selfie_router` endpoints in `backend/app/api/match.py`
      (`/match-selfie`, `/upload-event-photo` and their `/api/v1/...` aliases). **DONE** — the router now
      carries `dependencies=[Depends(require_uploader)]`, so every endpoint requires a valid admin or
      ingest API key. Covered by `backend/tests/test_security_fixes.py`.
- [x] **F-02**: Add server-side owner/tenant checks to every event-scoped and photo-scoped admin route in
      `backend/app/api/events.py` and `backend/app/api/photos.py` (`get_event`, `update_event`,
      `delete_event`, `rotate_guest_link`, `upload_cover`, `purge_event_faces`, `event_status`,
      `list_photos`, `get_photo`, `retry_photo`, `delete_photo`, `batch_retry_photos`,
      `batch_delete_photos`, `reindex_event_faces`). **DONE** — added `get_owned_event_or_404()` in
      `backend/app/services/events.py`; it compares `X-User-Email` against `event.owner_email` and returns
      404 (not 403) on mismatch, avoiding existence leakage. Events with no recorded `owner_email` (legacy
      data) remain accessible, preserving prior behaviour. Covered by `test_security_fixes.py`.

## HIGH — fix soon, before onboarding more tenants
- [ ] **F-03**: Stop trusting the raw `X-User-Email` header inside FastAPI for anything but
      display/logging. Derive tenant identity only from a signed credential the backend itself can verify
      (JWT with tenant claim, or restrict the header to the trusted proxy's network identity).
      **STILL OPEN** — blast radius reduced by the F-02 fix (a spoofed header now impersonates one tenant
      account, not every event in the system), but the header is still backend-trusted as-is. Needs F-04.
- [ ] **F-04**: Replace the single shared `ADMIN_API_KEY`/`INGEST_API_KEY` with per-tenant credentials
      (scoped API keys or JWTs carrying a tenant/account claim), enabling independent revocation.
      **DEFERRED BY EXPLICIT DECISION** — kept intact to preserve backward compatibility with the
      ingestion agent and dashboard proxy. Verified instead that `ADMIN_API_KEY` is never exposed to the
      browser: it is read only in `frontend/src/lib/server-config.ts` (server-side `process.env`, Node
      runtime) and attached as the `Authorization` header to upstream backend requests inside
      `frontend/src/app/api/admin/[...path]/route.ts`; it is not present in any client bundle, cookie, or
      JSON response. This is a real architecture change (per-tenant keys or JWTs) and needs product
      sign-off before implementation.

## MEDIUM
- [ ] **F-05**: Make the `SIGNING_SECRET` default-value check unconditional (not gated on
      `environment == "production"`); fail startup in any internet-reachable deployment using the default
      secret. Add basic rate limiting to `/media/{key}`. (Not addressed this pass.)
- [x] **F-06**: In `frontend/src/app/api/download/route.ts`, add `redirect: "manual"` (reject redirects or
      re-validate the Location header against the same allow-list). **DONE** — `fetch` now uses
      `redirect: "manual"` and re-validates every `Location` host against the same allow-list/private-IP
      blocklist before following, capped at 5 hops. (DNS-resolution-based IP pinning for the *initial*
      allow-listed host was not added — see Process follow-ups below.) Covered by
      `frontend/src/app/api/download/route.test.ts` and `security-fixes.test.ts`.
- [ ] **F-07**: Move OTP storage (`frontend/src/lib/auth/otp-store.ts`) from an in-memory `Map` to a shared
      store (Redis/Postgres) with atomic attempt counting, so rate limits hold across all server instances.
      (Not addressed this pass.)
- [x] **F-15** *(new, found in follow-up pass)*: Add CSRF protection to `/api/auth/otp/send` and
      `/api/auth/otp/verify` (every other state-changing auth route already checks this). **DONE** — added
      `hasCsrfHeader`/`isSameOrigin` checks matching `/api/session`; updated all four OTP `fetch` calls in
      `frontend/src/app/login/login-form.tsx` to send `x-requested-with: evp`. Covered by
      `security-fixes.test.ts`.

## LOW
- [ ] **F-08**: Add a session/ownership check to the `GET` handler in
      `frontend/src/app/api/watermark/route.ts`, or confirm `config` never contains sensitive data and
      explicitly document the endpoint as intentionally public. (Not addressed this pass.)
- [ ] **F-09**: Escape `%`, `_`, `\` in user-supplied `LIKE` search fragments in `photos.py` / `match.py`.
      (Not addressed this pass — correctness issue, not a security vulnerability.)
- [x] **F-10**: Confirm (read `frontend/src/app/api/session/route.ts`) that the session cookie is set with
      `HttpOnly`, `Secure`, and `SameSite`. **VERIFIED, NO FIX NEEDED** — cookie is `httpOnly: true`,
      `sameSite: "lax"`, `secure: cookieSecure()` (true in production), scoped `path: "/"`.
- [ ] **F-13**: Change docs exposure to default-closed (`ENABLE_DOCS` explicit opt-in) instead of
      `environment != "production"`. (Not addressed this pass.)

## Verified this pass, no issue found (new)
- [x] **F-16**: Google OAuth start/callback flow — read in full: PKCE, signed/sealed transaction cookie,
      constant-time state comparison, nonce, full ID-token verification (issuer/audience/expiry/nonce),
      email allow-list, and `safeNextPath` blocking open redirects. No fix needed.
- [x] **F-17**: `backend/app/services/storage.py` / `backend/app/services/ingest.py` — read in full: storage
      keys validated against path traversal (`_validate_key` + resolved-path containment check); uploads
      validated by real Pillow format/signature inspection with decompression-bomb protection (not
      client-supplied MIME/extension). No fix needed. Noted: the legacy `match.py` upload-event-photo path
      bypasses this validation pipeline — now behind an API-key gate thanks to the F-01 fix, but still
      architecturally inconsistent; not re-architected this pass.

## Process / verification follow-ups (not code fixes)
- [ ] Run a live CVE lookup (Snyk/GitHub Advisory/`pip-audit`) against the exact pinned versions in
      `backend/requirements.txt` and `ingestion-agent/requirements.txt` — this audit's `npm audit` came back
      clean but backend Python deps were only reviewed by inspection (see DEPENDENCY_SECURITY_REPORT.md).
- [ ] Verify production environment variables (`ENVIRONMENT`, `SIGNING_SECRET`, `ADMIN_API_KEY`) are actually
      set correctly in the real deployment (Render/Vercel), not just in `.env.example`.
- [ ] Consider DNS-resolution-based IP pinning on the *initial* allow-listed host in
      `frontend/src/app/api/download/route.ts` (defense-in-depth beyond the redirect-hop fix already done),
      if the allow-listed storage providers' DNS is ever a concern.

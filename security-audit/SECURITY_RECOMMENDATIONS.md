# Broader Security Recommendations

These are architectural/process recommendations, not tied to a single line of code.

## 1. Identity & multi-tenancy architecture
The core structural weakness found in this audit (F-01 through F-04) is that the FastAPI backend has no
concept of "tenant" as a first-class, server-verified identity — it has one shared admin key and an
easily-spoofed email header, while the real session/account system lives entirely in the Next.js layer. For a
multi-tenant SaaS this should be inverted: the backend should be the source of truth for authorization, not a
header that an upstream proxy happens to set correctly today. Consider issuing short-lived, signed JWTs from
the Next.js auth layer with a `tenant_id`/`account_id` claim, and have FastAPI verify the JWT signature itself
(shared secret or JWKS) rather than trusting a plain header or a single long-lived shared API key.

## 2. Secrets management
- `.env`/`.env.local` files are present on disk in `backend/` and `frontend/` but are **not tracked by git**
  (confirmed via `git ls-files`), which is correct. Keep enforcing this with `.gitignore` and a pre-commit
  secret scanner (e.g. `gitleaks`, `trufflehog`) so a future contributor cannot accidentally commit a real
  `.env`.
- Centralize secrets in a managed secret store (Render/Vercel env vars are fine for now, but consider a
  dedicated secrets manager as the team grows) rather than relying on `.env` files in CI or on developer
  machines.
- The `signing_secret` production check (`backend/app/core/config.py`) only triggers when
  `environment == "production"` literally; make default-secret detection unconditional (see F-05).

## 3. CI security scanning
- Add `npm audit --omit=dev` (already clean) and `pip-audit`/`safety` for `backend/requirements.txt` and
  `ingestion-agent/requirements.txt` as required CI steps, failing the build on new HIGH/CRITICAL advisories.
- Add a SAST pass (e.g. `bandit` for Python, `eslint-plugin-security`/Semgrep for TypeScript) to catch classes
  of bugs like F-01 (missing auth dependency) automatically — a simple Semgrep rule "every route in
  `app/api/*.py` must have an auth dependency unless explicitly annotated `# public`" would have caught F-01
  in review.
- Add a lightweight contract test that enumerates all FastAPI routes (`app.routes`) at CI time and asserts each
  one either requires `require_admin`/`require_uploader` or is in an explicit public allow-list — this directly
  prevents regressions like the unauthenticated `match_selfie_router`.

## 4. Logging & alerting
- `backend/app/main.py` already avoids logging secret values (good — e.g. `type(exc).__name__` instead of the
  exception body in a few places). Extend that discipline project-wide: audit all `logger.info`/`logger.error`
  calls for accidental PII/secret leakage (selfie bytes are explicitly dropped early in `match.py`, which is a
  good existing practice — `del data`, `del embeddings`).
- Add structured security-relevant audit logging for: admin key usage (which key ID, not value), event
  deletion, face-embedding purges, and any 401/403 spikes (could indicate credential stuffing against the
  shared admin key).
- Alert on repeated 401/403 on `/media/{key}` (signature forgery attempts) and on sustained traffic to
  `/upload-event-photo` / `/match-selfie` once F-01 is fixed and these routes should normally see zero
  unauthenticated traffic.

## 5. Header / platform policy
- Add standard security headers at the Next.js layer (CSP, `X-Content-Type-Options: nosniff` — already present
  on a couple of routes like `/media` and `/api/download`, extend project-wide — `Referrer-Policy`,
  `Permissions-Policy`, and HSTS at the edge/CDN).
- Consider a strict `Content-Security-Policy` given the app handles user-uploaded images and a watermark
  template editor (potential for stored content to be rendered back); verify no `dangerouslySetInnerHTML` is
  used anywhere rendering user-controlled strings (not found in the files read this pass, but a full
  project-wide grep for `dangerouslySetInnerHTML` is recommended as a follow-up since this audit did not open
  every frontend component).

## 6. Least privilege for storage credentials
- R2/Supabase S3-compatible credentials are documented as bypassing RLS (`config.py` comment on
  `supabase_s3_access_key_id`) — ensure these are backend-only (confirmed: no frontend code reads them
  directly) and scoped to the minimum bucket/path permissions the provider allows.

## 7. Biometric data handling
- Face embeddings are a form of biometric data. Document a retention policy (there is already a
  `backend/scripts/retention.py` and a `purge_event_faces` endpoint — good) and ensure consent is actually
  enforced on **every** path that generates embeddings, not just the hardened `public_router.post("/{slug}/match")`
  path (F-01 shows a bypass). Consider a periodic job that audits for orphaned `FaceEmbedding` rows whose
  parent event no longer has an active consent record.

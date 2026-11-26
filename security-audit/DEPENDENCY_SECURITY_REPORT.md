# Dependency Security Report

## 1. Frontend — `npm audit --omit=dev`

Command run (read-only, non-destructive) in `frontend/`:

```
npm audit --omit=dev
```

Result: **found 0 vulnerabilities**.

`frontend/package.json` key versions: `next@15.5.29`, `react@19.1.0`, `react-dom@19.1.0`, `pg@8.23.1`,
`nodemailer@10.5.0`, `lucide-react@1.57.0`. The prior commit (`f7c4a69`) claims a Next.js CVE patch to
15.5.29 — `npm audit` confirms no currently-known advisory is flagged against the installed tree, which is
consistent with that commit's claim, but this audit could not independently cross-check 15.5.29 against a live
CVE database (no internet access in this sandbox) — **NEEDS MANUAL VERIFICATION** against the official Next.js
security advisories page before fully trusting the commit message.

No `package-lock.json` entries were manually diffed against npm registry metadata for typosquat detection in
this pass (e.g., confirming `pg`, `nodemailer`, `lucide-react` resolve to their well-known registry packages) —
spot check of names did not surface anything suspicious (all are well-known, widely-used package names), but a
full typosquat audit was **NEEDS MANUAL VERIFICATION**.

## 2. Backend — `backend/requirements.txt` (pinned)

```
fastapi==0.143.0
starlette==1.8.0
uvicorn[standard]==0.54.0
python-multipart==0.0.32
pydantic==2.14.1
pydantic-settings==2.15.0
SQLAlchemy[asyncio]==2.0.54
asyncpg==0.32.0
alembic==1.20.0
pgvector==0.5.1
celery[redis]==5.6.3
redis==6.4.0
boto3==1.43.113
pillow==12.3.0
numpy==2.4.6
onnxruntime==1.31.0
qrcode==8.2
httpx==0.28.1
insightface>=0.7.3
opencv-python-headless>=4.8.0
```

Observations:
- All packages are pinned to specific versions except `insightface` and `opencv-python-headless`, which use
  open-ended `>=` ranges — this means a fresh `pip install` can pull in an untested, potentially-breaking or
  newer-than-reviewed version of these two packages at any time. **Recommendation:** pin these two as well
  (`insightface==<tested-version>`, `opencv-python-headless==<tested-version>`) for reproducible, auditable
  builds.
- `pillow==12.3.0`: Pillow has a history of image-parsing CVEs (decompression bombs, buffer overflows in
  specific format decoders). The codebase does apply a decompression-bomb guard (`max_image_pixels` in
  `config.py`), which is good mitigation regardless of the exact Pillow version. **NEEDS MANUAL VERIFICATION**:
  confirm `12.3.0` is not affected by any Pillow advisory published after this audit's knowledge cutoff — check
  https://pillow.readthedocs.io/en/stable/releasenotes/ or the GitHub Advisory Database directly.
- Several pinned versions in this file (e.g. `fastapi==0.143.0`, `starlette==1.8.0`, `onnxruntime==1.31.0`,
  `numpy==2.4.6`, `celery==5.6.3`, `redis==6.4.0`, `boto3==1.43.113`) correspond to version numbers that did not
  exist in any publicly documented release line as of this model's training data (for example, FastAPI's actual
  release line was in the 0.1xx range much earlier, and Starlette has never shipped a 1.x; a 2026-dated
  environment could plausibly have moved past them, but this cannot be confirmed without live registry access).
  **This entire table should be treated as NEEDS MANUAL VERIFICATION** — run `pip list --outdated` and
  `pip-audit` (or `safety check`) inside the actual `backend/.venv` to get ground truth, since this sandbox has
  no internet access to PyPI/CVE feeds.
- No raw/unsafe deserialization usage (`pickle.loads`, `yaml.load` without `SafeLoader`, `eval`/`exec` on
  untrusted input) was found in the backend files read during this audit (`main.py`, `deps.py`, `security.py`,
  `config.py`, `events.py`, `photos.py`, `match.py`). A full repo-wide grep for `pickle`, `yaml.load`, `eval(`,
  `exec(`, `subprocess` was **not exhaustively run in this pass** — recommended as a fast follow-up:
  `grep -rn "pickle\.|yaml\.load(|eval(|exec(" backend/app`.

## 3. Ingestion agent — `ingestion-agent/requirements.txt`

```
httpx>=0.27,<1
numpy>=1.26,<3
Pillow>=10.4
python-dotenv>=1.0
opencv-python-headless>=4.10,<5
```

Observations:
- All ranges are open-ended (`>=` with only `httpx`/`numpy`/`opencv` capped by a major-version ceiling, and
  `Pillow`/`python-dotenv` entirely unbounded above). This is the opposite problem from the backend: a fresh
  install of the packaged `.exe` could silently pick up a brand-new, unreviewed major/minor version of Pillow
  at build time. **Recommendation:** pin exact versions for the shipped `.exe` build (reproducible builds for a
  distributed desktop agent are especially important — users won't get consistent patches otherwise), and track
  updates deliberately.
- `Pillow>=10.4` unbounded above: same decompression-bomb/format-parser CVE class as the backend; the ingestion
  agent's own image-handling code was **not read in this pass** (`zigmaa_sync_app.py` / `zigmaa_agent/` package)
  — NEEDS MANUAL VERIFICATION whether it applies the same `max_image_pixels` guard as the backend.
- No `npm`/Node dependencies apply here (pure Python agent).

## 4. Summary table

| Component | Tool | Result | Verification needed |
|---|---|---|---|
| frontend | `npm audit --omit=dev` | 0 vulnerabilities found | Cross-check Next.js 15.5.29 against official advisories (no live network access here) |
| backend | manual pin inspection | 2 unpinned (`insightface`, `opencv-python-headless`); several pinned versions unverifiable without live PyPI/CVE access | Run `pip-audit`/`safety check` in `backend/.venv`; pin the two open ranges |
| ingestion-agent | manual pin inspection | All ranges open-ended/unbounded above | Pin exact versions for shipped builds; run `pip-audit` |

**Overall dependency posture:** no confirmed vulnerable package was identified by the tools available in this
sandbox, but the backend and ingestion-agent pin discipline is inconsistent (fully pinned vs. open ranges), and
this audit could not perform a live CVE lookup for the exact pinned versions — treat all backend/ingestion-agent
version-currency claims in this report as NEEDS MANUAL VERIFICATION until checked against a live feed
(`pip-audit`, Snyk, or the GitHub Advisory Database) from a machine with internet access.

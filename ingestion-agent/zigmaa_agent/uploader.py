"""Upload spooled stills through the backend's existing agent API (ingest key, upload-only role):

    POST /api/v1/events/{event_id}/photos/check-hashes   skip stills the event already has
    POST /api/v1/events/{event_id}/photos                multipart "files"; the server validates, de-duplicates
                                                         (SHA-256 per event), stores and indexes them

Files stay in ``pending/`` until the server confirms them, so a crash, timeout or reconnect can never lose a capture,
and a retried upload whose first attempt actually succeeded comes back as a server-side "duplicate", never twice.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from zigmaa_agent.capture import Spool, upload_name
from zigmaa_agent.config import AgentConfig

logger = logging.getLogger(__name__)

_CONTENT_TYPES = {".jpg": "image/jpeg", ".png": "image/png"}


class TransientUploadError(Exception):
    """Network problem, timeout, 5xx/503/429: keep files pending and retry with backoff."""


class FatalUploadError(Exception):
    """Wrong key, unknown or archived event: retrying cannot help; the agent stops."""


@dataclass
class FlushResult:
    created: int = 0
    duplicates: int = 0
    rejected: int = 0
    skipped_existing: int = 0
    photo_ids: list[str] = field(default_factory=list)

    @property
    def confirmed(self) -> int:
        return self.created + self.duplicates + self.skipped_existing


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _error_code(resp: httpx.Response) -> str | None:
    try:
        return resp.json().get("error", {}).get("code")
    except ValueError:
        return None


class Uploader:
    def __init__(self, cfg: AgentConfig, spool: Spool, *, transport: httpx.BaseTransport | None = None) -> None:
        self.cfg = cfg
        self.spool = spool
        self.base = f"{cfg.api_base_url}/api/v1/events/{cfg.event_id}/photos"
        self.client = httpx.Client(headers={"X-API-Key": cfg.ingest_api_key, "Accept": "application/json"},
                                   timeout=cfg.request_timeout_s, transport=transport)

    def close(self) -> None:
        self.client.close()

    def _post(self, url: str, **kwargs) -> httpx.Response:
        try:
            resp = self.client.post(url, **kwargs)
        except httpx.TimeoutException as exc:
            raise TransientUploadError(f"backend timed out ({type(exc).__name__})") from None
        except httpx.TransportError as exc:
            raise TransientUploadError(f"backend unreachable at {self.cfg.api_base_url} ({type(exc).__name__})") from None
        code = _error_code(resp)
        if resp.status_code in (401, 403):
            raise FatalUploadError(f"backend refused the ingest key (HTTP {resp.status_code}, {code}); "
                                   "check INGEST_API_KEY")
        if resp.status_code == 404:
            raise FatalUploadError(f"event {self.cfg.event_id} was not found; check EVENT_ID")
        if resp.status_code == 409:
            raise FatalUploadError(f"event {self.cfg.event_id} is archived and no longer accepts photos ({code})")
        if resp.status_code == 429 or resp.status_code >= 500:
            raise TransientUploadError(f"backend returned HTTP {resp.status_code} ({code or 'no error code'})")
        return resp

    def check_connection(self) -> None:
        """Verifies the backend is reachable, the key is accepted and the event exists (no data is written)."""
        resp = self._post(f"{self.base}/check-hashes", json={"hashes": []})
        if resp.status_code != 200:
            raise FatalUploadError(f"unexpected HTTP {resp.status_code} from check-hashes ({_error_code(resp)})")

    def flush_once(self) -> FlushResult:
        """Upload one batch of pending stills. Raises TransientUploadError/FatalUploadError; files whose outcome is
        unknown stay pending."""
        result = FlushResult()
        files = self.spool.list_pending(self.cfg.upload_batch_size)
        if not files:
            return result
        hashes = {p: _sha256(p) for p in files}

        resp = self._post(f"{self.base}/check-hashes", json={"hashes": list(hashes.values())})
        if resp.status_code == 200:
            existing = set(resp.json().get("existing", []))
            for p in [p for p in files if hashes[p] in existing]:
                self.spool.mark_uploaded(p, self.cfg.keep_uploaded)
                result.skipped_existing += 1
                logger.info("already on server, skipped: %s", p.name)
            files = [p for p in files if hashes[p] not in existing]
        if not files:
            return result
        if resp.status_code != 200:
            logger.warning("check-hashes returned HTTP %s; relying on server-side de-duplication", resp.status_code)

        handles = [open(p, "rb") for p in files]
        try:
            resp = self._post(self.base, data={"source": "agent"},
                              files=[("files", (upload_name(p), fh, _CONTENT_TYPES[p.suffix]))
                                     for p, fh in zip(files, handles)])
        finally:
            for fh in handles:
                fh.close()

        if resp.status_code == 413 and len(files) > 1:
            raise TransientUploadError("batch too large for the server; lower UPLOAD_BATCH_SIZE")
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code in (200, 201):
            items = body.get("items", [])
        elif resp.status_code in (413, 422) and isinstance((body.get("error") or {}).get("details"), dict):
            items = body["error"]["details"].get("items", [])
        elif resp.status_code == 413:
            items = [{"status": "rejected", "error_code": "payload_too_large", "error": "file too large"}]
        elif 400 <= resp.status_code < 500:
            raise FatalUploadError(f"backend rejected the upload request (HTTP {resp.status_code}, {_error_code(resp)})")
        else:
            raise TransientUploadError(f"unexpected HTTP {resp.status_code} from upload ({_error_code(resp)})")
        if len(items) != len(files):
            raise TransientUploadError("server response did not list every file; will retry (server de-duplicates)")

        for path, item in zip(files, items):
            status = item.get("status")
            if status in ("created", "duplicate"):
                self.spool.mark_uploaded(path, self.cfg.keep_uploaded)
                if status == "created":
                    result.created += 1
                    result.photo_ids.append(item.get("photo_id"))
                else:
                    result.duplicates += 1
                logger.info("%s: %s (photo %s)", path.name, status, item.get("photo_id"))
            elif item.get("error_code") == "storage_error":
                logger.warning("%s: server storage unavailable; will retry", path.name)
            else:
                self.spool.mark_rejected(path, item.get("error_code"), item.get("error"))
                result.rejected += 1
                logger.error("%s: rejected by server: %s (%s)", path.name, item.get("error"), item.get("error_code"))
        return result

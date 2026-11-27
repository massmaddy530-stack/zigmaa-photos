"""Cloud FTP Receiver for Zigmaa Moments (KVM2 VPS).

Authenticates cameras (Sony FX3, Canon EOS R, Nikon Z) against the user's saved
Camera Settings in PostgreSQL (`public.camera_settings`), receives photos into a
short-lived temp directory, forwards them straight to the local FastAPI backend
(which stores to Cloudflare R2 and runs AI face indexing), and deletes the temp
file immediately so no permanent local storage is used.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

import httpx
from pyftpdlib.authorizers import AuthenticationFailed, DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer
from sqlalchemy import create_engine, text

from app.core.config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [ftp_bridge] %(message)s",
)
logger = logging.getLogger("zigmaa.ftp_bridge")

ALLOWED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".mpo"}


def _sync_db_url(raw_url: str) -> str:
    if raw_url.startswith("postgresql+asyncpg://"):
        return raw_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+psycopg2://", 1)
    return raw_url


class CameraSettingsAuthorizer(DummyAuthorizer):
    """Authenticates FTP logins against `public.camera_settings` in PostgreSQL."""

    def __init__(self, db_engine, base_tmp: Path) -> None:
        super().__init__()
        self._engine = db_engine
        self._base_tmp = base_tmp
        self._lock = threading.Lock()
        self._cache: dict[str, dict] = {}
        self._last_refresh = 0.0

    def _refresh_cache(self) -> None:
        now = time.monotonic()
        if now - self._last_refresh < 5.0:
            return
        with self._lock:
            if time.monotonic() - self._last_refresh < 5.0:
                return
            try:
                with self._engine.connect() as conn:
                    rows = conn.execute(
                        text("SELECT user_key, config_json FROM public.camera_settings")
                    ).fetchall()
                new_cache: dict[str, dict] = {}
                for _user_key, cfg_raw in rows:
                    try:
                        cfg = json.loads(cfg_raw)
                    except Exception:
                        continue
                    if not cfg.get("ftpEnabled", True):
                        continue
                    uname = (cfg.get("ftpUsername") or "").strip()
                    pwd = cfg.get("ftpPassword") or ""
                    event_id = (cfg.get("targetEventId") or "").strip()
                    if uname and pwd and event_id:
                        new_cache[uname] = {
                            "password": pwd,
                            "event_id": event_id,
                            "cloud_only": bool(cfg.get("cloudOnlyMode", True)),
                        }
                self._cache = new_cache
                self._last_refresh = time.monotonic()
            except Exception as exc:
                logger.warning("Failed to refresh camera_settings from DB: %s", exc)

    def validate_authentication(self, username: str, password: str, handler) -> None:
        if username == "anonymous":
            raise AuthenticationFailed("Anonymous login disabled")
        self._refresh_cache()
        entry = self._cache.get(username)
        if not entry or not hmac.compare_digest(password.encode(), entry["password"].encode()):
            raise AuthenticationFailed("Invalid FTP username or password")

        home_dir = self._base_tmp / entry["event_id"]
        home_dir.mkdir(parents=True, exist_ok=True)
        # Register/update dynamic user entry for pyftpdlib session
        if self.has_user(username):
            self.remove_user(username)
        self.add_user(username, entry["password"], str(home_dir), perm="elradfmwMT")

    def get_event_id(self, username: str) -> str | None:
        return self._cache.get(username, {}).get("event_id")


class CloudUploadFTPHandler(FTPHandler):
    """Forwards each uploaded image directly to FastAPI -> Cloudflare R2 and cleans temp file."""

    api_base: str = "http://127.0.0.1:8000"
    api_key: str = ""

    def on_file_received(self, file: str) -> None:
        path = Path(file)
        ext = path.suffix.lower()
        if ext not in ALLOWED_EXTS:
            logger.info("Ignoring non-image FTP upload: %s", path.name)
            path.unlink(missing_ok=True)
            return

        event_id = self.authorizer.get_event_id(self.username)
        if not event_id:
            logger.warning("No targetEventId for FTP user %s; dropping %s", self.username, path.name)
            path.unlink(missing_ok=True)
            return

        threading.Thread(
            target=self._forward_to_api,
            args=(path, event_id),
            daemon=True,
        ).start()

    def _forward_to_api(self, path: Path, event_id: str) -> None:
        url = f"{self.api_base.rstrip('/')}/api/v1/events/{event_id}/photos"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            with path.open("rb") as f:
                resp = httpx.post(
                    url,
                    headers=headers,
                    files={"files": (path.name, f, "image/jpeg")},
                    timeout=60.0,
                )
            if resp.status_code in (200, 201):
                logger.info("Cloud FTP synced %s -> event %s", path.name, event_id)
            else:
                logger.warning("Cloud FTP upload failed (%s) for %s: %s", resp.status_code, path.name, resp.text[:200])
        except Exception as exc:
            logger.error("Cloud FTP upload error for %s: %s", path.name, exc)
        finally:
            path.unlink(missing_ok=True)


def main() -> None:
    settings = get_settings()
    api_key = (
        (settings.ingest_api_key.get_secret_value() if settings.ingest_api_key else None)
        or (settings.admin_api_key.get_secret_value() if settings.admin_api_key else None)
        or ""
    )
    if not api_key:
        raise RuntimeError("ADMIN_API_KEY or INGEST_API_KEY must be set")

    sync_url = _sync_db_url(settings.database_url)
    # Remove asyncpg-specific ?ssl=require if needed for psycopg2
    if "ssl=" in sync_url and "sslmode=" not in sync_url:
        sync_url = sync_url.replace("ssl=", "sslmode=")
    engine = create_engine(sync_url, pool_pre_ping=True, pool_size=2, max_overflow=2)

    base_tmp = Path(tempfile.mkdtemp(prefix="zigmaa-ftp-"))
    authorizer = CameraSettingsAuthorizer(engine, base_tmp)

    handler = CloudUploadFTPHandler
    handler.authorizer = authorizer
    handler.api_base = os.environ.get("FTP_API_BASE", "http://127.0.0.1:8000")
    handler.api_key = api_key
    handler.banner = "Zigmaa Moments Cloud FTP Ready"
    handler.masquerade_address = os.environ.get("FTP_PUBLIC_IP", "189.72.182.173")
    handler.passive_ports = range(60000, 60050)

    port = int(os.environ.get("FTP_PORT", "2121"))
    server = FTPServer(("0.0.0.0", port), handler)
    server.max_cons = 64
    server.max_cons_per_ip = 16

    logger.info("Cloud FTP listening on 0.0.0.0:%d (PASV public IP %s, ports 60000-60049)", port, handler.masquerade_address)
    try:
        server.serve_forever()
    finally:
        shutil.rmtree(base_tmp, ignore_errors=True)


if __name__ == "__main__":
    main()

"""Agent configuration from environment variables (and ingestion-agent/.env). Secrets are never logged."""

from __future__ import annotations

import ipaddress
import os
import re
import socket
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

AGENT_DIR = Path(__file__).resolve().parents[1]


class ConfigError(Exception):
    """Invalid or missing configuration (message never contains secret values)."""


def redact_url(url: str) -> str:
    """Hide any user:password part of a URL."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "<invalid url>"
    if parts.username is None and parts.password is None:
        return url
    host = parts.hostname or ""
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, f"***@{host}", parts.path, parts.query, parts.fragment))


def is_private_host(host: str, resolve=socket.getaddrinfo) -> bool:
    """True if every address the host resolves to is private, loopback or link-local (i.e. on the LAN)."""
    try:
        addrs = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            addrs = {ipaddress.ip_address(info[4][0].split("%")[0]) for info in resolve(host, None)}
        except (OSError, ValueError):
            return False
    return bool(addrs) and all(a.is_private or a.is_loopback or a.is_link_local for a in addrs)


def _bool(v: str | None, default: bool) -> bool:
    return default if v in (None, "") else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class AgentConfig:
    api_base_url: str
    ingest_api_key: str = field(repr=False)
    event_id: uuid.UUID
    camera_source: str = "mock"  # mock | rtsp | folder
    camera_name: str = "cam1"
    rtsp_url: str = field(default="", repr=False)
    camera_username: str = field(default="", repr=False)
    camera_password: str = field(default="", repr=False)
    rtsp_transport: str = "tcp"
    camera_allow_public: bool = False
    camera_open_timeout_s: float = 10.0
    camera_stale_after_s: float = 10.0
    capture_mode: str = "interval"  # interval | motion
    capture_interval_s: float = 10.0
    motion_threshold: float = 0.02
    motion_cooldown_s: float = 5.0
    motion_check_interval_s: float = 0.5
    jpeg_quality: int = 92
    max_upload_bytes: int = 40 * 1024 * 1024
    spool_dir: Path = AGENT_DIR / "spool"
    keep_uploaded: bool = True
    upload_batch_size: int = 10
    upload_interval_s: float = 2.0
    request_timeout_s: float = 60.0
    reconnect_min_s: float = 1.0
    reconnect_max_s: float = 60.0
    mock_image_dir: Path | None = None
    mock_scene_seconds: float = 10.0
    mock_drop_every_n_reads: int = 0
    watch_folder: Path | None = None
    folder_recursive: bool = False
    folder_poll_interval_s: float = 2.0
    file_stable_seconds: float = 3.0
    folder_include_png: bool = True
    folder_include_existing: bool = False

    @property
    def is_mock(self) -> bool:
        return self.camera_source == "mock"

    @property
    def is_folder(self) -> bool:
        return self.camera_source == "folder"

    @property
    def event_spool(self) -> Path:
        return self.spool_dir / str(self.event_id)

    def camera_url(self) -> str:
        """RTSP URL including credentials (for the capture library only; never log this)."""
        if not self.camera_username:
            return self.rtsp_url
        parts = urlsplit(self.rtsp_url)
        host = parts.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        if parts.port:
            host = f"{host}:{parts.port}"
        userinfo = quote(self.camera_username, safe="")
        if self.camera_password:
            userinfo += ":" + quote(self.camera_password, safe="")
        return urlunsplit((parts.scheme, f"{userinfo}@{host}", parts.path, parts.query, parts.fragment))

    def secrets(self) -> list[str]:
        """Values that must never appear in logs or status files."""
        values = [self.ingest_api_key, self.camera_password, self.camera_username]
        if self.rtsp_url:
            parts = urlsplit(self.rtsp_url)
            values += [parts.password or "", parts.username or "", self.camera_url()]
            if parts.username or parts.password:
                values.append(self.rtsp_url)
        out = []
        for v in values:
            if v and len(v) >= 3:
                out += [v, quote(v, safe="")]
        return sorted(set(out), key=len, reverse=True)

    def describe(self) -> dict:
        """Safe, human-readable summary for logs."""
        return {
            "api": self.api_base_url, "event_id": str(self.event_id), "source": self.camera_source,
            "camera": self.camera_name, "rtsp": redact_url(self.rtsp_url) if self.rtsp_url else None,
            "credentials": "set" if (self.camera_username or urlsplit(self.rtsp_url).username) else "none",
            "mode": self.capture_mode if not self.is_folder else None,
            "interval_s": self.capture_interval_s if self.capture_mode == "interval" and not self.is_folder else None,
            "watch_folder": str(self.watch_folder) if self.is_folder else None,
            "recursive": self.folder_recursive if self.is_folder else None,
            "spool": str(self.event_spool), "keep_uploaded": self.keep_uploaded,
        }


def load_config(env: dict[str, str] | None = None, *, env_file: Path | None = AGENT_DIR / ".env",
                resolve=socket.getaddrinfo) -> AgentConfig:
    """Build and validate the configuration. Real environment variables override the .env file."""
    if env is None:
        env = {}
        if env_file and env_file.exists():
            from dotenv import dotenv_values

            env.update({k: v for k, v in dotenv_values(env_file).items() if v is not None})
        env.update(os.environ)
    errors: list[str] = []

    def get(key: str, default: str = "") -> str:
        return (env.get(key) or default).strip()

    def num(key: str, default: float, lo: float, hi: float, cast=float):
        raw = get(key)
        try:
            value = cast(raw) if raw else default
        except ValueError:
            errors.append(f"{key} must be a number")
            return default
        if not lo <= value <= hi:
            errors.append(f"{key} must be between {lo} and {hi}")
        return value

    api = get("API_BASE_URL", "http://localhost:8000").rstrip("/")
    if urlsplit(api).scheme not in ("http", "https") or not urlsplit(api).hostname:
        errors.append("API_BASE_URL must be an http(s) URL")
    key = get("INGEST_API_KEY")
    if not key:
        errors.append("INGEST_API_KEY is required (the backend's upload-only ingest key)")
    try:
        event_id = uuid.UUID(get("EVENT_ID"))
    except ValueError:
        errors.append("EVENT_ID is required and must be the event's UUID (see the dashboard URL)")
        event_id = uuid.UUID(int=0)

    source = get("CAMERA_SOURCE", "mock").lower()
    if source not in ("mock", "rtsp", "folder"):
        errors.append("CAMERA_SOURCE must be 'mock', 'rtsp' or 'folder'")
    name = get("CAMERA_NAME", "cam1")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", name):
        errors.append("CAMERA_NAME may only contain letters, digits, '-' and '_' (max 32)")
    mode = get("CAPTURE_MODE", "interval").lower()
    if mode not in ("interval", "motion"):
        errors.append("CAPTURE_MODE must be 'interval' or 'motion'")
    transport = get("CAMERA_RTSP_TRANSPORT", "tcp").lower()
    if transport not in ("tcp", "udp"):
        errors.append("CAMERA_RTSP_TRANSPORT must be 'tcp' or 'udp'")

    rtsp_url = get("CAMERA_RTSP_URL")
    allow_public = _bool(env.get("CAMERA_ALLOW_PUBLIC"), False)
    if source == "rtsp":
        parts = urlsplit(rtsp_url) if rtsp_url else None
        if not parts or parts.scheme not in ("rtsp", "rtsps") or not parts.hostname:
            errors.append("CAMERA_RTSP_URL must be an rtsp:// URL from your camera's manual "
                          "(e.g. rtsp://192.168.1.50:554/<path>)")
        elif not allow_public and not is_private_host(parts.hostname, resolve):
            errors.append("CAMERA_RTSP_URL must point to a private LAN address (192.168.x.x, 10.x.x.x, "
                          "172.16-31.x.x). Never expose a camera through port forwarding.")
        if get("CAMERA_USERNAME") and parts and (parts.username or parts.password):
            errors.append("Put camera credentials either in CAMERA_RTSP_URL or in CAMERA_USERNAME/CAMERA_PASSWORD, "
                          "not both")

    mock_dir = get("MOCK_IMAGE_DIR")
    mock_path = Path(mock_dir).expanduser() if mock_dir else None
    if source == "mock" and mock_path and not mock_path.is_dir():
        errors.append("MOCK_IMAGE_DIR does not exist or is not a folder")
    spool = Path(get("SPOOL_DIR") or AGENT_DIR / "spool").expanduser()

    watch_raw = get("WATCH_FOLDER")
    watch = Path(watch_raw).expanduser() if watch_raw else None
    recursive = _bool(env.get("FOLDER_RECURSIVE"), False)
    if source == "folder":
        if watch is None:
            errors.append("WATCH_FOLDER is required for CAMERA_SOURCE=folder (the folder your camera software "
                          r"saves photos into, e.g. C:\EventPhotos)")
        else:
            # The spool must never be scanned as camera input (the agent would re-ingest its own copies).
            w, s = watch.resolve(), spool.resolve()
            if w == s or w in s.parents or s in w.parents:
                errors.append("WATCH_FOLDER and SPOOL_DIR must not contain each other")
        # A missing WATCH_FOLDER is not a config error: it may be a memory card or share that appears later.

    cfg = AgentConfig(
        api_base_url=api, ingest_api_key=key, event_id=event_id, camera_source=source, camera_name=name,
        rtsp_url=rtsp_url, camera_username=get("CAMERA_USERNAME"), camera_password=env.get("CAMERA_PASSWORD") or "",
        rtsp_transport=transport, camera_allow_public=allow_public,
        camera_open_timeout_s=num("CAMERA_OPEN_TIMEOUT_S", 10.0, 1, 120),
        camera_stale_after_s=num("CAMERA_STALE_AFTER_S", 10.0, 1, 300),
        capture_mode=mode,
        capture_interval_s=num("CAPTURE_INTERVAL_S", 10.0, 1, 86400),
        motion_threshold=num("MOTION_THRESHOLD", 0.02, 0.001, 1.0),
        motion_cooldown_s=num("MOTION_COOLDOWN_S", 5.0, 0, 3600),
        motion_check_interval_s=num("MOTION_CHECK_INTERVAL_S", 0.5, 0.1, 60),
        jpeg_quality=num("JPEG_QUALITY", 92, 50, 100, int),
        max_upload_bytes=num("MAX_UPLOAD_BYTES", 40 * 1024 * 1024, 1024, 1024**3, int),
        spool_dir=spool, keep_uploaded=_bool(env.get("KEEP_UPLOADED"), True),
        upload_batch_size=num("UPLOAD_BATCH_SIZE", 10, 1, 50, int),
        upload_interval_s=num("UPLOAD_INTERVAL_S", 2.0, 0.1, 3600),
        request_timeout_s=num("REQUEST_TIMEOUT_S", 60.0, 1, 600),
        reconnect_min_s=num("RECONNECT_MIN_S", 1.0, 0.1, 600),
        reconnect_max_s=num("RECONNECT_MAX_S", 60.0, 1, 3600),
        mock_image_dir=mock_path, mock_scene_seconds=num("MOCK_SCENE_SECONDS", 10.0, 0.1, 3600),
        mock_drop_every_n_reads=num("MOCK_DROP_EVERY_N_READS", 0, 0, 10**6, int),
        watch_folder=watch, folder_recursive=recursive,
        folder_poll_interval_s=num("FOLDER_POLL_INTERVAL_S", 2.0, 0.2, 3600),
        file_stable_seconds=num("FILE_STABLE_SECONDS", 3.0, 0, 3600),
        folder_include_png=_bool(env.get("FOLDER_INCLUDE_PNG"), True),
        folder_include_existing=_bool(env.get("FOLDER_INCLUDE_EXISTING"), False),
    )
    if cfg.reconnect_min_s > cfg.reconnect_max_s:
        errors.append("RECONNECT_MIN_S must not exceed RECONNECT_MAX_S")
    if errors:
        raise ConfigError("Invalid agent configuration:\n  - " + "\n  - ".join(errors))
    return cfg

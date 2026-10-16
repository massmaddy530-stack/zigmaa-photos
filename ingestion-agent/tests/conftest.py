"""Fixtures: a fake backend that mirrors the real agent API (per-event SHA-256 de-duplication, check-hashes, response
shapes and error codes) and a fake OpenCV capture device, so no network, server or camera is needed."""

from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
from pathlib import Path

import httpx
import numpy as np
import pytest
from PIL import Image

from zigmaa_agent.capture import Spool
from zigmaa_agent.config import load_config
from zigmaa_agent.uploader import Uploader

INGEST_KEY = "test-ingest-key-0123456789abcdef"
CAM_PASSWORD = "s3cr3t-cam-pa$$"
EVENT = uuid.UUID("11111111-2222-3333-4444-555555555555")


def private_resolver(host, _port):
    return [(None, None, None, None, ("192.168.1.50", 0))]


@pytest.fixture
def make_cfg(tmp_path):
    def _make(**overrides):
        env = {"API_BASE_URL": "http://backend.test", "INGEST_API_KEY": INGEST_KEY, "EVENT_ID": str(EVENT),
               "CAMERA_SOURCE": "mock", "SPOOL_DIR": str(tmp_path / "spool"), "RECONNECT_MIN_S": "0.1",
               "RECONNECT_MAX_S": "1", "CAPTURE_INTERVAL_S": "1"}
        env.update({k: str(v) for k, v in overrides.items()})
        return load_config(env, env_file=None, resolve=private_resolver)
    return _make


class FakeBackend:
    """In-memory stand-in for POST /api/v1/events/{id}/photos[/check-hashes]."""

    def __init__(self, events=(EVENT,), archived=()):
        self.events = {str(e) for e in events}
        self.archived = {str(e) for e in archived}
        self.photos: dict[tuple[str, str], str] = {}  # (event, sha) -> photo id
        self.requests: list[httpx.Request] = []
        self.fail_next: list = []  # queue of: int status | "connect" | "timeout_after_store"
        self.upload_calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        m = re.fullmatch(r"/api/v1/events/([^/]+)/photos(/check-hashes)?", request.url.path)
        assert m, request.url.path
        if request.headers.get("X-API-Key") != INGEST_KEY:
            return httpx.Response(401, json={"error": {"code": "unauthorized", "message": "Invalid API key"}})
        event = m.group(1)
        if event not in self.events:
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "Event not found"}})
        if m.group(2):
            hashes = json.loads(request.content)["hashes"]
            return httpx.Response(200, json={"existing": [h for h in hashes if (event, h) in self.photos]})

        self.upload_calls += 1
        mode = self.fail_next.pop(0) if self.fail_next else None
        if mode == "connect":
            raise httpx.ConnectError("connection refused", request=request)
        if isinstance(mode, int):
            return httpx.Response(mode, json={"error": {"code": "storage_unavailable", "message": "x"}})
        if event in self.archived:
            return httpx.Response(409, json={"error": {"code": "event_archived", "message": "archived"}})
        items = []
        for name, data in self._files(request):
            sha = hashlib.sha256(data).hexdigest()
            try:
                with Image.open(io.BytesIO(data)) as im:
                    im.load()
            except Exception:  # noqa: BLE001
                items.append({"filename": name, "status": "rejected", "photo_id": None,
                              "error_code": "corrupt_image", "error": "Image file is corrupt or truncated"})
                continue
            if (event, sha) in self.photos:
                items.append({"filename": name, "status": "duplicate", "photo_id": self.photos[(event, sha)]})
            else:
                pid = str(uuid.uuid4())
                self.photos[(event, sha)] = pid
                items.append({"filename": name, "status": "created", "photo_id": pid})
        if mode == "timeout_after_store":  # stored, but the response never reaches the agent
            raise httpx.ReadTimeout("timed out", request=request)
        created = sum(i["status"] == "created" for i in items)
        dups = sum(i["status"] == "duplicate" for i in items)
        body = {"created": created, "duplicates": dups, "rejected": len(items) - created - dups, "items": items}
        if created:
            return httpx.Response(201, json=body)
        if dups:
            return httpx.Response(200, json=body)
        return httpx.Response(422, json={"error": {"code": "all_files_rejected", "message": "x", "details": body}})

    @staticmethod
    def _files(request: httpx.Request):
        ctype = request.headers["content-type"]
        boundary = ctype.split("boundary=")[1].encode()
        out = []
        for part in request.content.split(b"--" + boundary):
            if b'name="files"' not in part:
                continue
            head, _, body = part.partition(b"\r\n\r\n")
            name = re.search(rb'filename="([^"]+)"', head).group(1).decode()
            out.append((name, body[:-2]))  # strip trailing CRLF
        return out


@pytest.fixture
def backend():
    return FakeBackend()


@pytest.fixture
def make_uploader(backend):
    def _make(cfg):
        spool = Spool(cfg.event_spool)
        return Uploader(cfg, spool, transport=httpx.MockTransport(backend.handler)), spool
    return _make


def jpeg_bytes(color=(200, 50, 50), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


class FakeCapture:
    """Mimics cv2.VideoCapture: BGR frames, isOpened/read/release. Fails after ``fail_after`` reads."""

    def __init__(self, opened=True, fail_after=None, frame=None):
        self._opened = opened
        self.fail_after = fail_after
        self.reads = 0
        self.released = False
        self.frame = frame if frame is not None else np.full((120, 160, 3), (10, 20, 230), np.uint8)  # BGR red

    def isOpened(self):  # noqa: N802 - OpenCV naming
        return self._opened

    def read(self):
        self.reads += 1
        if self.fail_after is not None and self.reads > self.fail_after:
            return False, None
        return True, self.frame.copy()

    def release(self):
        self.released = True


@pytest.fixture
def spool_files():
    def _list(spool: Spool, kind: str) -> list[Path]:
        return sorted(getattr(spool, kind).glob("*.jpg"))
    return _list

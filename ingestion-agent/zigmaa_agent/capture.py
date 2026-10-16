"""Turning frames into stills: validation, JPEG encoding, motion triggering and the local spool.

Spool layout (one folder per event, so a capture always stays with the event it was taken for):

    spool/<event_id>/pending/    captured, waiting for upload (written atomically)
    spool/<event_id>/uploaded/   confirmed by the server (created or duplicate); kept only if KEEP_UPLOADED=true
    spool/<event_id>/rejected/   permanently rejected by the server, with a .json reason next to each file
    spool/<event_id>/status.json live agent status
    spool/<event_id>/agent.lock  held while an agent runs for this event (one uploader per spool)

Folder-mode files keep their original bytes and name: ``<camera>_<stamp>_<seq>_<sha12>__<original stem>.jpg``.
"""

from __future__ import annotations

import hashlib
import io
import itertools
import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

MIN_SIDE = 16  # the backend rejects smaller images
SPOOL_SUFFIXES = (".jpg", ".png")
LABEL_SEP = "__"


class FrameError(Exception):
    """A frame that must not be uploaded (malformed, empty, too large...)."""


@dataclass(frozen=True)
class Still:
    path: Path
    sha256: str
    size: int


def validate_frame(frame: object) -> np.ndarray:
    if not isinstance(frame, np.ndarray):
        raise FrameError(f"frame is {type(frame).__name__}, not an image array")
    if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
        raise FrameError(f"unexpected frame layout {frame.dtype} {frame.shape}")
    h, w = frame.shape[:2]
    if h < MIN_SIDE or w < MIN_SIDE:
        raise FrameError(f"frame too small ({w}x{h})")
    return frame


def encode_jpeg(frame: np.ndarray, quality: int, max_bytes: int) -> bytes:
    """Encode once (camera frames are raw pixels, so this is the only lossy step) and verify it decodes."""
    frame = validate_frame(frame)
    buf = io.BytesIO()
    Image.fromarray(frame, "RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    data = buf.getvalue()
    if len(data) > max_bytes:
        raise FrameError(f"encoded still is {len(data)} bytes, over the {max_bytes} byte upload limit")
    try:
        with Image.open(io.BytesIO(data)) as check:
            check.load()
    except Exception as exc:  # noqa: BLE001
        raise FrameError(f"encoded still does not decode ({type(exc).__name__})") from exc
    return data


class MotionDetector:
    """Cheap frame differencing on a small greyscale copy. Returns True when the fraction of changed pixels
    exceeds ``threshold`` and the cooldown has passed. The first frame only sets the baseline."""

    def __init__(self, threshold: float, cooldown_s: float, pixel_delta: int = 25, width: int = 160) -> None:
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self.pixel_delta = pixel_delta
        self.width = width
        self._prev: np.ndarray | None = None
        self._last_trigger = float("-inf")
        self.last_score = 0.0

    def _small(self, frame: np.ndarray) -> np.ndarray:
        img = Image.fromarray(frame, "RGB").convert("L")
        h = max(1, round(img.height * self.width / img.width))
        return np.asarray(img.resize((self.width, h), Image.Resampling.BILINEAR), dtype=np.int16)

    def reset(self) -> None:
        self._prev = None  # after a reconnect the view may differ; don't treat that as motion

    def update(self, frame: np.ndarray, now: float) -> bool:
        small = self._small(frame)
        prev, self._prev = self._prev, small
        if prev is None or prev.shape != small.shape:
            return False
        self.last_score = float(np.mean(np.abs(small - prev) > self.pixel_delta))
        if self.last_score >= self.threshold and now - self._last_trigger >= self.cooldown_s:
            self._last_trigger = now
            return True
        return False


def _label(name: str) -> str:
    """Original file stem reduced to characters that are safe in a Windows filename (Unicode letters are kept)."""
    return re.sub(r"[^\w-]+", "_", name).strip("_")[:80]


def upload_name(path: Path) -> str:
    """The filename the server records: the camera's original name for folder-mode files, else the spool name."""
    _, sep, original = path.name.partition(LABEL_SEP)
    return original if sep and original else path.name


class Spool:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.pending = root / "pending"
        self.uploaded = root / "uploaded"
        self.rejected = root / "rejected"
        for d in (self.pending, self.uploaded, self.rejected):
            d.mkdir(parents=True, exist_ok=True)
        self._seq = itertools.count(1)

    def save(self, data: bytes, camera: str, *, mock: bool, suffix: str = ".jpg", label: str | None = None) -> Still:
        digest = hashlib.sha256(data).hexdigest()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        suffix = ".jpg" if suffix.lower() in (".jpg", ".jpeg") else suffix.lower()
        if suffix not in SPOOL_SUFFIXES:
            raise ValueError(f"unsupported spool file type {suffix}")
        tail = f"{LABEL_SEP}{_label(label)}" if label and _label(label) else ""
        name = f"{'MOCK_' if mock else ''}{camera}_{stamp}_{next(self._seq):05d}_{digest[:12]}{tail}{suffix}"
        final = self.pending / name
        tmp = final.with_name(name + ".part")
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, final)  # atomic: the uploader never sees half-written files
        return Still(final, digest, len(data))

    @staticmethod
    def _files(folder: Path) -> list[Path]:
        return sorted(p for p in folder.iterdir() if p.suffix in SPOOL_SUFFIXES and p.is_file())

    def list_pending(self, limit: int | None = None) -> list[Path]:
        files = self._files(self.pending)
        return files[:limit] if limit else files

    def mark_uploaded(self, path: Path, keep: bool) -> None:
        if keep:
            os.replace(path, self.uploaded / path.name)
        else:
            path.unlink(missing_ok=True)

    def mark_rejected(self, path: Path, code: str | None, message: str | None) -> None:
        os.replace(path, self.rejected / path.name)
        (self.rejected / (path.name + ".json")).write_text(
            json.dumps({"error_code": code, "error": message,
                        "rejected_at": datetime.now(timezone.utc).isoformat()}, indent=2), encoding="utf-8")

    def counts(self) -> dict[str, int]:
        return {"pending": len(self._files(self.pending)),
                "uploaded_kept": len(self._files(self.uploaded)),
                "rejected": len(self._files(self.rejected))}


class SpoolLockedError(Exception):
    """Another agent process is already running for this event."""


class SpoolLock:
    """Exclusive OS file lock on ``<spool>/agent.lock``. Two agents uploading the same spool could send the same file
    twice in parallel; this makes the second one stop instead. The OS drops the lock if the process dies."""

    def __init__(self, root: Path) -> None:
        self.path = root / "agent.lock"
        self._fh = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(self.path, "a+b")
        try:
            fh.seek(0)
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            raise SpoolLockedError(f"another agent is already running for this event (lock: {self.path})") from None
        self._fh = fh

    def release(self) -> None:
        if self._fh is None:
            return
        try:
            if sys.platform == "win32":
                import msvcrt

                self._fh.seek(0)
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
        finally:
            self._fh.close()  # closing also releases flock()
            self._fh = None

    def __enter__(self) -> "SpoolLock":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()

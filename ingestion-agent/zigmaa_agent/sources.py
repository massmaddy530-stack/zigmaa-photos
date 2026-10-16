"""Frame sources: a mock camera (no hardware needed) and a generic RTSP camera (via OpenCV/FFmpeg).
The folder source (camera software saving files to a folder) lives in ``folder.py``.

A source yields the *latest* frame as an RGB ``numpy.ndarray`` (H x W x 3, uint8). The agent decides when to keep
a still; sources never write files.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from zigmaa_agent.config import AgentConfig, redact_url

logger = logging.getLogger(__name__)

MOCK_LABEL = "MOCK CAPTURE - NOT A REAL CAMERA"
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".mpo"}


class SourceError(Exception):
    """The camera cannot deliver a frame right now (disconnected, timed out, ...). Triggers a reconnect."""


class FrameSource(Protocol):
    name: str
    is_mock: bool

    def open(self) -> None: ...

    def read(self) -> np.ndarray: ...

    def close(self) -> None: ...


# --------------------------------------------------------------------------- mock


class MockSource:
    """Produces valid, clearly labelled test frames. Scenes change every ``scene_seconds`` (so motion mode
    triggers), and every frame carries a timestamp so each capture is unique. With ``image_dir`` set it cycles
    through your own sample photos instead (useful for testing face matching end to end)."""

    is_mock = True

    def __init__(self, name: str, *, image_dir: Path | None = None, scene_seconds: float = 10.0,
                 drop_every_n_reads: int = 0, size: tuple[int, int] = (1280, 720), clock=time.monotonic) -> None:
        self.name = name
        self.scene_seconds = scene_seconds
        self.drop_every = drop_every_n_reads
        self.size = size
        self.clock = clock
        self.images = sorted(p for p in image_dir.iterdir() if p.suffix.lower() in _IMAGE_SUFFIXES) if image_dir else []
        if image_dir and not self.images:
            raise SourceError("MOCK_IMAGE_DIR contains no .jpg/.jpeg/.png/.webp images")
        self._opened = False
        self._reads = 0
        self._t0 = 0.0
        self._cache: dict[int, Image.Image] = {}

    def open(self) -> None:
        self._opened = True
        self._t0 = self.clock()

    def close(self) -> None:
        self._opened = False

    def _scene(self, index: int) -> Image.Image:
        if self.images:
            key = index % len(self.images)
            if key not in self._cache:
                with Image.open(self.images[key]) as im:
                    im = ImageOps.exif_transpose(im).convert("RGB")
                    im.thumbnail((1920, 1920))
                    self._cache = {key: im}  # keep only one decoded image in memory
            return self._cache[key].copy()
        w, h = self.size
        hue = (index * 67) % 255
        img = Image.new("RGB", (w, h), (40 + hue // 3, 60, 200 - hue // 2))
        d = ImageDraw.Draw(img)
        x = 80 + (index * 173) % (w - 400)
        d.rectangle([x, 160, x + 300, 520], fill=(250, 220 - hue // 4, 60))
        d.ellipse([w - 360, 220, w - 120, 460], fill=(30, 160 + hue // 3, 90))
        return img

    def read(self) -> np.ndarray:
        if not self._opened:
            raise SourceError("mock camera is not connected")
        self._reads += 1
        if self.drop_every and self._reads % self.drop_every == 0:
            self._opened = False
            raise SourceError(f"simulated mock disconnect after read {self._reads}")
        index = int((self.clock() - self._t0) // self.scene_seconds)
        img = self._scene(index)
        d = ImageDraw.Draw(img)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"
        banner_h = max(30, img.height // 18)
        d.rectangle([0, 0, img.width, banner_h], fill=(200, 0, 0))
        d.text((6, 3), MOCK_LABEL, fill=(255, 255, 255))
        d.text((6, banner_h // 2), f"#{self._reads} {stamp} {self.name} scene {index}", fill=(255, 255, 255))
        frame = np.array(img, dtype=np.uint8)
        # A small per-frame noise patch guarantees every mock capture is a distinct file, even at tiny sizes
        # where banner text gets clipped (identical captures would otherwise be skipped as duplicates).
        rng = np.random.default_rng(self._reads + time.time_ns())
        frame[-12:, -12:] = rng.integers(0, 256, (min(12, frame.shape[0]), min(12, frame.shape[1]), 3), np.uint8)
        return frame


# --------------------------------------------------------------------------- RTSP


class RtspSource:
    """Generic RTSP camera. Each camera model has its own stream path, so the full URL comes from configuration.

    A background thread keeps reading so ``read()`` always returns the newest frame (OpenCV otherwise hands back
    stale buffered frames). Only the latest frame is held in memory; nothing is written to disk here.
    """

    is_mock = False

    def __init__(self, cfg: AgentConfig, *, capture_factory=None) -> None:
        self.name = cfg.camera_name
        self._url = cfg.camera_url()
        self._safe_url = redact_url(cfg.rtsp_url)
        self._transport = cfg.rtsp_transport
        self._open_timeout_ms = int(cfg.camera_open_timeout_s * 1000)
        self._stale_after = cfg.camera_stale_after_s
        self._factory = capture_factory or self._opencv_capture
        self._cap = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._frame_at = 0.0
        self._error: str | None = None

    def _opencv_capture(self, url: str):
        # Quiet FFmpeg (its messages can echo the stream URL) and pick the RTSP transport.
        os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "-8")
        os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{self._transport}"
        import cv2

        if hasattr(cv2, "setLogLevel"):
            cv2.setLogLevel(0)
        params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self._open_timeout_ms,
                  cv2.CAP_PROP_READ_TIMEOUT_MSEC, self._open_timeout_ms]
        return cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)

    def open(self) -> None:
        self.close()
        try:
            cap = self._factory(self._url)
        except Exception as exc:  # noqa: BLE001 - library errors may contain the URL; report the type only
            raise SourceError(f"could not open {self._safe_url} ({type(exc).__name__})") from None
        if cap is None or not cap.isOpened():
            if cap is not None:
                cap.release()
            raise SourceError(f"could not connect to {self._safe_url} (check IP, port, stream path, "
                              "credentials and that the PC is on the camera's network)")
        ok, frame = cap.read()
        if not ok or frame is None:
            cap.release()
            raise SourceError(f"connected to {self._safe_url} but received no video frame")
        self._cap = cap
        self._set_frame(frame)
        self._stop.clear()
        self._thread = threading.Thread(target=self._reader, name=f"rtsp-{self.name}", daemon=True)
        self._thread.start()

    def _set_frame(self, bgr: np.ndarray) -> None:
        rgb = bgr[:, :, ::-1] if bgr.ndim == 3 and bgr.shape[2] == 3 else bgr
        with self._lock:
            self._frame = np.ascontiguousarray(rgb)
            self._frame_at = time.monotonic()

    def _reader(self) -> None:
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok or frame is None:
                with self._lock:
                    self._error = "stream ended or read timed out"
                return
            self._set_frame(frame)

    def read(self) -> np.ndarray:
        with self._lock:
            frame, age, err = self._frame, time.monotonic() - self._frame_at, self._error
        if self._cap is None:
            raise SourceError("camera is not connected")
        if err or frame is None or age > self._stale_after:
            raise SourceError(err or f"no new frame for {age:.0f}s")
        return frame

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:  # noqa: BLE001
                pass
        self._cap, self._thread, self._frame, self._error = None, None, None, None


def build_source(cfg: AgentConfig, spool=None) -> FrameSource:
    if cfg.is_folder:
        from zigmaa_agent.folder import FolderSource  # imports this module

        if spool is None:
            raise SourceError("folder source needs the event spool")
        return FolderSource(cfg, spool)
    if cfg.is_mock:
        return MockSource(cfg.camera_name, image_dir=cfg.mock_image_dir, scene_seconds=cfg.mock_scene_seconds,
                          drop_every_n_reads=cfg.mock_drop_every_n_reads)
    return RtspSource(cfg)

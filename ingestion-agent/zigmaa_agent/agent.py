"""The agent: keeps the camera connected (with backoff), decides when to keep a still, spools it, and uploads
spooled stills in a separate thread so slow uploads never delay captures."""

from __future__ import annotations

import json
import logging
import random
import threading
import time
from datetime import datetime, timezone

from zigmaa_agent.capture import FrameError, MotionDetector, Spool, encode_jpeg
from zigmaa_agent.config import AgentConfig
from zigmaa_agent.sources import FrameSource, SourceError
from zigmaa_agent.uploader import FatalUploadError, TransientUploadError, Uploader

logger = logging.getLogger(__name__)


class Backoff:
    """Exponential backoff with jitter: min, 2*min, 4*min ... capped at max."""

    def __init__(self, min_s: float, max_s: float, rng: random.Random | None = None) -> None:
        self.min_s, self.max_s = min_s, max_s
        self.failures = 0
        self.rng = rng or random.Random()

    def next_delay(self) -> float:
        delay = min(self.max_s, self.min_s * (2 ** self.failures))
        self.failures += 1
        return delay * (0.8 + 0.4 * self.rng.random())

    def reset(self) -> None:
        self.failures = 0


class RedactingFilter(logging.Filter):
    """Last line of defence: scrub configured secrets from every log record."""

    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        self.secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for s in self.secrets:
            msg = msg.replace(s, "***")
        record.msg, record.args = msg, None
        return True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Agent:
    def __init__(self, cfg: AgentConfig, source: FrameSource, uploader: Uploader, spool: Spool, *,
                 clock=time.monotonic, sleep=None) -> None:
        self.cfg = cfg
        self.source = source
        self.uploader = uploader
        self.spool = spool
        self.clock = clock
        self.stop_event = threading.Event()
        self._sleep = sleep or self._wait
        self.connected = False
        self._ever_connected = False
        self.camera_backoff = Backoff(cfg.reconnect_min_s, cfg.reconnect_max_s)
        self.upload_backoff = Backoff(cfg.reconnect_min_s, cfg.reconnect_max_s)
        self.motion = MotionDetector(cfg.motion_threshold, cfg.motion_cooldown_s)
        self.fatal: str | None = None
        self._next_capture = 0.0
        self._lock = threading.Lock()
        self.stats = {"captures": 0, "frames_rejected": 0, "reconnects": 0, "uploaded": 0, "duplicates": 0,
                      "server_rejected": 0, "upload_failures": 0}
        self.status = {"camera_state": "starting", "upload_state": "idle", "last_capture_at": None,
                       "last_upload_at": None, "last_camera_error": None, "last_upload_error": None}

    def _wait(self, seconds: float) -> None:
        # Short slices: on Windows Ctrl+C is only delivered between waits, so a long backoff would delay shutdown.
        deadline = time.monotonic() + seconds
        while not self.stop_event.is_set():
            left = deadline - time.monotonic()
            if left <= 0:
                return
            self.stop_event.wait(min(left, 0.25))

    # ------------------------------------------------------------------ status

    def _set(self, **kw) -> None:
        with self._lock:
            self.status.update(kw)

    def _bump(self, key: str, n: int = 1) -> None:
        with self._lock:
            self.stats[key] += n

    def write_status(self) -> dict:
        with self._lock:
            snapshot = {"updated_at": _now(), "event_id": str(self.cfg.event_id), "camera": self.cfg.camera_name,
                        "source": self.cfg.camera_source, "mock": self.cfg.is_mock,
                        "mode": "folder" if self.cfg.is_folder else self.cfg.capture_mode,
                        **self.status, **self.stats, "spool": self.spool.counts(), "fatal_error": self.fatal}
            if self.cfg.is_folder:
                snapshot["watch_folder"] = str(self.cfg.watch_folder)
                snapshot["folder"] = vars(self.source.stats).copy()
        text = json.dumps(snapshot, indent=2)
        for s in self.cfg.secrets():
            text = text.replace(s, "***")
        tmp = self.spool.root / "status.json.part"
        tmp.write_text(text, encoding="utf-8")
        tmp.replace(self.spool.root / "status.json")
        return snapshot

    # ------------------------------------------------------------------ camera

    def ensure_connected(self) -> bool:
        """One connection attempt if disconnected. Returns True when connected; on failure waits the backoff."""
        if self.connected:
            return True
        try:
            self.source.open()
        except SourceError as exc:
            delay = self.camera_backoff.next_delay()
            self._set(camera_state="reconnecting", last_camera_error=str(exc))
            logger.warning("camera %s unavailable: %s; retrying in %.1fs", self.cfg.camera_name, exc, delay)
            self._sleep(delay)
            return False
        if self._ever_connected:
            self._bump("reconnects")
        self._ever_connected = True
        self.camera_backoff.reset()
        self.motion.reset()
        self.connected = True
        self._set(camera_state="connected", last_camera_error=None)
        if self.cfg.is_folder:
            logger.info("watching %s%s for new photos", self.cfg.watch_folder,
                        " (and subfolders)" if self.cfg.folder_recursive else "")
        else:
            logger.info("camera %s connected%s", self.cfg.camera_name, " (MOCK source)" if self.cfg.is_mock else "")
        return True

    def _disconnect(self, reason: str) -> None:
        self.connected = False
        self._set(camera_state="reconnecting", last_camera_error=reason)
        logger.warning("camera %s lost: %s", self.cfg.camera_name, reason)
        try:
            self.source.close()
        except Exception:  # noqa: BLE001
            pass

    def capture_once(self) -> bool:
        """Read the latest frame and, if the capture mode says so, keep it as a still. Returns True if saved."""
        now = self.clock()
        try:
            frame = self.source.read()
        except SourceError as exc:
            self._disconnect(str(exc))
            return False
        if self.cfg.capture_mode == "motion":
            try:
                triggered = self.motion.update(frame, now)
            except Exception as exc:  # noqa: BLE001 - malformed frame
                self._reject_frame(exc)
                return False
            if not triggered:
                return False
        elif now < self._next_capture:
            return False
        try:
            data = encode_jpeg(frame, self.cfg.jpeg_quality, self.cfg.max_upload_bytes)
        except FrameError as exc:
            self._reject_frame(exc)
            return False
        still = self.spool.save(data, self.cfg.camera_name, mock=self.cfg.is_mock)
        self._next_capture = now + self.cfg.capture_interval_s
        self._bump("captures")
        self._set(last_capture_at=_now())
        extra = f" motion={self.motion.last_score:.3f}" if self.cfg.capture_mode == "motion" else ""
        logger.info("captured %s (%d KB)%s", still.path.name, still.size // 1024, extra)
        return True

    def ingest_once(self) -> int:
        """Folder mode: scan the watch folder once and spool every complete new photo. Returns how many."""
        try:
            stills = self.source.poll()
        except SourceError as exc:
            self._disconnect(str(exc))
            return 0
        for still in stills:
            self._bump("captures")
            logger.info("new photo %s (%d KB)", still.path.name, still.size // 1024)
        if stills:
            self._set(last_capture_at=_now())
        return len(stills)

    def _reject_frame(self, exc: Exception) -> None:
        self._bump("frames_rejected")
        logger.warning("skipped malformed frame: %s", exc)

    # ------------------------------------------------------------------ upload

    def upload_step(self) -> bool:
        """Flush pending stills once. Returns False if the agent must stop (fatal error)."""
        try:
            res = self.uploader.flush_once()
        except FatalUploadError as exc:
            self.fatal = str(exc)
            self._set(upload_state="stopped", last_upload_error=str(exc))
            logger.error("upload stopped: %s", exc)
            self.stop_event.set()
            return False
        except TransientUploadError as exc:
            self._bump("upload_failures")
            delay = self.upload_backoff.next_delay()
            self._set(upload_state="retrying", last_upload_error=str(exc))
            logger.warning("upload failed: %s; %d still(s) kept for retry in %.1fs", exc,
                           self.spool.counts()["pending"], delay)
            self._sleep(delay)
            return True
        self.upload_backoff.reset()
        if res.confirmed or res.rejected:
            self._bump("uploaded", res.created)
            self._bump("duplicates", res.duplicates + res.skipped_existing)
            self._bump("server_rejected", res.rejected)
            self._set(last_upload_at=_now())
        self._set(upload_state="ok", last_upload_error=None)
        return True

    def _upload_loop(self) -> None:
        while not self.stop_event.is_set():
            if self.upload_step() and not self.spool.list_pending(1):
                self.stop_event.wait(self.cfg.upload_interval_s)

    # ------------------------------------------------------------------ main loop

    def run(self, *, max_captures: int | None = None, duration_s: float | None = None) -> int:
        """Run until stopped (Ctrl+C), ``max_captures`` stills were taken, or ``duration_s`` elapsed.
        Returns a process exit code."""
        start = self.clock()
        uploader = threading.Thread(target=self._upload_loop, name="uploader", daemon=True)
        uploader.start()
        if self.cfg.is_folder:
            tick = self.cfg.folder_poll_interval_s
        else:
            tick = self.cfg.motion_check_interval_s if self.cfg.capture_mode == "motion" else 0.2
        last_status = 0.0
        try:
            while not self.stop_event.is_set():
                if max_captures is not None and self.stats["captures"] >= max_captures:
                    break
                if duration_s is not None and self.clock() - start >= duration_s:
                    break
                if self.ensure_connected():
                    if self.cfg.is_folder:
                        self.ingest_once()
                    else:
                        self.capture_once()
                    self._sleep(tick)
                if self.clock() - last_status >= 5:
                    self.write_status()
                    last_status = self.clock()
        except KeyboardInterrupt:
            logger.info("stopping (Ctrl+C)")
        finally:
            self._finish(uploader)
        return 2 if self.fatal else 0

    def _finish(self, uploader: threading.Thread) -> None:
        # Give the uploader a bounded chance to drain what was captured, then stop everything.
        deadline = self.clock() + max(10.0, self.cfg.request_timeout_s)
        while not self.fatal and self.spool.list_pending(1) and self.clock() < deadline \
                and self.status["upload_state"] != "retrying":
            time.sleep(0.2)
        self.stop_event.set()
        uploader.join(timeout=self.cfg.request_timeout_s + 5)
        try:
            self.source.close()
        except Exception:  # noqa: BLE001
            pass
        self.uploader.close()
        snap = self.write_status()
        logger.info("stopped: captures=%d uploaded=%d duplicates=%d rejected=%d pending=%d%s",
                    snap["captures"], snap["uploaded"], snap["duplicates"], snap["server_rejected"],
                    snap["spool"]["pending"], f" FATAL: {self.fatal}" if self.fatal else "")

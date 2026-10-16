"""Folder source: picks up finished photos that camera software saves into WATCH_FOLDER and spools copies for upload.

Works with any camera that can get JPEG/PNG files onto this PC (Sony Imaging Edge / Creators' App transfer, Canon EOS
Utility / Image Transfer Utility, Nikon NX Tether / Wireless Transmitter Utility, card import, ...). The agent never
controls the camera.

Guarantees:
* Originals are only ever opened for reading; nothing in WATCH_FOLDER is moved, renamed, modified or deleted.
* A file is taken only once it is complete: same size and modification time for FILE_STABLE_SECONDS over at least two
  scans, readable (not locked by the writer), and ending with the JPEG/PNG end marker.
* Each file is spooled once: ``<spool>/folder_ledger.jsonl`` records every decision (path, size, mtime, SHA-256), so a
  restart does not re-ingest, and identical bytes under another name are skipped. Files the ledger lost track of
  (crash between spooling and writing the ledger) are caught by the server's per-event SHA-256 de-duplication.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import stat
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from zigmaa_agent.capture import Spool, Still
from zigmaa_agent.config import AgentConfig
from zigmaa_agent.sources import SourceError

logger = logging.getLogger(__name__)

# Temporary / partial files written by browsers, sync tools and transfer software, plus OS metadata files.
_TEMP_SUFFIXES = {".tmp", ".temp", ".part", ".partial", ".crdownload", ".download", ".filepart", ".!ut", ".lock"}
_SKIP_DIRS = {"$recycle.bin", "system volume information"}
_MAX_DECODE_FAILURES = 3
_TAIL = 64 * 1024  # end markers must be within the last 64 KB (cameras sometimes pad after the JPEG EOI)


def _key(path: Path) -> str:
    return os.path.normcase(os.path.abspath(path))


def is_candidate_name(name: str, include_png: bool) -> bool:
    lower = name.lower()
    if lower.startswith((".", "~", "$")) or lower == "thumbs.db":
        return False
    suffix = os.path.splitext(lower)[1]
    if suffix in _TEMP_SUFFIXES:
        return False
    return suffix in (".jpg", ".jpeg") or (include_png and suffix == ".png")


def check_complete(data: bytes) -> str:
    """Return ".jpg" or ".png" if ``data`` is a complete image file; raise ValueError otherwise."""
    tail = data[-_TAIL:]
    if data[:3] == b"\xff\xd8\xff":
        if b"\xff\xd9" not in tail:
            raise ValueError("JPEG end marker missing (file still being written or truncated)")
        suffix = ".jpg"
    elif data[:8] == b"\x89PNG\r\n\x1a\n":
        if b"IEND" not in tail:
            raise ValueError("PNG end chunk missing (file still being written or truncated)")
        suffix = ".png"
    else:
        raise ValueError("not a JPEG or PNG file")
    with Image.open(io.BytesIO(data)) as im:  # parses headers only; the backend fully decodes and validates
        if im.format not in ("JPEG", "MPO", "PNG"):
            raise ValueError(f"unexpected image format {im.format}")
        if im.width < 16 or im.height < 16:
            raise ValueError(f"image too small ({im.width}x{im.height})")
    return suffix


@dataclass
class _Candidate:
    size: int
    mtime_ns: int
    since: float
    observations: int = 1
    failures: int = 0
    last_reason: str = ""


@dataclass
class FolderStats:
    files_spooled: int = 0
    skipped_existing_at_start: int = 0
    skipped_duplicate: int = 0
    skipped_invalid: int = 0
    skipped_too_large: int = 0
    waiting: int = 0
    locked_or_unreadable: int = 0
    unreadable_dirs: list[str] = field(default_factory=list)


class FolderSource:
    """Polls WATCH_FOLDER. ``open()`` checks the folder is reachable; ``poll()`` returns the files spooled this scan."""

    is_mock = False

    def __init__(self, cfg: AgentConfig, spool: Spool, *, clock=time.monotonic) -> None:
        if cfg.watch_folder is None:
            raise SourceError("WATCH_FOLDER is not configured")
        self.name = cfg.camera_name
        self.root = cfg.watch_folder
        self.recursive = cfg.folder_recursive
        self.stable_s = cfg.file_stable_seconds
        self.include_png = cfg.folder_include_png
        self.include_existing = cfg.folder_include_existing
        self.max_bytes = cfg.max_upload_bytes
        self.spool = spool
        self.clock = clock
        self.ledger_path = spool.root / "folder_ledger.jsonl"
        self.stats = FolderStats()
        self._done: dict[str, tuple[int, int]] = {}  # path key -> (size, mtime_ns) already decided
        self._hashes: set[str] = set()
        self._baselines: set[str] = set()
        self._candidates: dict[str, _Candidate] = {}
        self._loaded = False
        self._opened = False

    # ------------------------------------------------------------------ ledger

    def _load_ledger(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        if not self.ledger_path.exists():
            return
        with open(self.ledger_path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue  # a torn last line after a crash; everything before it is intact
                if rec.get("status") == "baseline_done":
                    self._baselines.add(rec["folder"])
                    continue
                self._done[rec["key"]] = (rec["size"], rec["mtime_ns"])
                if rec.get("sha256") and rec.get("status") in ("spooled", "duplicate"):
                    self._hashes.add(rec["sha256"])

    def _record(self, **rec) -> None:
        rec["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(self.ledger_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        if "key" in rec:
            self._done[rec["key"]] = (rec["size"], rec["mtime_ns"])

    # ------------------------------------------------------------------ source interface

    def open(self) -> None:
        self._load_ledger()
        if not self.root.exists():
            raise SourceError(f"watch folder {self.root} does not exist (create it, or check the drive/card is "
                              "connected and WATCH_FOLDER is spelled correctly)")
        if not self.root.is_dir():
            raise SourceError(f"WATCH_FOLDER {self.root} is not a folder")
        try:
            with os.scandir(self.root) as it:
                next(it, None)
        except PermissionError:
            raise SourceError(f"no permission to read watch folder {self.root}") from None
        except OSError as exc:
            raise SourceError(f"cannot read watch folder {self.root} ({exc.strerror or type(exc).__name__})") from None
        folder = _key(self.root)
        if folder not in self._baselines:
            self._baseline(folder)
        self._opened = True

    def _baseline(self, folder: str) -> None:
        """First run for this event + folder: unless FOLDER_INCLUDE_EXISTING, photos already there (e.g. from an
        earlier event) are recorded as skipped so they never leak into this event."""
        if not self.include_existing:
            for path, st in self._scan():
                self._record(key=_key(path), path=str(path), size=st.st_size, mtime_ns=st.st_mtime_ns,
                             sha256=None, status="existing_at_start")
                self.stats.skipped_existing_at_start += 1
            if self.stats.skipped_existing_at_start:
                logger.warning("%d photo(s) already in %s were skipped (they existed before this event's first "
                               "run; set FOLDER_INCLUDE_EXISTING=true to upload them)",
                               self.stats.skipped_existing_at_start, self.root)
        self._record(status="baseline_done", folder=folder)
        self._baselines.add(folder)

    def close(self) -> None:
        self._opened = False

    def read(self):  # pragma: no cover - the agent never reads frames from a folder source
        raise SourceError("folder source has no frames; use poll()")

    # ------------------------------------------------------------------ scanning

    def _walk_errors(self, err: OSError) -> None:
        where = str(getattr(err, "filename", "") or "?")
        if where not in self.stats.unreadable_dirs:
            self.stats.unreadable_dirs.append(where)
            logger.warning("cannot read folder %s (%s); skipping it", where, err.strerror or type(err).__name__)

    def _scan(self):
        """Yield (path, stat) for supported, non-temporary files."""
        if self.recursive:
            for dirpath, dirnames, filenames in os.walk(self.root, onerror=self._walk_errors):
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d.lower() not in _SKIP_DIRS]
                for name in filenames:
                    yield from self._stat(Path(dirpath) / name)
        else:
            with os.scandir(self.root) as it:
                for entry in it:
                    yield from self._stat(Path(entry.path))

    def _stat(self, path: Path):
        if not is_candidate_name(path.name, self.include_png):
            return
        try:
            st = path.stat()
        except OSError:
            return  # deleted or renamed between listing and stat
        if stat.S_ISREG(st.st_mode):
            yield path, st

    def poll(self) -> list[Still]:
        if not self._opened:
            raise SourceError("watch folder is not open")
        if not self.root.is_dir():
            raise SourceError(f"watch folder {self.root} is no longer available")
        now = self.clock()
        spooled: list[Still] = []
        seen: set[str] = set()
        try:
            entries = sorted(self._scan(), key=lambda e: (e[1].st_mtime_ns, str(e[0])))
        except PermissionError:
            raise SourceError(f"no permission to read watch folder {self.root}") from None
        except OSError as exc:
            raise SourceError(f"cannot read watch folder {self.root} ({exc.strerror or type(exc).__name__})") from None
        for path, st in entries:
            key = _key(path)
            seen.add(key)
            if self._done.get(key) == (st.st_size, st.st_mtime_ns):
                continue
            cand = self._candidates.get(key)
            if cand is None or (cand.size, cand.mtime_ns) != (st.st_size, st.st_mtime_ns):
                self._candidates[key] = _Candidate(st.st_size, st.st_mtime_ns, now)
                continue  # new or still changing
            cand.observations += 1
            if st.st_size == 0 or now - cand.since < self.stable_s:
                continue
            still = self._take(path, key, cand)
            if still is not None:
                spooled.append(still)
        for key in [k for k in self._candidates if k not in seen]:  # vanished (renamed/deleted by the writer)
            del self._candidates[key]
        self.stats.waiting = len(self._candidates)
        return spooled

    def _take(self, path: Path, key: str, cand: _Candidate) -> Still | None:
        size, mtime_ns = cand.size, cand.mtime_ns
        if size > self.max_bytes:
            self._decide(key, path, size, mtime_ns, None, "too_large")
            self.stats.skipped_too_large += 1
            logger.warning("skipped %s: %d MB is over the %d MB upload limit", path.name, size >> 20,
                           self.max_bytes >> 20)
            return None
        try:
            with open(path, "rb") as fh:  # read-only; the original is never modified
                data = fh.read(self.max_bytes + 1)
            st = path.stat()
        except OSError as exc:
            # Locked by the camera software (Windows sharing violation) or removed: try again next scan.
            self.stats.locked_or_unreadable += 1
            if cand.last_reason != "locked":
                logger.info("waiting for %s (%s)", path.name, exc.strerror or type(exc).__name__)
                cand.last_reason = "locked"
            return None
        if len(data) != size or (st.st_size, st.st_mtime_ns) != (size, mtime_ns):
            self._candidates[key] = _Candidate(st.st_size, st.st_mtime_ns, self.clock())  # changed while reading
            return None
        try:
            suffix = check_complete(data)
        except Exception as exc:  # noqa: BLE001 - any parse failure means "not a usable image (yet)"
            cand.failures += 1
            cand.since = self.clock()  # wait another stable period before re-checking
            if cand.failures >= _MAX_DECODE_FAILURES:
                self._decide(key, path, size, mtime_ns, None, "invalid")
                self.stats.skipped_invalid += 1
                logger.warning("skipped %s: %s", path.name, exc)
            return None
        digest = hashlib.sha256(data).hexdigest()
        if digest in self._hashes:
            self._decide(key, path, size, mtime_ns, digest, "duplicate")
            self.stats.skipped_duplicate += 1
            logger.info("skipped %s: identical to a photo already taken from this folder", path.name)
            return None
        # Spool first, then record: a crash in between can at worst produce a copy the server de-duplicates,
        # never a lost photo.
        still = self.spool.save(data, self.name, mock=False, suffix=suffix, label=path.stem)
        self._hashes.add(digest)
        self._decide(key, path, size, mtime_ns, digest, "spooled")
        self.stats.files_spooled += 1
        return still

    def _decide(self, key: str, path: Path, size: int, mtime_ns: int, digest: str | None, status: str) -> None:
        self._candidates.pop(key, None)
        self._record(key=key, path=str(path), size=size, mtime_ns=mtime_ns, sha256=digest, status=status)

    def summary(self) -> dict:
        """Read-only description for ``check``: what is in the folder and what a run would do."""
        self._load_ledger()
        total = known = 0
        for path, st in self._scan():
            total += 1
            known += self._done.get(_key(path)) == (st.st_size, st.st_mtime_ns)
        first_run = _key(self.root) not in self._baselines
        return {"supported_files": total, "already_handled": known,
                "first_run": first_run, "existing_will_be": ("uploaded" if self.include_existing else "skipped")
                if first_run else None}

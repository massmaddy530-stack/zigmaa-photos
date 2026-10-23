"""Copy stored objects from one storage backend to another (e.g. local disk -> Supabase/R2) without touching the
database or deleting anything.

Object keys are identical in every backend, so after a complete copy the only change needed is STORAGE_BACKEND:
existing rows keep working, and switching back to the old backend is a full rollback because the source is never
modified. Copies are resumable and idempotent: an object already present at the destination with the same size is
skipped, and originals are checked against the photo's SHA-256 before they are copied.
"""

from __future__ import annotations

import hashlib
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Photo
from app.services.storage import LocalStorage, Storage, StorageError

WEBP = "image/webp"


@dataclass(frozen=True)
class CopyItem:
    key: str
    content_type: str
    kind: str  # original | thumbnail | preview | cover
    photo_id: uuid.UUID | None = None
    sha256: str | None = None  # originals only


@dataclass
class CopyReport:
    outcomes: Counter = field(default_factory=Counter)
    missing_originals: list[uuid.UUID] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)  # "<kind> <key>: <reason>" (no URLs or credentials)

    @property
    def ok(self) -> bool:
        return not self.errors


async def collect_items(session: AsyncSession, event_id: uuid.UUID | None = None) -> list[CopyItem]:
    """Every object the database references (read-only queries)."""
    stmt = select(Photo).order_by(Photo.created_at, Photo.id)
    ev_stmt = select(Event.cover_key).where(Event.cover_key.is_not(None))
    if event_id:
        stmt = stmt.where(Photo.event_id == event_id)
        ev_stmt = ev_stmt.where(Event.id == event_id)
    items: list[CopyItem] = []
    for p in (await session.execute(stmt)).scalars():
        items.append(CopyItem(p.original_key, p.content_type, "original", p.id, p.content_hash))
        if p.thumbnail_key:
            items.append(CopyItem(p.thumbnail_key, WEBP, "thumbnail", p.id))
        if p.preview_key:
            items.append(CopyItem(p.preview_key, WEBP, "preview", p.id))
    items += [CopyItem(k, WEBP, "cover") for k in (await session.execute(ev_stmt)).scalars()]
    return items


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_objects(items: list[CopyItem], source: Storage, dest: Storage, *, apply: bool,
                 progress=None) -> CopyReport:
    """Copy each item from ``source`` to ``dest``. With ``apply=False`` nothing is written (dry run).
    Never deletes or overwrites a matching object; never modifies ``source``."""
    report = CopyReport()
    with TemporaryDirectory(prefix="zigmaa-migrate-") as tmp:
        for item in items:
            outcome = _copy_one(item, source, dest, apply, Path(tmp), report)
            report.outcomes[outcome] += 1
            if progress:
                progress(item, outcome)
    return report


def _copy_one(item: CopyItem, source: Storage, dest: Storage, apply: bool, tmp: Path, report: CopyReport) -> str:
    try:
        src_size = source.size(item.key)
        if src_size is None:
            if dest.exists(item.key):
                return "already_copied"  # e.g. copied earlier, then the ephemeral source disk was wiped
            if item.kind == "original" and item.photo_id:
                report.missing_originals.append(item.photo_id)
            return "missing_in_source"
        if dest.size(item.key) == src_size:
            return "already_copied"

        local = source.path_for(item.key) if isinstance(source, LocalStorage) else tmp / "object"
        if not isinstance(source, LocalStorage):
            source.download_to(item.key, local)
        try:
            if item.sha256 and _sha256(local) != item.sha256:
                report.errors.append(f"{item.kind} {item.key}: content does not match the recorded SHA-256")
                return "hash_mismatch"
            if not apply:
                return "would_copy"
            with open(local, "rb") as fh:
                dest.put_file(item.key, fh, item.content_type)
        finally:
            if local.parent == tmp:
                local.unlink(missing_ok=True)
        if dest.size(item.key) != src_size:
            report.errors.append(f"{item.kind} {item.key}: size differs after upload")
            return "verify_failed"
        return "copied"
    except (StorageError, OSError, ValueError) as exc:
        report.errors.append(f"{item.kind} {item.key}: {exc if isinstance(exc, StorageError) else type(exc).__name__}")
        return "error"

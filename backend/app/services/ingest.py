"""Photo upload ingestion: validate, de-duplicate, store original, create DB row, enqueue indexing."""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import BinaryIO

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings
from app.models import Event, Photo, PhotoStatus
from app.schemas import UploadItemResult
from app.services.images import FileTooLargeError, InvalidImageError, inspect_image, sanitize_filename
from app.services.storage import Storage, StorageError

logger = logging.getLogger(__name__)


def hash_stream(fileobj: BinaryIO, limit: int, chunk_size: int = 1024 * 1024) -> tuple[int, str]:
    """SHA-256 + size of a seekable stream in bounded chunks; rewinds afterwards."""
    fileobj.seek(0)
    sha = hashlib.sha256()
    total = 0
    while chunk := fileobj.read(chunk_size):
        total += len(chunk)
        if total > limit:
            raise FileTooLargeError(limit)
        sha.update(chunk)
    fileobj.seek(0)
    if total == 0:
        raise InvalidImageError("File is empty", code="empty_file")
    return total, sha.hexdigest()


def original_key(event_id: uuid.UUID, photo_id: uuid.UUID, ext: str) -> str:
    return f"events/{event_id}/originals/{photo_id}.{ext}"


def derivative_key(event_id: uuid.UUID, photo_id: uuid.UUID, kind: str) -> str:
    return f"events/{event_id}/{kind}/{photo_id}.webp"


def _validate(fileobj: BinaryIO, settings: Settings):
    size, digest = hash_stream(fileobj, settings.max_upload_bytes)
    info = inspect_image(fileobj, settings)
    fileobj.seek(0)
    return size, digest, info


async def ingest_upload(session: AsyncSession, event: Event, upload: UploadFile, storage: Storage,
                        settings: Settings, source: str = "dashboard") -> tuple[UploadItemResult, Photo | None]:
    filename = sanitize_filename(upload.filename)
    try:
        size, digest, info = await run_in_threadpool(_validate, upload.file, settings)
    except InvalidImageError as exc:
        return UploadItemResult(filename=filename, status="rejected", error_code=exc.code, error=str(exc)), None

    existing = (await session.execute(
        select(Photo.id).where(Photo.event_id == event.id, Photo.content_hash == digest)
    )).scalar_one_or_none()
    if existing:
        return UploadItemResult(filename=filename, status="duplicate", photo_id=existing), None

    photo_id = uuid.uuid4()
    key = original_key(event.id, photo_id, info.extension)
    try:
        await run_in_threadpool(storage.put_file, key, upload.file, info.content_type)
    except StorageError as exc:
        logger.error("Storage upload failed for event %s: %s", event.id, exc)
        return UploadItemResult(filename=filename, status="rejected", error_code="storage_error",
                                error="Could not store the file. Please retry."), None

    photo = Photo(
        id=photo_id, event_id=event.id, original_filename=filename, content_hash=digest,
        content_type=info.content_type, size_bytes=size, width=info.width, height=info.height,
        original_key=key, status=PhotoStatus.pending, source=source,
    )
    session.add(photo)
    try:
        await session.commit()
    except IntegrityError:
        # A concurrent upload of identical bytes won the race; discard our copy.
        await session.rollback()
        await run_in_threadpool(_safe_delete, storage, key)
        winner = (await session.execute(
            select(Photo.id).where(Photo.event_id == event.id, Photo.content_hash == digest)
        )).scalar_one_or_none()
        return UploadItemResult(filename=filename, status="duplicate", photo_id=winner), None
    return UploadItemResult(filename=filename, status="created", photo_id=photo_id), photo


def _safe_delete(storage: Storage, key: str) -> None:
    try:
        storage.delete(key)
    except StorageError:
        logger.warning("Failed to delete orphaned object %s", key)

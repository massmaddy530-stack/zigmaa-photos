"""Photo processing pipeline: derivatives + face detection/embedding + idempotent persistence."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sqlalchemy import delete, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.models import EventPhoto, FaceEmbedding, JobStatus, Photo, PhotoStatus, ProcessingJob, utcnow
from app.services.face.engine import FaceModelUnavailableError, analyzer_available, get_analyzer
from app.services.images import InvalidImageError, build_derivatives
from app.services.ingest import derivative_key
from app.services.storage import Storage, StorageError, get_storage

logger = logging.getLogger(__name__)


class TransientProcessingError(Exception):
    """Failure that may succeed on retry (storage/network/database hiccups)."""


@dataclass
class FaceRecord:
    bbox: tuple[float, float, float, float]  # normalised
    det_score: float
    embedding: np.ndarray


@dataclass
class ProcessedPhoto:
    width: int
    height: int
    faces: list[FaceRecord]


def process_file(photo: Photo, storage: Storage, settings: Settings) -> ProcessedPhoto:
    """Blocking part: download original, write derivatives, run face analysis. Temp files are always removed."""
    fd, tmp_name = tempfile.mkstemp(prefix="evp_", suffix=".img")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        storage.download_to(photo.original_key, tmp)
        deriv = build_derivatives(tmp, settings)
        storage.put_bytes(derivative_key(photo.event_id, photo.id, "thumbnails"), deriv.thumbnail, "image/webp")
        storage.put_bytes(derivative_key(photo.event_id, photo.id, "previews"), deriv.preview, "image/webp")
        analysis = deriv.analysis
        faces = get_analyzer().analyze(analysis) if settings.face_analysis_enabled else []
        w, h = analysis.size
        records = [
            FaceRecord(
                bbox=(
                    float(np.clip(f.bbox[0] / w, 0, 1)), float(np.clip(f.bbox[1] / h, 0, 1)),
                    float(np.clip(f.bbox[2] / w, 0, 1)), float(np.clip(f.bbox[3] / h, 0, 1)),
                ),
                det_score=float(f.det_score),
                embedding=f.embedding,
            )
            for f in faces
        ]
        analysis.close()
        return ProcessedPhoto(width=deriv.width, height=deriv.height, faces=records)
    finally:
        tmp.unlink(missing_ok=True)


async def index_photo(
    photo_id: uuid.UUID,
    *,
    attempt: int = 1,
    max_attempts: int | None = None,
    task_id: str | None = None,
    sessionmaker: async_sessionmaker[AsyncSession] | None = None,
    storage: Storage | None = None,
) -> str:
    """Process one photo. Returns the final photo status value.

    Raises ``TransientProcessingError`` when the failure is retryable and attempts remain.
    """
    from app.db.session import get_sessionmaker

    settings = get_settings()
    sm = sessionmaker or get_sessionmaker()
    storage = storage or get_storage()
    max_attempts = max_attempts or (settings.task_max_retries + 1)

    async with sm() as session:
        photo = await session.get(Photo, photo_id)
        if photo is None:
            logger.warning("index_photo: photo %s no longer exists", photo_id)
            return "missing"
        if photo.status == PhotoStatus.indexed:
            return photo.status.value  # idempotent: already done
        photo.status = PhotoStatus.processing
        photo.attempts += 1
        photo.error_message = None
        job = ProcessingJob(event_id=photo.event_id, photo_id=photo.id, task_id=task_id, attempt=attempt,
                            status=JobStatus.running, started_at=utcnow())
        session.add(job)
        await session.commit()
        job_id = job.id
        started = time.perf_counter()

        error: str | None = None
        transient = False
        result: ProcessedPhoto | None = None
        try:
            result = await asyncio.to_thread(process_file, photo, storage, settings)
        except InvalidImageError as exc:
            error = f"Invalid image: {exc}"
        except FaceModelUnavailableError as exc:
            error = f"Face model unavailable: {exc}"
            transient = not analyzer_available()
        except StorageError as exc:
            error, transient = f"Storage error: {exc}", True
        except MemoryError:
            error, transient = "Out of memory while processing image", True
        except Exception as exc:  # unexpected: record, do not retry blindly
            logger.exception("Unexpected failure processing photo %s", photo_id)
            error = f"Processing failed: {type(exc).__name__}"

        duration = int((time.perf_counter() - started) * 1000)
        try:
            job = await session.get(ProcessingJob, job_id)
            if result is not None:
                # Idempotent replace of face rows inside a single transaction.
                await session.execute(delete(FaceEmbedding).where(FaceEmbedding.photo_id == photo.id))
                model_name = getattr(settings, "face_model_name", "buffalo_sc")
                session.add_all([
                    FaceEmbedding(
                        event_id=photo.event_id, photo_id=photo.id, face_index=i,
                        bbox_x1=f.bbox[0], bbox_y1=f.bbox[1], bbox_x2=f.bbox[2], bbox_y2=f.bbox[3],
                        det_score=f.det_score, embedding=f.embedding, model_name=model_name,
                    )
                    for i, f in enumerate(result.faces)
                ])
                photo.width, photo.height = result.width, result.height
                photo.thumbnail_key = derivative_key(photo.event_id, photo.id, "thumbnails")
                photo.preview_key = derivative_key(photo.event_id, photo.id, "previews")

                # Generate public CDN URLs or signed URLs for event_photos
                thumb_url = storage.signed_url(photo.thumbnail_key) if photo.thumbnail_key else None
                prev_url = storage.signed_url(photo.preview_key) if photo.preview_key else None
                orig_url = storage.signed_url(photo.original_key) if photo.original_key else None
                if getattr(storage, "public_url", None):
                    base = storage.public_url.rstrip("/")
                    thumb_url = f"{base}/{photo.thumbnail_key}"
                    prev_url = f"{base}/{photo.preview_key}"
                    orig_url = f"{base}/{photo.original_key}"

                photo.r2_thumbnail_url = thumb_url
                photo.r2_preview_url = prev_url
                photo.r2_original_url = orig_url

                ev_photo = await session.get(EventPhoto, photo.id)
                if ev_photo is None:
                    session.add(EventPhoto(
                        id=photo.id,
                        event_id=photo.event_id,
                        r2_preview_url=prev_url,
                        r2_thumbnail_url=thumb_url,
                        r2_original_url=orig_url,
                    ))
                else:
                    ev_photo.r2_preview_url = prev_url
                    ev_photo.r2_thumbnail_url = thumb_url
                    ev_photo.r2_original_url = orig_url

                photo.face_count = len(result.faces)
                photo.status = PhotoStatus.indexed
                photo.processed_at = utcnow()
                job.status = JobStatus.succeeded
            else:
                will_retry = transient and attempt < max_attempts
                photo.status = PhotoStatus.pending if will_retry else PhotoStatus.failed
                photo.error_message = (f"{error} (retrying, attempt {attempt}/{max_attempts})"
                                       if will_retry else error)
                job.status = JobStatus.failed
                job.error_message = error
            job.finished_at = utcnow()
            job.duration_ms = duration
            await session.commit()
        except (OperationalError, DBAPIError) as exc:
            await session.rollback()
            logger.error("Database error saving results for photo %s: %s", photo_id, type(exc).__name__)
            if attempt < max_attempts:
                raise TransientProcessingError("database error") from exc
            raise

    logger.info("Processed photo", extra={"photo_id": str(photo_id), "status": photo.status.value,
                                           "faces": photo.face_count, "duration_ms": duration})
    if result is None and transient and attempt < max_attempts:
        raise TransientProcessingError(error or "transient error")
    return photo.status.value


async def reset_for_retry(session: AsyncSession, photo_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    rows = (await session.execute(select(Photo).where(Photo.id.in_(photo_ids)))).scalars().all()
    reset = []
    for p in rows:
        if p.status in (PhotoStatus.failed, PhotoStatus.pending, PhotoStatus.processing):
            p.status = PhotoStatus.pending
            p.error_message = None
            reset.append(p.id)
    await session.commit()
    return reset


async def mark_photo_failed_safe(
    photo_id: uuid.UUID,
    error_message: str,
    *,
    sessionmaker: async_sessionmaker[AsyncSession] | None = None,
) -> None:
    """Best-effort: mark a photo as failed and close any stuck running ProcessingJob rows.

    Uses *sessionmaker* when provided (tests); otherwise builds a fresh null-pool
    engine from DATABASE_URL (production). Swallows all exceptions — callers
    should log the original failure before calling this.
    """
    from app.db.session import build_engine

    engine = None
    sm = sessionmaker
    if sm is None:
        engine = build_engine(null_pool=True)
        sm = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sm() as session:
            photo = await session.get(Photo, photo_id)
            if photo is None or photo.status != PhotoStatus.processing:
                return
            photo.status = PhotoStatus.failed
            photo.error_message = error_message
            running_jobs = (
                await session.execute(
                    select(ProcessingJob).where(
                        ProcessingJob.photo_id == photo_id,
                        ProcessingJob.status == JobStatus.running,
                    )
                )
            ).scalars().all()
            now = utcnow()
            for job in running_jobs:
                job.status = JobStatus.failed
                job.error_message = error_message
                job.finished_at = now
            await session.commit()
    except Exception:  # noqa: BLE001
        logger.warning("mark_photo_failed_safe failed for photo %s", photo_id, exc_info=True)
    finally:
        if engine is not None:
            await engine.dispose()

"""Celery tasks."""

from __future__ import annotations

import asyncio
import logging
import uuid

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.config import get_settings
from app.db.session import build_engine
from app.services.indexing import TransientProcessingError, index_photo, mark_photo_failed_safe
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)


async def run_index_isolated(photo_id: uuid.UUID, attempt: int, max_attempts: int, task_id: str | None) -> str:
    """Run indexing on a private engine so it works inside any fresh event loop (worker / thread)."""
    engine = build_engine(null_pool=True)
    try:
        sm = async_sessionmaker(engine, expire_on_commit=False)
        return await index_photo(photo_id, attempt=attempt, max_attempts=max_attempts, task_id=task_id,
                                 sessionmaker=sm)
    finally:
        await engine.dispose()


@celery_app.task(bind=True, name="photos.index", max_retries=None)
def index_photo_task(self, photo_id: str) -> str:
    settings = get_settings()
    max_attempts = settings.task_max_retries + 1
    attempt = self.request.retries + 1
    try:
        return asyncio.run(run_index_isolated(uuid.UUID(photo_id), attempt, max_attempts, self.request.id))
    except TransientProcessingError as exc:
        countdown = settings.task_retry_backoff_s * (2 ** (attempt - 1))
        logger.warning("Transient failure for photo %s (attempt %d/%d); retrying in %.0fs",
                       photo_id, attempt, max_attempts, countdown)
        raise self.retry(exc=exc, countdown=countdown)
    except SoftTimeLimitExceeded:
        logger.error("Photo %s exceeded the soft time limit", photo_id)
        try:
            asyncio.run(mark_photo_failed_safe(
                uuid.UUID(photo_id),
                f"Task exceeded the soft time limit on attempt {attempt}",
            ))
        except Exception:  # noqa: BLE001
            logger.warning("mark_photo_failed_safe failed for photo %s after soft time limit", photo_id, exc_info=True)
        raise
    except Exception:
        logger.exception("Photo %s task failed with unexpected error (attempt %d)", photo_id, attempt)
        try:
            asyncio.run(mark_photo_failed_safe(
                uuid.UUID(photo_id),
                f"Task crashed unexpectedly on attempt {attempt}; retry to reprocess",
            ))
        except Exception:  # noqa: BLE001
            logger.error("Failed recovery update for photo %s after task crash", photo_id)
        raise

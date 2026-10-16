"""Enqueue background work according to TASK_MODE (celery | thread | sync)."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from app.core.config import get_settings
from app.services.indexing import TransientProcessingError, index_photo

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None


class QueueUnavailableError(Exception):
    pass


def _thread_job(photo_id: uuid.UUID) -> None:
    from app.worker.tasks import run_index_isolated

    settings = get_settings()
    max_attempts = settings.task_max_retries + 1
    for attempt in range(1, max_attempts + 1):
        try:
            asyncio.run(run_index_isolated(photo_id, attempt, max_attempts, None))
            return
        except TransientProcessingError:
            time.sleep(settings.task_retry_backoff_s * (2 ** (attempt - 1)))
        except Exception:
            logger.exception("Background indexing crashed for photo %s", photo_id)
            return


async def enqueue_index(photo_ids: list[uuid.UUID]) -> None:
    global _executor
    settings = get_settings()
    if not photo_ids:
        return
    if settings.task_mode == "celery":
        from app.worker.tasks import index_photo_task

        def _send() -> None:
            for pid in photo_ids:
                index_photo_task.apply_async(args=[str(pid)], retry=True,
                                             retry_policy={"max_retries": 2, "interval_start": 0.5})

        try:
            await asyncio.wait_for(asyncio.to_thread(_send), timeout=10)
        except Exception as exc:
            logger.error("Could not enqueue indexing tasks: %s", type(exc).__name__)
            raise QueueUnavailableError("Task queue unavailable") from exc
    elif settings.task_mode == "thread":
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=settings.thread_workers, thread_name_prefix="indexer")
        for pid in photo_ids:
            _executor.submit(_thread_job, pid)
    else:  # sync (tests)
        max_attempts = settings.task_max_retries + 1
        for pid in photo_ids:
            for attempt in range(1, max_attempts + 1):
                try:
                    await index_photo(pid, attempt=attempt, max_attempts=max_attempts)
                    break
                except TransientProcessingError:
                    await asyncio.sleep(settings.task_retry_backoff_s * (2 ** (attempt - 1)))

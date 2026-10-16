"""Celery application. Start a worker (Windows needs the solo pool):

    celery -A app.worker.celery_app worker --loglevel=INFO --pool=solo
"""

from __future__ import annotations

from celery import Celery
from celery.signals import setup_logging

from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()

celery_app = Celery("eventphoto", broker=settings.redis_url, backend=None, include=["app.worker.tasks"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    task_acks_late=True,  # re-deliver if a worker dies mid-task (tasks are idempotent)
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # CPU-heavy tasks: don't hoard messages
    worker_max_tasks_per_child=200,  # bound memory growth from image decoding
    task_soft_time_limit=settings.task_soft_time_limit_s,
    task_time_limit=settings.task_time_limit_s,
    broker_connection_retry_on_startup=True,
    broker_transport_options={"visibility_timeout": settings.task_time_limit_s * 4},
    task_default_queue="photos",
    timezone="UTC",
)


@setup_logging.connect
def _configure_logging(**_kwargs) -> None:
    configure_logging(settings.log_level, settings.log_json)

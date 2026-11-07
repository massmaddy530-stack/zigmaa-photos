"""Tests for indexing crash recovery and queue-failure handling."""
from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models import Event, JobStatus, Photo, PhotoStatus, ProcessingJob
from app.services.dispatch import QueueUnavailableError
from app.services.indexing import mark_photo_failed_safe, reset_for_retry
from tests.conftest import ADMIN, create_event, make_image


# ---------------------------------------------------------------------------
# mark_photo_failed_safe — direct unit tests using the SQLite fixture engine
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_photo_failed_safe_transitions_photo_and_job(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)

    async with sm() as session:
        ev = Event(name="Recovery Test", slug="rec-test-mf1")
        session.add(ev)
        await session.flush()
        photo = Photo(
            event_id=ev.id,
            original_filename="crash.jpg",
            content_hash="a" * 64,
            content_type="image/jpeg",
            size_bytes=1,
            original_key="k/crash",
            status=PhotoStatus.processing,
        )
        session.add(photo)
        await session.flush()
        job = ProcessingJob(
            event_id=ev.id,
            photo_id=photo.id,
            status=JobStatus.running,
            attempt=1,
        )
        session.add(job)
        await session.commit()
        photo_id, job_id = photo.id, job.id

    await mark_photo_failed_safe(photo_id, "crash", sessionmaker=sm)

    async with sm() as session:
        p = await session.get(Photo, photo_id)
        assert p.status == PhotoStatus.failed
        assert p.error_message == "crash"
        j = await session.get(ProcessingJob, job_id)
        assert j.status == JobStatus.failed
        assert j.finished_at is not None
        assert j.error_message == "crash"


@pytest.mark.asyncio
async def test_mark_photo_failed_safe_skips_indexed(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)

    async with sm() as session:
        ev = Event(name="Skip Test", slug="rec-test-mf2")
        session.add(ev)
        await session.flush()
        photo = Photo(
            event_id=ev.id,
            original_filename="done.jpg",
            content_hash="b" * 64,
            content_type="image/jpeg",
            size_bytes=1,
            original_key="k/done",
            status=PhotoStatus.indexed,
        )
        session.add(photo)
        await session.commit()
        photo_id = photo.id

    await mark_photo_failed_safe(photo_id, "should be ignored", sessionmaker=sm)

    async with sm() as session:
        p = await session.get(Photo, photo_id)
        assert p.status == PhotoStatus.indexed  # unchanged


# ---------------------------------------------------------------------------
# reset_for_retry — verify it accepts processing status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reset_for_retry_accepts_processing_status(engine):
    sm = async_sessionmaker(engine, expire_on_commit=False)

    async with sm() as session:
        ev = Event(name="Retry Test", slug="rec-test-rr1")
        session.add(ev)
        await session.flush()
        photo = Photo(
            event_id=ev.id,
            original_filename="stuck.jpg",
            content_hash="c" * 64,
            content_type="image/jpeg",
            size_bytes=1,
            original_key="k/stuck",
            status=PhotoStatus.processing,
        )
        session.add(photo)
        await session.commit()
        photo_id = photo.id

    async with sm() as session:
        ids = await reset_for_retry(session, [photo_id])

    assert photo_id in ids

    async with sm() as session:
        p = await session.get(Photo, photo_id)
        assert p.status == PhotoStatus.pending
        assert p.error_message is None


# ---------------------------------------------------------------------------
# Queue failure — photos are marked failed; default retry-failed finds them
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_queue_failure_marks_photos_failed_and_retry_finds_them(client):
    event = await create_event(client, name="Queue Fail Test")
    img = make_image(seed=77)

    call_count = 0

    async def _mock_enqueue(ids):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise QueueUnavailableError("test queue down")
        # Second call (from retry-failed) succeeds silently.

    with patch("app.api.photos.enqueue_index", side_effect=_mock_enqueue):
        # Upload — queue failure swallowed; photo created but not queued.
        r = await client.post(
            f"/api/v1/events/{event['id']}/photos",
            files=[("files", ("p.png", img, "image/png"))],
            headers=ADMIN,
        )
        assert r.status_code == 201
        assert r.json()["created"] == 1

        # Default retry-failed (no include_pending) must find and re-queue it.
        r2 = await client.post(
            f"/api/v1/events/{event['id']}/photos/retry-failed",
            headers=ADMIN,
        )

    assert r2.status_code == 202
    assert r2.json()["queued"] == 1
    assert call_count == 2  # first raised, second succeeded

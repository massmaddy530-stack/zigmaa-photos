"""Event queries and serialisation helpers."""

from __future__ import annotations

import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.models import Event, EventStatus, FaceEmbedding, Photo, PhotoStatus
from app.schemas import EventOut, PhotoCounts, PhotoOut
from app.services.storage import Storage

_SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # no ambiguous characters


def new_slug(length: int = 12) -> str:
    return "".join(secrets.choice(_SLUG_ALPHABET) for _ in range(length))


def public_url(slug: str) -> str:
    return f"{get_settings().frontend_base_url.rstrip('/')}/e/{slug}"


async def get_event_or_404(session: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await session.get(Event, event_id)
    if event is None:
        raise NotFoundError("Event not found")
    return event


async def get_public_event_or_404(session: AsyncSession, slug: str) -> Event:
    if not slug or len(slug) > 32:
        raise NotFoundError("Event not found")
    event = (await session.execute(select(Event).where(Event.slug == slug))).scalar_one_or_none()
    if event is None or event.status != EventStatus.active:
        raise NotFoundError("Event not found")
    return event


async def photo_counts(session: AsyncSession, event_ids: list[uuid.UUID]) -> dict[uuid.UUID, PhotoCounts]:
    counts = {eid: PhotoCounts() for eid in event_ids}
    if not event_ids:
        return counts
    rows = await session.execute(
        select(Photo.event_id, Photo.status, func.count())
        .where(Photo.event_id.in_(event_ids))
        .group_by(Photo.event_id, Photo.status)
    )
    for event_id, status, n in rows:
        c = counts[event_id]
        setattr(c, PhotoStatus(status).value, n)
        c.total += n
    faces = await session.execute(
        select(FaceEmbedding.event_id, func.count()).where(FaceEmbedding.event_id.in_(event_ids))
        .group_by(FaceEmbedding.event_id)
    )
    for event_id, n in faces:
        counts[event_id].faces = n
    return counts


def event_out(event: Event, storage: Storage, counts: PhotoCounts | None = None) -> EventOut:
    return EventOut(
        id=event.id,
        slug=event.slug,
        name=event.name,
        event_date=event.event_date,
        venue=event.venue,
        description=event.description,
        status=event.status,
        created_at=event.created_at,
        updated_at=event.updated_at,
        public_url=public_url(event.slug),
        cover_url=storage.signed_url(event.cover_key) if event.cover_key else None,
        counts=counts or PhotoCounts(),
    )


def photo_out(photo: Photo, storage: Storage, *, with_preview: bool = True) -> PhotoOut:
    return PhotoOut.model_validate(photo, from_attributes=True).model_copy(
        update={
            "thumbnail_url": storage.signed_url(photo.thumbnail_key) if photo.thumbnail_key else None,
            "preview_url": storage.signed_url(photo.preview_key) if (with_preview and photo.preview_key) else None,
        }
    )

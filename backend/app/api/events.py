"""Admin event management endpoints."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from sqlalchemy import delete, func, or_, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import SessionDep, SettingsDep, StorageDep
from app.core.errors import UnprocessableError
from app.core.security import require_admin
from app.models import Event, EventStatus, FaceEmbedding, Photo, PhotoStatus, PhotoWatermarkDerivative
from app.schemas import (
    ErrorResponse,
    EventCreate,
    EventOut,
    EventStatusOut,
    EventUpdate,
    OverviewOut,
    Page,
    StorageOverviewOut,
)
from app.services.events import event_out, get_event_or_404, new_slug, photo_counts, photo_out
from app.services.images import InvalidImageError, fit_within, load_rgb, to_webp
from app.services.ingest import hash_stream
from app.services.storage import StorageError

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1",
    tags=["events"],
    dependencies=[Depends(require_admin)],
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)


@router.post("/events", response_model=EventOut, status_code=status.HTTP_201_CREATED,
             responses={422: {"model": ErrorResponse}})
async def create_event(body: EventCreate, session: SessionDep, storage: StorageDep) -> EventOut:
    event = Event(slug=new_slug(), **body.model_dump())
    session.add(event)
    await session.commit()
    await session.refresh(event)
    logger.info("Event created", extra={"event_id": str(event.id)})
    return event_out(event, storage)


@router.get("/events", response_model=Page[EventOut])
async def list_events(
    session: SessionDep, storage: StorageDep,
    q: Annotated[str | None, Query(max_length=100, description="Search by name or venue")] = None,
    status_filter: Annotated[EventStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[EventOut]:
    stmt = select(Event)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Event.name).like(like), func.lower(Event.venue).like(like)))
    if status_filter:
        stmt = stmt.where(Event.status == status_filter)
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    events = (await session.execute(
        stmt.order_by(Event.created_at.desc(), Event.id).limit(limit).offset(offset)
    )).scalars().all()
    counts = await photo_counts(session, [e.id for e in events])
    return Page(items=[event_out(e, storage, counts[e.id]) for e in events], total=total, limit=limit,
                offset=offset)


@router.get("/events/{event_id}", response_model=EventOut, responses={404: {"model": ErrorResponse}})
async def get_event(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> EventOut:
    event = await get_event_or_404(session, event_id)
    counts = await photo_counts(session, [event.id])
    return event_out(event, storage, counts[event.id])


@router.patch("/events/{event_id}", response_model=EventOut, responses={404: {"model": ErrorResponse}})
async def update_event(event_id: uuid.UUID, body: EventUpdate, session: SessionDep,
                       storage: StorageDep) -> EventOut:
    event = await get_event_or_404(session, event_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        raise UnprocessableError("Name cannot be null", code="validation_error")
    if "status" in data and data["status"] is None:
        data.pop("status")
    for key, value in data.items():
        setattr(event, key, value)
    await session.commit()
    await session.refresh(event)
    counts = await photo_counts(session, [event.id])
    return event_out(event, storage, counts[event.id])


@router.post("/events/{event_id}/rotate-link", response_model=EventOut, responses={404: {"model": ErrorResponse}})
async def rotate_guest_link(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> EventOut:
    """Replace the event's guest code. The old link and QR code stop working immediately (use if they leaked);
    photos, faces and the event itself are unchanged."""
    event = await get_event_or_404(session, event_id)
    event.slug = new_slug()
    await session.commit()
    await session.refresh(event)
    logger.info("Guest link rotated", extra={"event_id": str(event.id)})
    counts = await photo_counts(session, [event.id])
    return event_out(event, storage, counts[event.id])


@router.put("/events/{event_id}/cover", response_model=EventOut,
            responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}})
async def upload_cover(event_id: uuid.UUID, session: SessionDep, storage: StorageDep, settings: SettingsDep,
                       file: Annotated[UploadFile, File(description="Cover image (JPEG/PNG/WebP)")]) -> EventOut:
    event = await get_event_or_404(session, event_id)

    def _process() -> bytes:
        hash_stream(file.file, settings.max_upload_bytes)
        img = load_rgb(file.file, settings, max_side=2400)
        try:
            return to_webp(fit_within(img, 1920, 1080), settings.preview_quality)
        finally:
            img.close()

    try:
        data = await run_in_threadpool(_process)
    except InvalidImageError as exc:
        raise UnprocessableError(str(exc), code=exc.code) from exc
    key = f"events/{event.id}/cover/{uuid.uuid4()}.webp"
    old_key = event.cover_key
    try:
        await run_in_threadpool(storage.put_bytes, key, data, "image/webp")
    except StorageError as exc:
        raise UnprocessableError("Could not store the cover image", code="storage_error",
                                 status_code=503) from exc
    event.cover_key = key
    await session.commit()
    if old_key:
        try:
            await run_in_threadpool(storage.delete, old_key)
        except StorageError:
            logger.warning("Could not delete old cover %s", old_key)
    await session.refresh(event)
    counts = await photo_counts(session, [event.id])
    return event_out(event, storage, counts[event.id])


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT,
               responses={404: {"model": ErrorResponse}})
async def delete_event(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> Response:
    """Permanently delete an event, its photos (originals and derivatives) and all face embeddings."""
    event = await get_event_or_404(session, event_id)
    keys = [k for row in (await session.execute(
        select(Photo.original_key, Photo.thumbnail_key, Photo.preview_key).where(Photo.event_id == event.id)
    )).all() for k in row if k]
    if event.cover_key:
        keys.append(event.cover_key)
    await session.execute(delete(FaceEmbedding).where(FaceEmbedding.event_id == event.id))
    await session.delete(event)
    await session.commit()

    def _purge() -> int:
        failed = 0
        for k in keys:
            try:
                storage.delete(k)
            except StorageError:
                failed += 1
        return failed

    failed = await run_in_threadpool(_purge)
    if failed:
        logger.warning("Event %s deleted but %d storage objects could not be removed", event_id, failed)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/events/{event_id}/faces", status_code=status.HTTP_200_OK,
               responses={404: {"model": ErrorResponse}})
async def purge_event_faces(event_id: uuid.UUID, session: SessionDep) -> dict[str, int]:
    """Delete all biometric face embeddings for an event (photos are kept). Used by the retention policy."""
    event = await get_event_or_404(session, event_id)
    result = await session.execute(delete(FaceEmbedding).where(FaceEmbedding.event_id == event.id))
    photos = (await session.execute(select(Photo).where(Photo.event_id == event.id))).scalars().all()
    for p in photos:
        p.face_count = 0
    await session.commit()
    return {"deleted_faces": result.rowcount or 0}


@router.get("/events/{event_id}/status", response_model=EventStatusOut, responses={404: {"model": ErrorResponse}})
async def event_status(event_id: uuid.UUID, session: SessionDep, storage: StorageDep) -> EventStatusOut:
    event = await get_event_or_404(session, event_id)
    counts = (await photo_counts(session, [event.id]))[event.id]
    done = counts.indexed + counts.failed
    failures = (await session.execute(
        select(Photo).where(Photo.event_id == event.id, Photo.status == PhotoStatus.failed)
        .order_by(Photo.updated_at.desc()).limit(10)
    )).scalars().all()
    return EventStatusOut(
        event_id=event.id, counts=counts,
        progress=round(done / counts.total, 4) if counts.total else 1.0,
        is_complete=counts.pending == 0 and counts.processing == 0,
        recent_failures=[photo_out(p, storage, with_preview=False) for p in failures],
    )


async def compute_storage_overview(session: SessionDep, settings: SettingsDep) -> StorageOverviewOut:
    photo_bytes = (await session.execute(select(func.coalesce(func.sum(Photo.size_bytes), 0)))).scalar_one()
    deriv_bytes = (await session.execute(select(func.coalesce(func.sum(PhotoWatermarkDerivative.size_bytes), 0)))).scalar_one()
    photo_count = (await session.execute(select(func.count(Photo.id)))).scalar_one()
    variant_bytes = photo_count * 250_000  # thumbnail & preview estimates
    real_db_bytes = int(photo_bytes + deriv_bytes + variant_bytes)

    if settings.storage_backend == "local" and settings.local_storage_dir.is_dir():
        disk_bytes = sum(f.stat().st_size for f in settings.local_storage_dir.rglob("*") if f.is_file())
        real_db_bytes = max(real_db_bytes, disk_bytes)

    total_gb = float(settings.storage_quota_gb or 10.0)
    quota_bytes = int(total_gb * (1024**3))

    if settings.storage_used_gb is not None:
        used_bytes = int(float(settings.storage_used_gb) * (1024**3)) + real_db_bytes
    else:
        used_bytes = real_db_bytes

    used_gb = round(used_bytes / (1024**3), 3)
    available_bytes = max(0, quota_bytes - used_bytes)
    available_gb = round(available_bytes / (1024**3), 2)
    used_percent = round((used_bytes / quota_bytes) * 100, 2) if quota_bytes > 0 else 0.0

    provider_name = "Cloudflare R2"

    return StorageOverviewOut(
        used_bytes=used_bytes,
        quota_bytes=quota_bytes,
        used_percent=used_percent,
        used_gb=used_gb,
        available_gb=available_gb,
        total_gb=total_gb,
        provider=provider_name,
    )


@router.get("/dashboard/storage", response_model=StorageOverviewOut, tags=["dashboard"])
async def storage_overview_endpoint(session: SessionDep, settings: SettingsDep) -> StorageOverviewOut:
    return await compute_storage_overview(session, settings)


@router.get("/dashboard/overview", response_model=OverviewOut, tags=["dashboard"])
async def overview(session: SessionDep, storage: StorageDep, settings: SettingsDep) -> OverviewOut:
    events = (await session.execute(select(func.count()).select_from(Event))).scalar_one()
    active = (await session.execute(
        select(func.count()).select_from(Event).where(Event.status == EventStatus.active))).scalar_one()
    by_status = dict((await session.execute(
        select(Photo.status, func.count()).group_by(Photo.status))).all())
    faces = (await session.execute(select(func.count()).select_from(FaceEmbedding))).scalar_one()
    recent = (await session.execute(select(Event).order_by(Event.created_at.desc()).limit(5))).scalars().all()
    counts = await photo_counts(session, [e.id for e in recent])

    def n(s: PhotoStatus) -> int:
        return int(by_status.get(s, 0) or by_status.get(s.value, 0))

    storage_info = await compute_storage_overview(session, settings)

    return OverviewOut(
        events=events, active_events=active, photos=sum(int(v) for v in by_status.values()),
        indexed_photos=n(PhotoStatus.indexed), indexed_faces=faces,
        processing=n(PhotoStatus.pending) + n(PhotoStatus.processing), failures=n(PhotoStatus.failed),
        recent_events=[event_out(e, storage, counts[e.id]) for e in recent],
        storage=storage_info,
    )

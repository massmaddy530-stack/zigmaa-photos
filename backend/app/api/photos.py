"""Photo upload, listing, detail, retry and deletion endpoints."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import SessionDep, SettingsDep, StorageDep
from app.core.errors import AppError, ConflictError, NotFoundError, error_body
from app.core.security import Role, require_admin, require_uploader
from app.models import EventStatus, FaceEmbedding, Photo, PhotoStatus, ProcessingJob
from app.schemas import (
    ErrorResponse,
    FaceOut,
    JobOut,
    Page,
    PhotoDetailOut,
    PhotoOut,
    RetryResponse,
    UploadResponse,
)
from app.services.dispatch import QueueUnavailableError, enqueue_index
from app.services.events import get_event_or_404, photo_out
from app.services.indexing import reset_for_retry
from app.services.ingest import ingest_upload
from app.services.storage import StorageError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/events/{event_id}/photos", tags=["photos"],
                   responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse},
                              404: {"model": ErrorResponse}})

_HEX64 = re.compile(r"^[0-9a-f]{64}$")


@router.post(
    "",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload one or more photos",
    description=(
        "Multipart upload with one or more `files` parts. Each file is validated, de-duplicated by SHA-256 "
        "within the event, stored, and queued for indexing. Returns 201 if at least one photo was created, "
        "200 if all were duplicates, and 422 if every file was rejected (per-file reasons in `details`)."
    ),
    responses={200: {"model": UploadResponse}, 413: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
               503: {"model": ErrorResponse}},
)
async def upload_photos(
    event_id: uuid.UUID,
    session: SessionDep,
    storage: StorageDep,
    settings: SettingsDep,
    files: Annotated[list[UploadFile], File(description="Image files (JPEG, PNG, WebP)")],
    role: Role = Depends(require_uploader),
    source: Annotated[str, Form(pattern="^(dashboard|agent|api)$")] = "dashboard",
):
    event = await get_event_or_404(session, event_id)
    if event.status != EventStatus.active:
        raise ConflictError("Cannot upload to an archived event", code="event_archived")
    if len(files) > settings.max_files_per_request:
        raise AppError(f"At most {settings.max_files_per_request} files per request",
                       code="too_many_files", status_code=413)
    if role is Role.ingest:
        source = "agent"

    results, created = [], []
    try:
        for upload in files:
            result, photo = await ingest_upload(session, event, upload, storage, settings, source)
            results.append(result)
            if photo is not None:
                created.append(photo.id)
    finally:
        for upload in files:
            await upload.close()

    if created:
        try:
            await enqueue_index(created)
        except QueueUnavailableError:
            # Photos are saved as "pending"; they can be re-queued with the retry endpoint.
            logger.error("Uploaded %d photos but could not queue indexing", len(created))

    body = UploadResponse(
        created=len(created),
        duplicates=sum(r.status == "duplicate" for r in results),
        rejected=sum(r.status == "rejected" for r in results),
        items=results,
    )
    if body.created:
        return JSONResponse(body.model_dump(mode="json"), status_code=201)
    if body.duplicates:
        return JSONResponse(body.model_dump(mode="json"), status_code=200)
    storage_failed = any(r.error_code == "storage_error" for r in results)
    return JSONResponse(
        error_body("storage_unavailable" if storage_failed else "all_files_rejected",
                   "Storage is unavailable; please retry" if storage_failed else "No valid images were uploaded",
                   body.model_dump(mode="json")),
        status_code=503 if storage_failed else 422,
    )


class HashCheckRequest(BaseModel):
    hashes: list[str] = Field(max_length=1000)


class HashCheckResponse(BaseModel):
    existing: list[str]


@router.post("/check-hashes", response_model=HashCheckResponse,
             summary="Return which SHA-256 hashes already exist in the event (lets agents skip re-uploads)")
async def check_hashes(event_id: uuid.UUID, body: HashCheckRequest, session: SessionDep,
                       _: Role = Depends(require_uploader)) -> HashCheckResponse:
    await get_event_or_404(session, event_id)
    hashes = [h.lower() for h in body.hashes if _HEX64.match(h.lower())]
    if not hashes:
        return HashCheckResponse(existing=[])
    rows = await session.execute(
        select(Photo.content_hash).where(Photo.event_id == event_id, Photo.content_hash.in_(hashes)))
    return HashCheckResponse(existing=[r[0] for r in rows])


@router.get("", response_model=Page[PhotoOut], dependencies=[Depends(require_admin)])
async def list_photos(
    event_id: uuid.UUID, session: SessionDep, storage: StorageDep,
    status_filter: Annotated[PhotoStatus | None, Query(alias="status")] = None,
    q: Annotated[str | None, Query(max_length=100, description="Filter by filename")] = None,
    has_faces: Annotated[bool | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 48,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PhotoOut]:
    await get_event_or_404(session, event_id)
    stmt = select(Photo).where(Photo.event_id == event_id)
    if status_filter:
        stmt = stmt.where(Photo.status == status_filter)
    if q:
        stmt = stmt.where(func.lower(Photo.original_filename).like(f"%{q.strip().lower()}%"))
    if has_faces is not None:
        stmt = stmt.where(Photo.face_count > 0 if has_faces else Photo.face_count == 0)
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    photos = (await session.execute(
        stmt.order_by(Photo.created_at.desc(), Photo.id).limit(limit).offset(offset))).scalars().all()
    items = await run_in_threadpool(lambda: [photo_out(p, storage) for p in photos])
    return Page(items=items, total=total, limit=limit, offset=offset)


async def _get_photo(session, event_id: uuid.UUID, photo_id: uuid.UUID) -> Photo:
    photo = await session.get(Photo, photo_id)
    # Event-scoped lookup: a photo id from another event is reported as not found.
    if photo is None or photo.event_id != event_id:
        raise NotFoundError("Photo not found")
    return photo


@router.get("/{photo_id}", response_model=PhotoDetailOut, dependencies=[Depends(require_admin)])
async def get_photo(event_id: uuid.UUID, photo_id: uuid.UUID, session: SessionDep,
                    storage: StorageDep) -> PhotoDetailOut:
    photo = await _get_photo(session, event_id, photo_id)
    faces = (await session.execute(
        select(FaceEmbedding.face_index, FaceEmbedding.bbox_x1, FaceEmbedding.bbox_y1, FaceEmbedding.bbox_x2,
               FaceEmbedding.bbox_y2, FaceEmbedding.det_score)
        .where(FaceEmbedding.photo_id == photo.id).order_by(FaceEmbedding.face_index))).all()
    jobs = (await session.execute(
        select(ProcessingJob).where(ProcessingJob.photo_id == photo.id)
        .order_by(ProcessingJob.created_at.desc()).limit(10))).scalars().all()
    base = photo_out(photo, storage)
    return PhotoDetailOut(
        **base.model_dump(),
        original_url=storage.signed_url(photo.original_key),
        faces=[FaceOut(face_index=f[0], bbox=[f[1], f[2], f[3], f[4]], det_score=f[5]) for f in faces],
        jobs=[JobOut.model_validate(j) for j in jobs],
    )


@router.post("/{photo_id}/retry", response_model=RetryResponse, status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(require_admin)])
async def retry_photo(event_id: uuid.UUID, photo_id: uuid.UUID, session: SessionDep) -> RetryResponse:
    photo = await _get_photo(session, event_id, photo_id)
    if photo.status == PhotoStatus.indexed:
        raise ConflictError("Photo is already indexed", code="already_indexed")
    ids = await reset_for_retry(session, [photo.id])
    await _enqueue_or_503(ids)
    return RetryResponse(queued=len(ids), photo_ids=ids)


@router.post("/retry-failed", response_model=RetryResponse, status_code=status.HTTP_202_ACCEPTED,
             dependencies=[Depends(require_admin)],
             summary="Re-queue all failed (and stuck pending) photos of the event")
async def retry_failed(event_id: uuid.UUID, session: SessionDep,
                       include_pending: Annotated[bool, Query()] = False) -> RetryResponse:
    await get_event_or_404(session, event_id)
    statuses = [PhotoStatus.failed] + ([PhotoStatus.pending, PhotoStatus.processing] if include_pending else [])
    ids = list((await session.execute(
        select(Photo.id).where(Photo.event_id == event_id, Photo.status.in_(statuses)))).scalars())
    ids = await reset_for_retry(session, ids)
    await _enqueue_or_503(ids)
    return RetryResponse(queued=len(ids), photo_ids=ids)


async def _enqueue_or_503(ids: list[uuid.UUID]) -> None:
    try:
        await enqueue_index(ids)
    except QueueUnavailableError as exc:
        raise AppError("Task queue is unavailable; is Redis running?", code="queue_unavailable",
                       status_code=503) from exc


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
async def delete_photo(event_id: uuid.UUID, photo_id: uuid.UUID, session: SessionDep,
                       storage: StorageDep) -> Response:
    photo = await _get_photo(session, event_id, photo_id)
    keys = [k for k in (photo.original_key, photo.thumbnail_key, photo.preview_key) if k]
    await session.delete(photo)
    await session.commit()
    for k in keys:
        try:
            await run_in_threadpool(storage.delete, k)
        except StorageError:
            logger.warning("Could not delete object %s", k)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

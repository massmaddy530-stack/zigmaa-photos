"""Selfie matching (public guest flow + admin) and public event endpoints."""

from __future__ import annotations

import io
import logging
import time
import uuid
from typing import Annotated

import qrcode
import qrcode.image.svg
from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy import func, select
from starlette.concurrency import run_in_threadpool

from app.api.deps import SessionDep, SettingsDep, StorageDep
from app.core.config import Settings
from app.core.errors import AppError, NotFoundError, PayloadTooLargeError
from app.core.ratelimit import RateLimiter
from app.core.security import require_admin
from app.models import Event, Photo, PhotoStatus
from app.schemas import ErrorResponse, MatchPage, MatchResponse, MatchTimings, PublicEventOut
from app.services.events import get_event_or_404, get_public_event_or_404, public_url
from app.services.face.engine import analyzer_available
from app.services.match_store import get_match_store
from app.services.matching import Timings, search_selfie_faces, selfie_embeddings, serialize_matches
from app.services.storage import Storage

logger = logging.getLogger(__name__)

public_router = APIRouter(prefix="/api/v1/public/events", tags=["guest"])
admin_router = APIRouter(prefix="/api/v1/events", tags=["matching"], dependencies=[Depends(require_admin)])

DEFAULT_PAGE = 48
_limiter: RateLimiter | None = None


def get_limiter(settings: SettingsDep) -> RateLimiter:
    global _limiter
    if _limiter is None:
        _limiter = RateLimiter(settings)
    return _limiter


async def _read_selfie(upload: UploadFile, settings: Settings) -> bytes:
    """Read the selfie into memory with a hard cap. It is never written to storage or logged."""
    data = await upload.read(settings.selfie_max_bytes + 1)
    await upload.close()
    if len(data) > settings.selfie_max_bytes:
        raise PayloadTooLargeError(f"Selfie must be smaller than {settings.selfie_max_bytes // (1024 * 1024)} MB",
                                   code="file_too_large")
    if not data:
        raise AppError("Selfie file is empty", code="empty_file", status_code=422)
    return data


async def _run_match(session, event: Event, upload: UploadFile, settings: Settings, storage: Storage,
                     page_size: int) -> MatchResponse:
    timings = Timings()
    data = await _read_selfie(upload, settings)
    try:
        embeddings = await run_in_threadpool(selfie_embeddings, data, settings, timings)
    finally:
        del data  # drop the selfie bytes as early as possible
    faces_searched = len(embeddings)
    t0 = time.perf_counter()
    results = await search_selfie_faces(session, event.id, embeddings, settings)
    await session.commit()  # end the transaction holding SET LOCAL search settings
    timings.vector_search_ms = (time.perf_counter() - t0) * 1000
    del embeddings

    t1 = time.perf_counter()
    token = await get_match_store().save(event.id, results, settings.match_session_ttl_s) if results else None
    items = await serialize_matches(session, event.id, results[:page_size], storage)
    timings.serialization_ms = (time.perf_counter() - t1) * 1000
    logger.info("Selfie match", extra={
        "event_id": str(event.id), "matches": len(results), "selfie_faces": faces_searched,
        **{k: round(v, 1) for k, v in vars(timings).items()}})
    return MatchResponse(
        match_token=token, total=len(results), items=items,
        next_cursor=page_size if len(results) > page_size else None,
        threshold=settings.match_similarity_threshold,
        timings=MatchTimings(**{k: round(v, 2) for k, v in vars(timings).items()}, total_ms=round(timings.total_ms, 2)),
    )


_MATCH_RESPONSES = {
    400: {"model": ErrorResponse, "description": "Consent not given"},
    413: {"model": ErrorResponse}, 422: {"model": ErrorResponse, "description": "Invalid image / no face / many faces"},
    429: {"model": ErrorResponse}, 503: {"model": ErrorResponse, "description": "Face model unavailable"},
}


@admin_router.post("/{event_id}/match", response_model=MatchResponse, responses=_MATCH_RESPONSES,
                   summary="Match a selfie against an event (admin)")
async def admin_match(event_id: uuid.UUID, session: SessionDep, settings: SettingsDep, storage: StorageDep,
                      selfie: Annotated[UploadFile, File()],
                      page_size: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE) -> MatchResponse:
    event = await get_event_or_404(session, event_id)
    return await _run_match(session, event, selfie, settings, storage, page_size)


@admin_router.get("/{event_id}/matches/{token}", response_model=MatchPage)
async def admin_match_page(event_id: uuid.UUID, token: str, session: SessionDep, storage: StorageDep,
                           cursor: Annotated[int, Query(ge=0)] = 0,
                           limit: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE) -> MatchPage:
    event = await get_event_or_404(session, event_id)
    return await _page(session, event, token, cursor, limit, storage)


async def _page(session, event: Event, token: str, cursor: int, limit: int, storage: Storage) -> MatchPage:
    results = await get_match_store().load(event.id, token[:64])
    if results is None:
        raise NotFoundError("These results have expired. Please take your selfie again.", code="match_expired")
    items = await serialize_matches(session, event.id, results[cursor:cursor + limit], storage)
    nxt = cursor + limit
    return MatchPage(total=len(results), items=items, next_cursor=nxt if nxt < len(results) else None)


# --------------------------------------------------------------------------- public


@public_router.get("/{slug}", response_model=PublicEventOut, responses={404: {"model": ErrorResponse}})
async def public_event(slug: str, session: SessionDep, storage: StorageDep) -> PublicEventOut:
    event = await get_public_event_or_404(session, slug)
    count = (await session.execute(select(func.count()).select_from(Photo).where(
        Photo.event_id == event.id, Photo.status == PhotoStatus.indexed))).scalar_one()
    return PublicEventOut(
        slug=event.slug, name=event.name, event_date=event.event_date, venue=event.venue,
        description=event.description,
        cover_url=storage.signed_url(event.cover_key) if event.cover_key else None,
        photo_count=count, matching_available=analyzer_available(),
    )


@public_router.get("/{slug}/resolve")
async def resolve_public_event(slug: str, session: SessionDep) -> dict[str, str]:
    event = await get_public_event_or_404(session, slug, allow_expired=True)
    return {"id": str(event.id), "slug": event.slug, "name": event.name}


@public_router.get("/{slug}/qr.svg", response_class=Response, responses={200: {"content": {"image/svg+xml": {}}}})
async def public_event_qr(slug: str, session: SessionDep) -> Response:
    # The QR only encodes the public link, so it is served even after expiry (the dashboard still shows it);
    # the guest page itself refuses expired links.
    event = await get_public_event_or_404(session, slug, allow_expired=True)
    img = qrcode.make(public_url(event.slug), image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})


@public_router.post("/{slug}/match", response_model=MatchResponse, responses=_MATCH_RESPONSES,
                    summary="Guest selfie match (rate limited, requires consent)")
async def public_match(
    slug: str, request: Request, session: SessionDep, settings: SettingsDep, storage: StorageDep,
    selfie: Annotated[UploadFile, File(description="Selfie image (JPEG/PNG/WebP)")],
    consent: Annotated[bool, Form(description="Guest consents to one-time biometric processing")] = False,
    page_size: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE,
    limiter: RateLimiter = Depends(get_limiter),
) -> MatchResponse:
    await limiter.check(request, "match", settings.match_rate_limit, settings.match_rate_window_s)
    if not consent:
        await selfie.close()
        raise AppError("Please confirm consent before we process your selfie.", code="consent_required")
    event = await get_public_event_or_404(session, slug)
    response = await _run_match(session, event, selfie, settings, storage, page_size)
    if settings.environment == "production":
        response.timings = None
    return response


@public_router.get("/{slug}/matches/{token}", response_model=MatchPage, responses={404: {"model": ErrorResponse}})
async def public_match_page(slug: str, token: str, session: SessionDep, storage: StorageDep,
                            cursor: Annotated[int, Query(ge=0)] = 0,
                            limit: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE) -> MatchPage:
    event = await get_public_event_or_404(session, slug)
    return await _page(session, event, token, cursor, limit, storage)


match_selfie_router = APIRouter(tags=["selfie-matching"])


async def _process_match_selfie(
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    event_id: uuid.UUID,
    file: UploadFile | None,
    selfie: UploadFile | None,
):
    upload = file or selfie
    if upload is None:
        raise AppError("Selfie file is required", code="missing_file", status_code=422)

    import gc
    import numpy as np
    from PIL import Image
    from sqlalchemy import text
    from app.services.face.engine import get_analyzer, l2_normalize
    from app.services.matching import _area

    data = await _read_selfie(upload, settings)

    with Image.open(io.BytesIO(data)) as raw_img:
        if raw_img.mode != "RGB":
            raw_img = raw_img.convert("RGB")
        if max(raw_img.size) > 1024:
            scale = 1024 / max(raw_img.size)
            img = raw_img.resize((max(1, int(raw_img.width * scale)), max(1, int(raw_img.height * scale))), Image.Resampling.BILINEAR)
        else:
            img = raw_img.copy()

    try:
        faces = await run_in_threadpool(get_analyzer().analyze, img)
    finally:
        img.close()
        gc.collect()

    if not faces:
        raise AppError("No face detected in selfie. Please upload a clear photo of your face.", code="no_face_detected", status_code=422)

    largest_face = max(faces, key=_area)
    selfie_emb = l2_normalize(largest_face.embedding)

    emb_str = "[" + ",".join(f"{x:.7g}" for x in selfie_emb) + "]"

    if session.bind.dialect.name == "postgresql":
        query = text("""
            SELECT DISTINCT p.id,
                   COALESCE(p.r2_preview_url, ep.r2_preview_url) AS r2_preview_url,
                   COALESCE(p.r2_thumbnail_url, ep.r2_thumbnail_url) AS r2_thumbnail_url,
                   COALESCE(p.r2_original_url, ep.r2_original_url) AS r2_original_url
            FROM face_embeddings fe
            JOIN photos p ON p.id = fe.photo_id
            LEFT JOIN event_photos ep ON ep.id = fe.photo_id
            WHERE fe.event_id = :event_id
              AND (fe.embedding <=> CAST(:selfie_embedding AS vector)) < 0.48
            ORDER BY (fe.embedding <=> CAST(:selfie_embedding AS vector)) ASC
            LIMIT 50;
        """)
        try:
            res = await session.execute(query, {"event_id": event_id, "selfie_embedding": emb_str})
            rows = res.fetchall()
        except Exception:
            alt_query = text("""
                SELECT p.id, p.r2_preview_url, p.r2_thumbnail_url, p.r2_original_url
                FROM (
                    SELECT DISTINCT ON (p.id) p.id,
                           COALESCE(p.r2_preview_url, ep.r2_preview_url) AS r2_preview_url,
                           COALESCE(p.r2_thumbnail_url, ep.r2_thumbnail_url) AS r2_thumbnail_url,
                           COALESCE(p.r2_original_url, ep.r2_original_url) AS r2_original_url,
                           (fe.embedding <=> CAST(:selfie_embedding AS vector)) AS dist
                    FROM face_embeddings fe
                    JOIN photos p ON p.id = fe.photo_id
                    LEFT JOIN event_photos ep ON ep.id = fe.photo_id
                    WHERE fe.event_id = :event_id
                      AND (fe.embedding <=> CAST(:selfie_embedding AS vector)) < 0.48
                    ORDER BY p.id, (fe.embedding <=> CAST(:selfie_embedding AS vector)) ASC
                ) p
                ORDER BY p.dist ASC
                LIMIT 50;
            """)
            res = await session.execute(alt_query, {"event_id": event_id, "selfie_embedding": emb_str})
            rows = res.fetchall()
    else:
        from sqlalchemy import func
        from app.models import EventPhoto, FaceEmbedding, Photo
        stmt = (
            select(
                Photo.id,
                func.coalesce(Photo.r2_preview_url, EventPhoto.r2_preview_url),
                func.coalesce(Photo.r2_thumbnail_url, EventPhoto.r2_thumbnail_url),
                func.coalesce(Photo.r2_original_url, EventPhoto.r2_original_url),
                FaceEmbedding.embedding,
            )
            .join(FaceEmbedding, FaceEmbedding.photo_id == Photo.id)
            .outerjoin(EventPhoto, EventPhoto.id == Photo.id)
            .where(FaceEmbedding.event_id == event_id)
        )
        res = await session.execute(stmt)
        best_matches = {}
        for row in res.all():
            pid, prev_u, thumb_u, orig_u, emb_val = row[0], row[1], row[2], row[3], row[4]
            dot = float(np.dot(selfie_emb, np.asarray(emb_val, dtype=np.float32)))
            dist = 1.0 - dot
            if dist < 0.48:
                if pid not in best_matches or dist < best_matches[pid]["dist"]:
                    best_matches[pid] = {
                        "id": str(pid),
                        "r2_preview_url": prev_u,
                        "r2_thumbnail_url": thumb_u,
                        "r2_original_url": orig_u,
                        "dist": dist
                    }
        sorted_m = sorted(best_matches.values(), key=lambda x: x["dist"])[:50]
        rows = [(m["id"], m["r2_preview_url"], m["r2_thumbnail_url"], m["r2_original_url"]) for m in sorted_m]

    matches = [
        {
            "id": str(r[0]),
            "r2_preview_url": r[1],
            "r2_thumbnail_url": r[2],
            "r2_original_url": r[3],
        }
        for r in rows
    ]

    gc.collect()
    return {
        "status": "ok",
        "total": len(matches),
        "matches": matches,
        "photos": matches,
    }


@match_selfie_router.post("/match-selfie")
@match_selfie_router.post("/api/v1/match-selfie")
async def match_selfie_endpoint(
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    event_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile | None, File()] = None,
    selfie: Annotated[UploadFile | None, File()] = None,
):
    return await _process_match_selfie(session, settings, storage, event_id, file, selfie)


@match_selfie_router.post("/api/v1/events/{event_id}/match-selfie")
async def match_selfie_event_endpoint(
    event_id: uuid.UUID,
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    file: Annotated[UploadFile | None, File()] = None,
    selfie: Annotated[UploadFile | None, File()] = None,
):
    return await _process_match_selfie(session, settings, storage, event_id, file, selfie)


@match_selfie_router.post("/upload-event-photo")
@match_selfie_router.post("/api/v1/upload-event-photo")
async def upload_event_photo_endpoint(
    session: SessionDep,
    settings: SettingsDep,
    storage: StorageDep,
    event_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
):
    import gc
    from PIL import Image
    from app.models import EventPhoto, FaceEmbedding, Photo, PhotoStatus, utcnow
    from app.services.face.engine import get_analyzer, l2_normalize
    from app.services.storage import generate_variants

    content = await file.read()
    if not content:
        raise AppError("File is empty", code="empty_file", status_code=422)

    thumb_bytes, prev_bytes = generate_variants(content)

    photo_id = uuid.uuid4()
    orig_key = f"events/{event_id}/originals/{photo_id}.jpg"
    thumb_key = f"events/{event_id}/thumbnails/{photo_id}.webp"
    prev_key = f"events/{event_id}/previews/{photo_id}.webp"

    orig_url = storage.upload_file(content, orig_key, file.content_type or "image/jpeg")
    thumb_url = storage.upload_file(thumb_bytes, thumb_key, "image/webp")
    prev_url = storage.upload_file(prev_bytes, prev_key, "image/webp")

    ev_photo = EventPhoto(
        id=photo_id,
        event_id=event_id,
        r2_preview_url=prev_url,
        r2_thumbnail_url=thumb_url,
        r2_original_url=orig_url,
        created_at=utcnow(),
    )
    session.add(ev_photo)

    legacy_photo = Photo(
        id=photo_id,
        event_id=event_id,
        original_filename=file.filename or f"{photo_id}.jpg",
        content_hash=uuid.uuid4().hex,
        content_type=file.content_type or "image/jpeg",
        size_bytes=len(content),
        original_key=orig_key,
        thumbnail_key=thumb_key,
        preview_key=prev_key,
        r2_preview_url=prev_url,
        r2_thumbnail_url=thumb_url,
        r2_original_url=orig_url,
        status=PhotoStatus.indexed,
    )
    session.add(legacy_photo)

    with Image.open(io.BytesIO(content)) as raw_img:
        if raw_img.mode != "RGB":
            raw_img = raw_img.convert("RGB")
        if max(raw_img.size) > 1024:
            scale = 1024 / max(raw_img.size)
            img = raw_img.resize((max(1, int(raw_img.width * scale)), max(1, int(raw_img.height * scale))), Image.Resampling.BILINEAR)
        else:
            img = raw_img.copy()

    try:
        faces = await run_in_threadpool(get_analyzer().analyze, img)
    finally:
        img.close()
        gc.collect()

    for i, face in enumerate(faces):
        emb = l2_normalize(face.embedding)
        session.add(FaceEmbedding(
            event_id=event_id,
            photo_id=photo_id,
            face_index=i,
            bbox_x1=face.bbox[0],
            bbox_y1=face.bbox[1],
            bbox_x2=face.bbox[2],
            bbox_y2=face.bbox[3],
            det_score=float(face.det_score),
            embedding=emb,
            model_name="buffalo_sc",
            created_at=utcnow(),
        ))

    await session.commit()
    gc.collect()

    return {
        "status": "ok",
        "photo_id": str(photo_id),
        "faces_detected": len(faces),
        "r2_preview_url": prev_url,
        "r2_thumbnail_url": thumb_url,
        "r2_original_url": orig_url,
    }

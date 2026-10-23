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

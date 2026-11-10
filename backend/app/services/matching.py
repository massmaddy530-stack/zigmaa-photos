"""Selfie -> embedding -> event-scoped vector search."""

from __future__ import annotations

import io
import logging
import time
import uuid
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import Settings
from app.core.errors import ServiceUnavailableError, UnprocessableError
from app.models import FaceEmbedding, Photo, PhotoStatus
from app.schemas import MatchItem
from app.services.face.engine import DetectedFace, FaceModelUnavailableError, get_analyzer
from app.services.images import InvalidImageError, inspect_image, load_rgb
from app.services.storage import Storage

logger = logging.getLogger(__name__)

SELFIE_MAX_SIDE = 1280
MAX_SELFIE_FACES = 2  # e.g. a guest with a companion; more main faces looks like a group photo
BACKGROUND_FACE_RATIO = 9.0  # faces this many times smaller (by area) than the largest are ignored


@dataclass
class Timings:
    validation_ms: float = 0.0
    detection_embedding_ms: float = 0.0
    vector_search_ms: float = 0.0
    serialization_ms: float = 0.0

    @property
    def total_ms(self) -> float:
        return self.validation_ms + self.detection_embedding_ms + self.vector_search_ms + self.serialization_ms


def _area(f: DetectedFace) -> float:
    return float(max(0.0, f.bbox[2] - f.bbox[0]) * max(0.0, f.bbox[3] - f.bbox[1]))


def choose_largest_selfie_face(faces: list[DetectedFace]) -> DetectedFace:
    """Select only the largest detected face (by bounding box area w * h)."""
    if not faces:
        raise UnprocessableError(
            "We couldn't find a face in your selfie. Face the camera in good light and try again.",
            code="no_face_detected",
        )
    return max(faces, key=_area)


def choose_selfie_faces(faces: list[DetectedFace], require_single: bool) -> list[DetectedFace]:
    """Faces to search with: up to MAX_SELFIE_FACES main faces, largest first. Small background faces are
    ignored. With ``require_single``, more main faces than that is rejected instead of truncated."""
    if not faces:
        raise UnprocessableError(
            "We couldn't find a face in your selfie. Face the camera in good light and try again.",
            code="no_face_detected")
    ranked = sorted(faces, key=_area, reverse=True)
    main = [f for f in ranked if _area(ranked[0]) < BACKGROUND_FACE_RATIO * _area(f)]
    if require_single and len(main) > MAX_SELFIE_FACES:
        raise UnprocessableError(
            f"We found {len(main)} faces. Please take a selfie with only your face in the frame.",
            code="multiple_faces_detected", details={"faces": len(main)})
    return main[:MAX_SELFIE_FACES]


def selfie_embeddings(data: bytes, settings: Settings, timings: Timings) -> list[np.ndarray]:
    if not settings.face_analysis_enabled:  # refuse before the selfie is even decoded
        raise ServiceUnavailableError("Face matching is temporarily unavailable.", code="face_model_unavailable")
    t0 = time.perf_counter()
    try:
        inspect_image(io.BytesIO(data), settings)
        img = load_rgb(io.BytesIO(data), settings, max_side=SELFIE_MAX_SIDE)
    except InvalidImageError as exc:
        raise UnprocessableError(str(exc), code=exc.code) from exc
    t1 = time.perf_counter()
    timings.validation_ms = (t1 - t0) * 1000
    try:
        faces = get_analyzer().analyze(img)
    except FaceModelUnavailableError as exc:
        logger.error("Face model unavailable: %s", exc)
        raise ServiceUnavailableError("Face matching is temporarily unavailable.",
                                      code="face_model_unavailable") from exc
    finally:
        img.close()
    chosen = choose_selfie_faces(faces, settings.selfie_require_single_face)
    timings.detection_embedding_ms = (time.perf_counter() - t1) * 1000
    return [f.embedding for f in chosen]


_pgvector_version: tuple[int, ...] | None = None


async def _pgvector_supports_iterative(session: AsyncSession) -> bool:
    global _pgvector_version
    if _pgvector_version is None:
        v = (await session.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'"))).scalar()
        _pgvector_version = tuple(int(x) for x in (v or "0").split(".")[:2])
    return _pgvector_version >= (0, 8)


async def search_event_faces(session: AsyncSession, event_id: uuid.UUID, embedding: np.ndarray,
                             settings: Settings) -> list[tuple[uuid.UUID, float]]:
    """Return [(photo_id, best_similarity)] for photos in this event above the threshold, best first."""
    threshold = settings.match_similarity_threshold
    q = np.asarray(embedding, dtype=np.float32)
    if session.bind.dialect.name == "postgresql":
        await session.execute(text(f"SET LOCAL hnsw.ef_search = {int(settings.pgvector_ef_search)}"))
        if settings.pgvector_iterative_scan and await _pgvector_supports_iterative(session):
            await session.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        rows = await session.execute(
            text(
                """
                SELECT photo_id, MAX(1 - dist) AS similarity FROM (
                    SELECT photo_id, embedding <=> CAST(:q AS vector) AS dist
                    FROM face_embeddings
                    WHERE event_id = :event_id
                    ORDER BY embedding <=> CAST(:q AS vector)
                    LIMIT :candidates
                ) c
                WHERE dist <= :max_dist
                GROUP BY photo_id
                ORDER BY similarity DESC
                LIMIT :max_results
                """
            ),
            {"q": "[" + ",".join(f"{x:.7g}" for x in q) + "]", "event_id": event_id, "candidates": settings.match_candidate_faces,
             "max_dist": 1.0 - threshold, "max_results": settings.match_max_results},
        )
        return [(r[0] if isinstance(r[0], uuid.UUID) else uuid.UUID(str(r[0])), float(r[1])) for r in rows]

    # Portable fallback (SQLite unit tests): exact cosine search in numpy.
    rows = (await session.execute(
        select(FaceEmbedding.photo_id, FaceEmbedding.embedding).where(FaceEmbedding.event_id == event_id)
    )).all()
    best: dict[uuid.UUID, float] = {}
    for photo_id, emb in rows:
        sim = float(np.dot(q, emb))
        if sim >= threshold and sim > best.get(photo_id, -1.0):
            best[photo_id] = sim
    return sorted(best.items(), key=lambda kv: kv[1], reverse=True)[: settings.match_max_results]


async def search_selfie_faces(session: AsyncSession, event_id: uuid.UUID, embeddings: list[np.ndarray],
                              settings: Settings) -> list[tuple[uuid.UUID, float]]:
    """Search each selfie face in this event and merge: one entry per photo with its best similarity, best first."""
    best: dict[uuid.UUID, float] = {}
    for embedding in embeddings:
        for photo_id, sim in await search_event_faces(session, event_id, embedding, settings):
            if sim > best.get(photo_id, -1.0):
                best[photo_id] = sim
    return sorted(best.items(), key=lambda kv: kv[1], reverse=True)[: settings.match_max_results]


async def serialize_matches(session: AsyncSession, event_id: uuid.UUID, results: list[tuple[uuid.UUID, float]],
                            storage: Storage) -> list[MatchItem]:
    if not results:
        return []
    ids = [pid for pid, _ in results]
    photos = {
        p.id: p for p in (await session.execute(
            select(Photo).where(Photo.id.in_(ids), Photo.event_id == event_id, Photo.status == PhotoStatus.indexed)
        )).scalars()
    }

    def _sign() -> list[MatchItem]:
        items = []
        for pid, sim in results:
            p = photos.get(pid)
            if p is None:
                continue
            thumb = getattr(p, "r2_thumbnail_url", None) or (storage.signed_url(p.thumbnail_key) if p.thumbnail_key else None)
            prev = getattr(p, "r2_preview_url", None) or (storage.signed_url(p.preview_key) if p.preview_key else None)
            orig = getattr(p, "r2_original_url", None) or storage.signed_url(p.original_key)
            items.append(MatchItem(
                photo_id=pid, similarity=round(sim, 4), width=p.width, height=p.height,
                thumbnail_url=thumb,
                preview_url=prev,
                # Original quality, fetched only when the guest taps Download (the grid uses thumbnails).
                download_url=orig,
            ))
        return items

    return await run_in_threadpool(_sign)

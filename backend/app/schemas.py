"""Pydantic request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import EventStatus, JobStatus, PhotoStatus

T = TypeVar("T")


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: object | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# --------------------------------------------------------------------------- events


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class EventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    event_date: date | None = None
    venue: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be blank")
        return v

    @field_validator("venue", "description")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return _clean(v)


class EventUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    event_date: date | None = None
    venue: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=5000)
    status: EventStatus | None = None
    # Send null to remove the expiry. A time without a timezone is taken as UTC.
    guest_link_expires_at: datetime | None = None

    @field_validator("guest_link_expires_at")
    @classmethod
    def _aware(cls, v: datetime | None) -> datetime | None:
        return v.replace(tzinfo=timezone.utc) if v is not None and v.tzinfo is None else v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip() if v else v

    @field_validator("venue", "description")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return _clean(v)


class PhotoCounts(BaseModel):
    total: int = 0
    pending: int = 0
    processing: int = 0
    indexed: int = 0
    failed: int = 0
    faces: int = 0


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    event_date: date | None
    venue: str | None
    description: str | None
    status: EventStatus
    cover_url: str | None = None
    public_url: str
    guest_link_expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    counts: PhotoCounts = PhotoCounts()


class EventStatusOut(BaseModel):
    event_id: uuid.UUID
    counts: PhotoCounts
    progress: float = Field(description="Fraction of photos in a terminal state (indexed or failed)")
    is_complete: bool
    recent_failures: list[PhotoOut] = []


class PublicEventOut(BaseModel):
    slug: str
    name: str
    event_date: date | None
    venue: str | None
    description: str | None
    cover_url: str | None
    photo_count: int
    matching_available: bool


# --------------------------------------------------------------------------- photos


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    event_id: uuid.UUID
    original_filename: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    status: PhotoStatus
    face_count: int
    attempts: int
    error_message: str | None
    source: str
    created_at: datetime
    processed_at: datetime | None
    thumbnail_url: str | None = None
    preview_url: str | None = None


class FaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    face_index: int
    bbox: list[float]
    det_score: float


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: JobStatus
    attempt: int
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    created_at: datetime


class PhotoDetailOut(PhotoOut):
    original_url: str | None = None
    faces: list[FaceOut] = []
    jobs: list[JobOut] = []


class UploadItemResult(BaseModel):
    filename: str
    status: Literal["created", "duplicate", "rejected"]
    photo_id: uuid.UUID | None = None
    error_code: str | None = None
    error: str | None = None
    # A duplicate whose stored original was missing: the upload restored it and the photo is reprocessed.
    restored: bool = False


class UploadResponse(BaseModel):
    created: int
    duplicates: int
    rejected: int
    items: list[UploadItemResult]


class RetryResponse(BaseModel):
    queued: int
    photo_ids: list[uuid.UUID]


# --------------------------------------------------------------------------- matching


class MatchItem(BaseModel):
    photo_id: uuid.UUID
    similarity: float
    width: int | None
    height: int | None
    thumbnail_url: str | None
    preview_url: str | None
    download_url: str | None = Field(default=None, description="Short-lived signed link to the original file")


class MatchTimings(BaseModel):
    validation_ms: float
    detection_embedding_ms: float
    vector_search_ms: float
    serialization_ms: float
    total_ms: float


class MatchResponse(BaseModel):
    match_token: str | None = Field(description="Opaque token for fetching further result pages (short-lived)")
    total: int
    items: list[MatchItem]
    next_cursor: int | None
    threshold: float
    timings: MatchTimings | None = None


class MatchPage(BaseModel):
    total: int
    items: list[MatchItem]
    next_cursor: int | None


# --------------------------------------------------------------------------- dashboard


class OverviewOut(BaseModel):
    events: int
    active_events: int
    photos: int
    indexed_photos: int
    indexed_faces: int
    processing: int
    failures: int
    recent_events: list[EventOut]


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    checks: dict[str, str]


EventStatusOut.model_rebuild()

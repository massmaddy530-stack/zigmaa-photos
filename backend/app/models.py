"""SQLAlchemy ORM models."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db.types import EmbeddingType


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow,
                                                 nullable=False)


class EventStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class PhotoStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    indexed = "indexed"
    failed = "failed"


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, native_enum=False, length=20, validate_strings=True)


class Event(TimestampMixin, Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Unguessable public identifier used in guest URLs / QR codes.
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    event_date: Mapped[date | None] = mapped_column(Date)
    venue: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    cover_key: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[EventStatus] = mapped_column(_enum(EventStatus, "event_status"), default=EventStatus.active,
                                                nullable=False)
    # Optional: the guest link / QR code stops working at this time. NULL = no expiry.
    guest_link_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list[Photo]] = relationship(back_populates="event", passive_deletes=True)

    __table_args__ = (Index("ix_events_status_created", "status", "created_at"),)


class Photo(TimestampMixin, Base):
    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # sha256 hex
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    original_key: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    preview_key: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[PhotoStatus] = mapped_column(_enum(PhotoStatus, "photo_status"), default=PhotoStatus.pending,
                                                nullable=False)
    face_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(20), default="dashboard", nullable=False)

    event: Mapped[Event] = relationship(back_populates="photos")
    faces: Mapped[list[FaceEmbedding]] = relationship(back_populates="photo", passive_deletes=True)

    __table_args__ = (
        UniqueConstraint("event_id", "content_hash", name="uq_photos_event_hash"),
        Index("ix_photos_event_created", "event_id", "created_at"),
        Index("ix_photos_event_status", "event_id", "status"),
    )


class FaceEmbedding(Base):
    __tablename__ = "face_embeddings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Denormalised event_id so searches are scoped without a join.
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    face_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # Bounding box normalised to [0, 1] relative to the image width/height.
    bbox_x1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y1: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_x2: Mapped[float] = mapped_column(Float, nullable=False)
    bbox_y2: Mapped[float] = mapped_column(Float, nullable=False)
    det_score: Mapped[float] = mapped_column(Float, nullable=False)
    embedding = mapped_column(EmbeddingType(512), nullable=False)
    model_name: Mapped[str] = mapped_column(String(50), default="buffalo_l", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    photo: Mapped[Photo] = relationship(back_populates="faces")

    __table_args__ = (
        UniqueConstraint("photo_id", "face_index", name="uq_faces_photo_index"),
        Index("ix_faces_event", "event_id"),
        Index("ix_faces_photo", "photo_id"),
    )


class ProcessingJob(Base):
    """One row per processing attempt of a photo (audit trail + failure diagnostics)."""

    __tablename__ = "processing_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), default="index_photo", nullable=False)
    task_id: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "job_status"), default=JobStatus.queued,
                                              nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_jobs_photo_created", "photo_id", "created_at"),
        Index("ix_jobs_event_status", "event_id", "status"),
    )

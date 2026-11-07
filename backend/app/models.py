"""SQLAlchemy ORM models."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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
    return Enum(e, name=name, native_enum=False, length=20, validate_strings=True, create_constraint=False)


class Event(TimestampMixin, Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Unguessable public identifier used in guest URLs / QR codes.
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    event_date: Mapped[date | None] = mapped_column(Date)
    venue: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    cover_key: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[EventStatus] = mapped_column(_enum(EventStatus, "event_status"), default=EventStatus.active,
                                                nullable=False)
    # Optional: the guest link / QR code stops working at this time. NULL = no expiry.
    guest_link_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    photos: Mapped[list[Photo]] = relationship(back_populates="event", passive_deletes=True)
    event_photos: Mapped[list[EventPhoto]] = relationship(back_populates="event", passive_deletes=True)

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
    r2_preview_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    r2_thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    r2_original_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
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


class EventPhoto(TimestampMixin, Base):
    __tablename__ = "event_photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    r2_preview_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    r2_thumbnail_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    r2_original_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    event: Mapped[Event] = relationship(back_populates="event_photos")
    faces: Mapped[list[FaceEmbedding]] = relationship(
        primaryjoin="foreign(FaceEmbedding.photo_id) == EventPhoto.id",
        cascade="all, delete-orphan",
        overlaps="photo,faces",
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
    model_name: Mapped[str] = mapped_column(String(50), default="buffalo_sc", nullable=False)
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


class WatermarkTemplateKind(str, enum.Enum):
    wedding = "wedding"
    birthday = "birthday"
    corporate = "corporate"
    custom = "custom"


class WatermarkPosition(str, enum.Enum):
    top_left = "top_left"
    top_center = "top_center"
    top_right = "top_right"
    center = "center"
    bottom_left = "bottom_left"
    bottom_center = "bottom_center"
    bottom_right = "bottom_right"


class WatermarkJobVariant(str, enum.Enum):
    guest_preview = "guest_preview"
    guest_download = "guest_download"


class WatermarkTemplate(TimestampMixin, Base):
    __tablename__ = "watermark_templates"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[WatermarkTemplateKind] = mapped_column(
        _enum(WatermarkTemplateKind, "watermark_template_kind"),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text)
    default_logo_key: Mapped[str | None] = mapped_column(String(500))
    default_watermark_text: Mapped[str | None] = mapped_column(Text)
    default_position: Mapped[WatermarkPosition] = mapped_column(
        _enum(WatermarkPosition, "watermark_position"),
        default=WatermarkPosition.bottom_right,
        nullable=False,
    )
    default_opacity: Mapped[Decimal] = mapped_column(Numeric(4, 3), default=Decimal("0.200"), nullable=False)
    default_size_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("20.00"), nullable=False)
    is_shared: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    event_configs: Mapped[list["EventWatermarkConfig"]] = relationship(
        back_populates="template",
        passive_deletes=True,
    )

    __table_args__ = (
        UniqueConstraint("slug", name="uq_watermark_templates_slug"),
        Index("ix_watermark_templates_kind_active", "kind", "is_active"),
        CheckConstraint("NOT (default_logo_key IS NULL AND default_watermark_text IS NULL)", name="ck_watermark_templates_has_logo_or_text"),
    )


class EventWatermarkConfig(TimestampMixin, Base):
    __tablename__ = "event_watermark_configs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("watermark_templates.id", ondelete="RESTRICT"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    template_slug: Mapped[str] = mapped_column(String(100), nullable=False)
    template_name: Mapped[str] = mapped_column(String(200), nullable=False)
    template_kind: Mapped[WatermarkTemplateKind] = mapped_column(
        _enum(WatermarkTemplateKind, "watermark_template_kind"),
        nullable=False,
    )
    resolved_logo_key: Mapped[str | None] = mapped_column(String(500))
    resolved_watermark_text: Mapped[str | None] = mapped_column(Text)
    resolved_position: Mapped[WatermarkPosition] = mapped_column(
        _enum(WatermarkPosition, "watermark_position"),
        nullable=False,
    )
    resolved_opacity: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)
    resolved_size_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    template: Mapped[WatermarkTemplate | None] = relationship(back_populates="event_configs")
    captures: Mapped[list["PhotoWatermarkCapture"]] = relationship(back_populates="config", passive_deletes=True)
    jobs: Mapped[list["PhotoWatermarkJob"]] = relationship(back_populates="config", passive_deletes=True)
    derivatives: Mapped[list["PhotoWatermarkDerivative"]] = relationship(back_populates="config", passive_deletes=True)

    __table_args__ = (
        UniqueConstraint("event_id", "id", name="uq_event_watermark_configs_event_id"),
        UniqueConstraint("event_id", "version", name="uq_event_watermark_configs_event_version"),
        Index("ix_event_watermark_configs_event_version", "event_id", "version"),
        CheckConstraint("version > 0", name="ck_event_watermark_configs_version_positive"),
        CheckConstraint(
            "NOT (enabled = TRUE AND resolved_logo_key IS NULL AND resolved_watermark_text IS NULL)",
            name="ck_event_watermark_configs_enabled_requires_logo_or_text",
        ),
    )


class PhotoWatermarkCapture(TimestampMixin, Base):
    __tablename__ = "photo_watermark_captures"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("event_watermark_configs.id", ondelete="CASCADE"),
        nullable=False,
    )

    photo: Mapped[Photo] = relationship()
    config: Mapped[EventWatermarkConfig] = relationship(back_populates="captures")

    __table_args__ = (
        UniqueConstraint("photo_id", name="uq_photo_watermark_captures_photo"),
        Index("ix_photo_watermark_captures_event", "event_id"),
        Index("ix_photo_watermark_captures_config", "config_id"),
    )


class PhotoWatermarkJob(TimestampMixin, Base):
    __tablename__ = "photo_watermark_jobs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("event_watermark_configs.id", ondelete="CASCADE"),
        nullable=False,
    )
    variant: Mapped[WatermarkJobVariant] = mapped_column(
        _enum(WatermarkJobVariant, "watermark_job_variant"),
        nullable=False,
    )
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "job_status"), default=JobStatus.queued, nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_token: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worker_id: Mapped[str | None] = mapped_column(String(128))
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    photo: Mapped[Photo] = relationship()
    config: Mapped[EventWatermarkConfig] = relationship(back_populates="jobs")

    __table_args__ = (
        UniqueConstraint("event_id", "photo_id", "config_id", "variant", name="uq_photo_watermark_jobs_event_photo_config_variant"),
        Index("ix_photo_watermark_jobs_event_status", "event_id", "status"),
        Index("ix_photo_watermark_jobs_next_attempt", "status", "next_attempt_at"),
        CheckConstraint("attempt >= 0", name="ck_photo_watermark_jobs_attempt_nonnegative"),
        CheckConstraint("max_attempts > 0", name="ck_photo_watermark_jobs_max_attempts_positive"),
        CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed')",
            name="ck_photo_watermark_jobs_status",
        ),
        CheckConstraint(
            "variant IN ('guest_preview', 'guest_download')",
            name="ck_photo_watermark_jobs_variant",
        ),
    )


class PhotoWatermarkDerivative(TimestampMixin, Base):
    __tablename__ = "photo_watermark_derivatives"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    photo_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    config_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("event_watermark_configs.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("photo_watermark_jobs.id", ondelete="SET NULL"))
    variant: Mapped[WatermarkJobVariant] = mapped_column(
        _enum(WatermarkJobVariant, "watermark_job_variant"),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)

    photo: Mapped[Photo] = relationship()
    config: Mapped[EventWatermarkConfig] = relationship(back_populates="derivatives")
    job: Mapped[PhotoWatermarkJob | None] = relationship()

    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_photo_watermark_derivatives_storage_key"),
        UniqueConstraint("event_id", "photo_id", "config_id", "variant", name="uq_photo_watermark_derivatives_event_photo_config_variant"),
        Index("ix_photo_watermark_derivatives_event_variant", "event_id", "variant"),
        CheckConstraint(
            "variant IN ('guest_preview', 'guest_download')",
            name="ck_photo_watermark_derivatives_variant",
        ),
    )

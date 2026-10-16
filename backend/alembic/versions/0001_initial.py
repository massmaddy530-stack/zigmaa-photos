"""Initial schema: events, photos, face_embeddings (pgvector), processing_jobs.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def _enum_check(column: str, values: list[str]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    # Requires the pgvector extension to be installed on the server (see README).
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("event_date", sa.Date()),
        sa.Column("venue", sa.String(300)),
        sa.Column("description", sa.Text()),
        sa.Column("cover_key", sa.String(500)),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_events_slug"),
        sa.CheckConstraint(_enum_check("status", ["active", "archived"]), name="ck_events_status"),
    )
    op.create_index("ix_events_status_created", "events", ["status", "created_at"])

    op.create_table(
        "photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("original_key", sa.String(500), nullable=False),
        sa.Column("thumbnail_key", sa.String(500)),
        sa.Column("preview_key", sa.String(500)),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("face_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text()),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("source", sa.String(20), nullable=False, server_default="dashboard"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "content_hash", name="uq_photos_event_hash"),
        sa.CheckConstraint(_enum_check("status", ["pending", "processing", "indexed", "failed"]),
                           name="ck_photos_status"),
    )
    op.create_index("ix_photos_event_created", "photos", ["event_id", "created_at"])
    op.create_index("ix_photos_event_status", "photos", ["event_id", "status"])

    op.create_table(
        "face_embeddings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("photo_id", sa.Uuid(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("face_index", sa.Integer(), nullable=False),
        sa.Column("bbox_x1", sa.Float(), nullable=False),
        sa.Column("bbox_y1", sa.Float(), nullable=False),
        sa.Column("bbox_x2", sa.Float(), nullable=False),
        sa.Column("bbox_y2", sa.Float(), nullable=False),
        sa.Column("det_score", sa.Float(), nullable=False),
        sa.Column("embedding", Vector(512), nullable=False),
        sa.Column("model_name", sa.String(50), nullable=False, server_default="buffalo_l"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("photo_id", "face_index", name="uq_faces_photo_index"),
    )
    op.create_index("ix_faces_event", "face_embeddings", ["event_id"])
    op.create_index("ix_faces_photo", "face_embeddings", ["photo_id"])
    # Approximate nearest-neighbour index for cosine distance. Event-scoped queries combine it with the
    # event_id filter (pgvector >= 0.8 iterative scans avoid under-filled results).
    op.execute(
        "CREATE INDEX ix_faces_embedding_hnsw ON face_embeddings "
        "USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)"
    )

    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("photo_id", sa.Uuid(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False, server_default="index_photo"),
        sa.Column("task_id", sa.String(100)),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(_enum_check("status", ["queued", "running", "succeeded", "failed"]),
                           name="ck_jobs_status"),
    )
    op.create_index("ix_jobs_photo_created", "processing_jobs", ["photo_id", "created_at"])
    op.create_index("ix_jobs_event_status", "processing_jobs", ["event_id", "status"])


def downgrade() -> None:
    op.drop_table("processing_jobs")
    op.drop_index("ix_faces_embedding_hnsw", table_name="face_embeddings")
    op.drop_table("face_embeddings")
    op.drop_table("photos")
    op.drop_table("events")
    # The vector extension is intentionally left installed (other databases objects may use it).

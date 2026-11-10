"""Add event title, photo R2 URLs, and event_photos table.

Revision ID: 0004_event_title_and_r2_urls
Revises: 0003_watermark_templates
Create Date: 2026-11-07
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_event_title_and_r2_urls"
down_revision = "0003_watermark_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("title", sa.String(200), nullable=True))
    op.add_column("photos", sa.Column("r2_preview_url", sa.String(1000), nullable=True))
    op.add_column("photos", sa.Column("r2_thumbnail_url", sa.String(1000), nullable=True))
    op.add_column("photos", sa.Column("r2_original_url", sa.String(1000), nullable=True))

    op.create_table(
        "event_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("r2_preview_url", sa.String(1000), nullable=True),
        sa.Column("r2_thumbnail_url", sa.String(1000), nullable=True),
        sa.Column("r2_original_url", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_event_photos_event_created", "event_photos", ["event_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_event_photos_event_created", "event_photos")
    op.drop_table("event_photos")
    op.drop_column("photos", "r2_original_url")
    op.drop_column("photos", "r2_thumbnail_url")
    op.drop_column("photos", "r2_preview_url")
    op.drop_column("events", "title")


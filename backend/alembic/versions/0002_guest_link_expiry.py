"""Optional expiry for an event's guest link / QR code.

Additive and backward compatible: one nullable column; existing events get NULL (= never expires), and code
without this column keeps working against the upgraded schema.

Revision ID: 0002_guest_link_expiry
Revises: 0001_initial
Create Date: 2026-10-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_guest_link_expiry"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("guest_link_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "guest_link_expires_at")

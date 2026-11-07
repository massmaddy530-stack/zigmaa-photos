"""Add watermark template snapshots, event config versions, captures, jobs, and derivatives.

Revision ID: 0003_watermark_templates
Revises: 0002_guest_link_expiry
Create Date: 2026-10-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_watermark_templates"
down_revision = "0002_guest_link_expiry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watermark_templates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(100), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("default_logo_key", sa.String(500)),
        sa.Column("default_watermark_text", sa.Text()),
        sa.Column("default_position", sa.String(20), nullable=False, server_default="bottom_right"),
        sa.Column("default_opacity", sa.Numeric(precision=4, scale=3), nullable=False, server_default="0.200"),
        sa.Column("default_size_percent", sa.Numeric(precision=5, scale=2), nullable=False, server_default="20.00"),
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slug", name="uq_watermark_templates_slug"),
        sa.CheckConstraint("NOT (default_logo_key IS NULL AND default_watermark_text IS NULL)", name="ck_watermark_templates_has_logo_or_text"),
        sa.CheckConstraint("kind IN ('wedding', 'birthday', 'corporate', 'custom')", name="ck_watermark_templates_kind"),
        sa.CheckConstraint(
            "default_position IN ('top_left', 'top_center', 'top_right', 'center', 'bottom_left', 'bottom_center', 'bottom_right')",
            name="ck_watermark_templates_position",
        ),
    )
    op.create_index("ix_watermark_templates_kind_active", "watermark_templates", ["kind", "is_active"])

    op.create_table(
        "event_watermark_configs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("template_id", sa.Uuid(), sa.ForeignKey("watermark_templates.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("template_slug", sa.String(100), nullable=False),
        sa.Column("template_name", sa.String(200), nullable=False),
        sa.Column("template_kind", sa.String(20), nullable=False),
        sa.Column("resolved_logo_key", sa.String(500)),
        sa.Column("resolved_watermark_text", sa.Text()),
        sa.Column("resolved_position", sa.String(20), nullable=False),
        sa.Column("resolved_opacity", sa.Numeric(precision=4, scale=3), nullable=False),
        sa.Column("resolved_size_percent", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "id", name="uq_event_watermark_configs_event_id"),
        sa.UniqueConstraint("event_id", "version", name="uq_event_watermark_configs_event_version"),
        sa.CheckConstraint("version > 0", name="ck_event_watermark_configs_version_positive"),
        sa.CheckConstraint("template_kind IN ('wedding', 'birthday', 'corporate', 'custom')", name="ck_event_watermark_configs_template_kind"),
        sa.CheckConstraint(
            "resolved_position IN ('top_left', 'top_center', 'top_right', 'center', 'bottom_left', 'bottom_center', 'bottom_right')",
            name="ck_event_watermark_configs_position",
        ),
        sa.CheckConstraint(
            "NOT (enabled = TRUE AND resolved_logo_key IS NULL AND resolved_watermark_text IS NULL)",
            name="ck_event_watermark_configs_enabled_requires_logo_or_text",
        ),
    )
    op.create_index("ix_event_watermark_configs_event_version", "event_watermark_configs", ["event_id", "version"])

    op.create_table(
        "photo_watermark_captures",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("photo_id", sa.Uuid(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("config_id", sa.Uuid(), sa.ForeignKey("event_watermark_configs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("photo_id", name="uq_photo_watermark_captures_photo"),
    )
    op.create_index("ix_photo_watermark_captures_event", "photo_watermark_captures", ["event_id"])
    op.create_index("ix_photo_watermark_captures_config", "photo_watermark_captures", ["config_id"])

    op.create_table(
        "photo_watermark_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("photo_id", sa.Uuid(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("config_id", sa.Uuid(), sa.ForeignKey("event_watermark_configs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("variant", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("lease_token", sa.Uuid()),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("worker_id", sa.String(128)),
        sa.Column("error_message", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("duration_ms", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "photo_id", "config_id", "variant", name="uq_photo_watermark_jobs_event_photo_config_variant"),
        sa.CheckConstraint("attempt >= 0", name="ck_photo_watermark_jobs_attempt_nonnegative"),
        sa.CheckConstraint("max_attempts > 0", name="ck_photo_watermark_jobs_max_attempts_positive"),
        sa.CheckConstraint("status IN ('queued', 'running', 'succeeded', 'failed')", name="ck_photo_watermark_jobs_status"),
        sa.CheckConstraint("variant IN ('guest_preview', 'guest_download')", name="ck_photo_watermark_jobs_variant"),
    )
    op.create_index("ix_photo_watermark_jobs_event_status", "photo_watermark_jobs", ["event_id", "status"])
    op.create_index("ix_photo_watermark_jobs_next_attempt", "photo_watermark_jobs", ["status", "next_attempt_at"])

    op.create_table(
        "photo_watermark_derivatives",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("photo_id", sa.Uuid(), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("config_id", sa.Uuid(), sa.ForeignKey("event_watermark_configs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("photo_watermark_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("variant", sa.String(20), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("size_bytes", sa.BigInteger()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("storage_key", name="uq_photo_watermark_derivatives_storage_key"),
        sa.UniqueConstraint("event_id", "photo_id", "config_id", "variant", name="uq_photo_watermark_derivatives_event_photo_config_variant"),
        sa.CheckConstraint("variant IN ('guest_preview', 'guest_download')", name="ck_photo_watermark_derivatives_variant"),
    )
    op.create_index("ix_photo_watermark_derivatives_event_variant", "photo_watermark_derivatives", ["event_id", "variant"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_event_watermark_config_snapshot_change()
        RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                -- PostgreSQL removes the parent events row before the cascade trigger
                -- fires here. A missing event means this is a cascade-initiated delete,
                -- not a direct application delete.
                IF NOT EXISTS (SELECT 1 FROM events WHERE id = OLD.event_id) THEN
                    RETURN OLD;
                END IF;
                RAISE EXCEPTION 'event_watermark_configs snapshot rows are immutable';
            END IF;
            RAISE EXCEPTION 'event_watermark_configs snapshot rows are immutable';
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_event_watermark_configs_immutable
        BEFORE UPDATE OR DELETE ON event_watermark_configs
        FOR EACH ROW EXECUTE FUNCTION prevent_event_watermark_config_snapshot_change();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_watermark_record_event_consistency()
        RETURNS trigger AS $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM photos p
                WHERE p.id = NEW.photo_id
                  AND p.event_id <> NEW.event_id
            ) THEN
                RAISE EXCEPTION 'photo event mismatch for watermark record';
            END IF;

            IF EXISTS (
                SELECT 1
                FROM event_watermark_configs c
                WHERE c.id = NEW.config_id
                  AND c.event_id <> NEW.event_id
            ) THEN
                RAISE EXCEPTION 'config event mismatch for watermark record';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_photo_watermark_captures_event_consistency
        BEFORE INSERT OR UPDATE OF event_id, photo_id, config_id ON photo_watermark_captures
        FOR EACH ROW EXECUTE FUNCTION validate_watermark_record_event_consistency();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_photo_watermark_jobs_event_consistency
        BEFORE INSERT OR UPDATE OF event_id, photo_id, config_id ON photo_watermark_jobs
        FOR EACH ROW EXECUTE FUNCTION validate_watermark_record_event_consistency();
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_photo_watermark_derivatives_event_consistency
        BEFORE INSERT OR UPDATE OF event_id, photo_id, config_id ON photo_watermark_derivatives
        FOR EACH ROW EXECUTE FUNCTION validate_watermark_record_event_consistency();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION validate_watermark_derivative_job_consistency()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.job_id IS NOT NULL THEN
                IF NOT EXISTS (
                    SELECT 1
                    FROM photo_watermark_jobs j
                    WHERE j.id = NEW.job_id
                      AND j.event_id = NEW.event_id
                      AND j.photo_id = NEW.photo_id
                      AND j.config_id = NEW.config_id
                      AND j.variant = NEW.variant
                ) THEN
                    RAISE EXCEPTION 'job mismatch for watermark derivative';
                END IF;
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_photo_watermark_derivatives_job_consistency
        BEFORE INSERT OR UPDATE OF event_id, photo_id, config_id, job_id, variant ON photo_watermark_derivatives
        FOR EACH ROW EXECUTE FUNCTION validate_watermark_derivative_job_consistency();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_photo_watermark_derivatives_job_consistency ON photo_watermark_derivatives")
    op.execute("DROP TRIGGER IF EXISTS trg_photo_watermark_derivatives_event_consistency ON photo_watermark_derivatives")
    op.execute("DROP TRIGGER IF EXISTS trg_photo_watermark_jobs_event_consistency ON photo_watermark_jobs")
    op.execute("DROP TRIGGER IF EXISTS trg_photo_watermark_captures_event_consistency ON photo_watermark_captures")
    op.execute("DROP TRIGGER IF EXISTS trg_event_watermark_configs_immutable ON event_watermark_configs")
    op.execute("DROP FUNCTION IF EXISTS validate_watermark_derivative_job_consistency()")
    op.execute("DROP FUNCTION IF EXISTS validate_watermark_record_event_consistency()")
    op.execute("DROP FUNCTION IF EXISTS prevent_event_watermark_config_snapshot_change()")
    op.drop_table("photo_watermark_derivatives")
    op.drop_table("photo_watermark_jobs")
    op.drop_table("photo_watermark_captures")
    op.drop_table("event_watermark_configs")
    op.drop_table("watermark_templates")

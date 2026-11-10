"""Application settings loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

BACKEND_DIR = Path(__file__).resolve().parents[2]


def async_database_url(url: str) -> str:
    """Use the asyncpg driver for plain PostgreSQL URLs (hosts such as Render provide ``postgresql://`` or
    ``postgres://``) and translate libpq's ``sslmode`` to asyncpg's ``ssl``. Credentials and other query
    parameters are kept; other URLs are returned unchanged. Error messages never include the URL."""
    try:
        u = make_url(url)
    except Exception:
        raise ValueError("DATABASE_URL is not a valid database URL") from None
    if u.drivername in ("postgres", "postgresql"):
        u = u.set(drivername="postgresql+asyncpg")
    elif u.drivername != "postgresql+asyncpg" or "sslmode" not in u.query:
        return url
    if "sslmode" in u.query:
        query = dict(u.query)
        sslmode = query.pop("sslmode")
        query.setdefault("ssl", sslmode)
        u = u.set(query=query)
    return u.render_as_string(hide_password=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,  # validation errors must not echo DATABASE_URL or other secrets into logs
    )

    # --- General -----------------------------------------------------------
    port: int = 10000
    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "Event Photo Platform"
    log_level: str = "INFO"
    log_json: bool = True
    public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:3000"
    # NoDecode: accept comma-separated env values (pydantic-settings would otherwise require JSON).
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://zigmaa-photos.vercel.app", "http://localhost:3000"]
    )
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["https://zigmaa-photos.vercel.app", "http://localhost:3000"]
    )

    # --- Auth ----------------------------------------------------------------
    # Admin key: full access to dashboard endpoints. Ingest key: upload-only (camera agent).
    admin_api_key: SecretStr | None = None
    ingest_api_key: SecretStr | None = None
    # Secret used to sign local media URLs. Must be long and random in production.
    signing_secret: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")

    # --- Database ------------------------------------------------------------
    database_url: str = "postgresql+asyncpg://eventphoto:eventphoto@localhost:5432/eventphoto"
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_echo: bool = False

    # --- Redis / Celery ------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"
    # "celery": tasks go to Redis and run in a Celery worker (production).
    # "thread": tasks run in a background thread pool inside the API process (dev without Redis).
    # "sync":   tasks run inline before the request returns (tests only).
    task_mode: Literal["celery", "thread", "sync"] = "celery"
    task_max_retries: int = 3
    task_retry_backoff_s: float = 10.0
    thread_workers: int = 1
    task_soft_time_limit_s: int = 240
    task_time_limit_s: int = 300

    # --- Storage -------------------------------------------------------------
    storage_backend: Literal["local", "r2", "supabase"] = "local"
    local_storage_dir: Path = BACKEND_DIR / "data" / "storage"
    r2_account_id: str | None = None
    r2_access_key_id: SecretStr | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_bucket: str | None = None
    r2_bucket_name: str | None = None
    r2_public_url: str | None = None
    r2_endpoint_url: str | None = None  # defaults to https://<account>.r2.cloudflarestorage.com
    # Supabase Storage via its S3-compatible API. The S3 access keys bypass RLS: keep them server-side only.
    supabase_project_ref: str | None = None
    supabase_s3_endpoint: str | None = None  # defaults to https://<project_ref>.storage.supabase.co/storage/v1/s3
    supabase_s3_region: str | None = None
    supabase_s3_access_key_id: SecretStr | None = None
    supabase_s3_secret_access_key: SecretStr | None = None
    supabase_storage_bucket: str | None = None
    signed_url_ttl_s: int = 900

    # --- Upload limits -------------------------------------------------------
    max_upload_bytes: int = 40 * 1024 * 1024
    max_files_per_request: int = 50
    max_image_pixels: int = 80_000_000  # decompression-bomb guard
    selfie_max_bytes: int = 8 * 1024 * 1024
    allowed_image_formats: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["JPEG", "PNG", "WEBP"])

    # --- Derivatives ---------------------------------------------------------
    thumbnail_max_px: int = 400
    thumbnail_quality: int = 75
    preview_max_width: int = 1920
    preview_max_height: int = 1080
    preview_quality: int = 82

    # --- Face analysis -------------------------------------------------------
    # false: photos still get thumbnails/previews and are marked indexed with no faces; face detection,
    # embeddings and selfie matching are skipped and the model runtime is never loaded.
    face_analysis_enabled: bool = True
    face_model_name: str = "buffalo_sc"
    face_model_dir: Path = BACKEND_DIR / "models" / "buffalo_sc"
    face_det_size: int = 320
    face_det_threshold: float = 0.5
    face_min_size_px: int = 24
    face_analysis_max_side: int = 1024
    onnx_intra_op_threads: int = 2
    hf_model_repo: str | None = None
    hf_model_token: SecretStr | None = None
    hf_model_revision: str = "main"
    # Cosine similarity threshold for a match. NOT a calibrated value: measure on your own data.
    match_similarity_threshold: float = 0.40
    match_max_results: int = 500
    match_candidate_faces: int = 2000
    match_session_ttl_s: int = 900
    selfie_require_single_face: bool = True
    pgvector_iterative_scan: bool = True
    pgvector_ef_search: int = 100

    # --- Rate limiting -------------------------------------------------------
    rate_limit_backend: Literal["memory", "redis"] = "memory"
    match_rate_limit: int = 10
    match_rate_window_s: int = 60
    trust_proxy_headers: bool = False

    @field_validator("cors_origins", "allowed_origins", "allowed_image_formats", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            if v.strip().startswith("["):
                return json.loads(v)
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @model_validator(mode="before")
    @classmethod
    def _sync_aliases(cls, data: object) -> object:
        if isinstance(data, dict):
            bucket = data.get("r2_bucket") or data.get("R2_BUCKET") or data.get("r2_bucket_name") or data.get("R2_BUCKET_NAME")
            if bucket:
                data.setdefault("r2_bucket", bucket)
                data.setdefault("r2_bucket_name", bucket)
                has_key = data.get("r2_access_key_id") or data.get("R2_ACCESS_KEY_ID")
                backend = data.get("storage_backend") or data.get("STORAGE_BACKEND")
                if has_key and not backend:
                    data["storage_backend"] = "r2"
            allowed = data.get("allowed_origins") or data.get("ALLOWED_ORIGINS")
            if allowed and "cors_origins" not in data and "CORS_ORIGINS" not in data:
                data["cors_origins"] = allowed
        return data

    @field_validator("r2_account_id", mode="before")
    @classmethod
    def _strip_account_id(cls, v: object) -> object:
        if isinstance(v, str):
            return v.strip().strip('"').strip("'")
        return v

    @field_validator("r2_public_url", mode="before")
    @classmethod
    def _sanitize_r2_public_url(cls, v: object) -> object:
        if isinstance(v, str) and v.strip():
            url = v.strip().rstrip("/").strip('"').strip("'")
            if not url.startswith("http://") and not url.startswith("https://"):
                url = f"https://{url}"
            return url
        return v

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, v: str) -> str:
        return async_database_url(v)

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.environment == "production":
            secret = self.signing_secret.get_secret_value()
            if secret.startswith("dev-only") or len(secret) < 32:
                raise ValueError("SIGNING_SECRET must be a random value of at least 32 characters in production")
            if not self.admin_api_key or len(self.admin_api_key.get_secret_value()) < 24:
                raise ValueError("ADMIN_API_KEY must be set (24+ chars) in production")
            if "*" in self.cors_origins:
                raise ValueError("Wildcard CORS origins are not allowed in production")
            if self.storage_backend == "supabase" and self.supabase_missing_settings:
                raise ValueError("Supabase storage selected but missing settings: "
                                 + ", ".join(self.supabase_missing_settings))
        return self

    @property
    def r2_endpoint(self) -> str | None:
        if self.r2_endpoint_url:
            url = self.r2_endpoint_url.strip().strip('"').strip("'")
            if not url.startswith("http://") and not url.startswith("https://"):
                url = f"https://{url}"
            return url.rstrip("/")
        if self.r2_account_id:
            acct = self.r2_account_id.strip().strip('"').strip("'")
            if acct.startswith("http://") or acct.startswith("https://"):
                return acct.rstrip("/")
            if ".r2.cloudflarestorage.com" in acct:
                return f"https://{acct.rstrip('/')}"
            return f"https://{acct}.r2.cloudflarestorage.com"
        return None

    @property
    def supabase_endpoint(self) -> str | None:
        if self.supabase_s3_endpoint:
            return self.supabase_s3_endpoint.rstrip("/")
        if self.supabase_project_ref:
            return f"https://{self.supabase_project_ref}.storage.supabase.co/storage/v1/s3"
        return None

    @property
    def supabase_missing_settings(self) -> list[str]:
        """Names (never values) of the Supabase storage settings that are not set."""
        return [name for name, value in {
            "SUPABASE_S3_ENDPOINT or SUPABASE_PROJECT_REF": self.supabase_endpoint,
            "SUPABASE_S3_REGION": self.supabase_s3_region,
            "SUPABASE_S3_ACCESS_KEY_ID": self.supabase_s3_access_key_id,
            "SUPABASE_S3_SECRET_ACCESS_KEY": self.supabase_s3_secret_access_key,
            "SUPABASE_STORAGE_BUCKET": self.supabase_storage_bucket,
        }.items() if not value]

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")


@lru_cache
def get_settings() -> Settings:
    return Settings()

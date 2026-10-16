"""Application settings loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- General -----------------------------------------------------------
    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "Event Photo Platform"
    log_level: str = "INFO"
    log_json: bool = True
    public_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:3000"
    # NoDecode: accept comma-separated env values (pydantic-settings would otherwise require JSON).
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])

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
    storage_backend: Literal["local", "r2"] = "local"
    local_storage_dir: Path = BACKEND_DIR / "data" / "storage"
    r2_account_id: str | None = None
    r2_access_key_id: SecretStr | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_bucket: str | None = None
    r2_endpoint_url: str | None = None  # defaults to https://<account>.r2.cloudflarestorage.com
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
    face_model_dir: Path = BACKEND_DIR / "models" / "buffalo_l"
    face_det_size: int = 640
    face_det_threshold: float = 0.5
    face_min_size_px: int = 24
    face_analysis_max_side: int = 1920
    onnx_intra_op_threads: int = 2
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

    @field_validator("cors_origins", "allowed_image_formats", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            if v.strip().startswith("["):
                return json.loads(v)
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

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
        return self

    @property
    def r2_endpoint(self) -> str | None:
        if self.r2_endpoint_url:
            return self.r2_endpoint_url
        if self.r2_account_id:
            return f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        return None

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")


@lru_cache
def get_settings() -> Settings:
    return Settings()

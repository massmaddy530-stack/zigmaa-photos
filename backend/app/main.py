
"""FastAPI application factory."""

from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text

from app import __version__
from app.api import events, match, photos
from app.core.config import get_settings
from app.core.errors import error_body, install_error_handlers
from app.core.logging import configure_logging
from app.db.session import dispose_engine, get_sessionmaker
from app.schemas import HealthOut
from app.services.face.engine import analyzer_available
from app.services.storage import LocalStorage, get_storage, verify_media_signature

logger = logging.getLogger(__name__)

# Explicit map: the Windows mimetypes registry often lacks .webp
_MEDIA_TYPES = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".png": "image/png",
}


class BodySizeLimitMiddleware:
    """Reject request bodies over a per-route limit before they are spooled to disk."""

    def __init__(
        self,
        app,
        upload_limit: int,
        selfie_limit: int,
        default_limit: int = 1024 * 1024,
    ) -> None:
        self.app = app
        self.upload_limit = upload_limit
        self.selfie_limit = selfie_limit
        self.default_limit = default_limit

    def _limit_for(self, path: str) -> int:
        if path.endswith("/photos") or path.endswith("/cover"):
            return self.upload_limit
        if path.endswith("/match"):
            return self.selfie_limit
        return self.default_limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in (
            "GET",
            "HEAD",
            "OPTIONS",
        ):
            return await self.app(scope, receive, send)

        limit = self._limit_for(scope["path"])
        headers = dict(scope.get("headers") or [])
        declared = headers.get(b"content-length")

        if declared and declared.isdigit() and int(declared) > limit:
            return await self._reject(send, limit)

        received = 0

        async def limited_receive():
            nonlocal received

            message = await receive()

            if message["type"] == "http.request":
                received += len(message.get("body", b""))

                if received > limit:
                    raise _BodyTooLarge()

            return message

        try:
            await self.app(scope, limited_receive, send)
        except _BodyTooLarge:
            await self._reject(send, limit)

    @staticmethod
    async def _reject(send, limit: int) -> None:
        resp = JSONResponse(
            error_body(
                "payload_too_large",
                f"Request body exceeds {limit // (1024 * 1024)} MB",
            ),
            status_code=413,
        )

        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": resp.raw_headers,
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": resp.body,
            }
        )


class _BodyTooLarge(Exception):
    pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    logger.info(
        "Starting %s (env=%s, storage=%s, tasks=%s)",
        settings.app_name,
        settings.environment,
        settings.storage_backend,
        settings.task_mode,
    )

    if not settings.face_analysis_enabled:
        logger.info("Face analysis disabled (FACE_ANALYSIS_ENABLED=false): photos get previews only; matching is off")
    elif not analyzer_available():
        logger.warning(
            "Face model files not found in %s; indexing and matching "
            "will fail until installed",
            settings.face_model_dir,
        )

    yield

    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=__version__,
        description=(
            "AI event photo distribution: events, uploads, "
            "face indexing and guest selfie matching."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    install_error_handlers(app)

    app.add_middleware(
        BodySizeLimitMiddleware,
        upload_limit=(
            settings.max_upload_bytes * settings.max_files_per_request
            + 1024 * 1024
        ),
        selfie_limit=settings.selfie_max_bytes + 256 * 1024,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "X-API-Key", "Content-Type"],
        max_age=600,
    )

    app.include_router(events.router)
    app.include_router(photos.router)
    app.include_router(match.admin_router)
    app.include_router(match.public_router)

    @app.get("/health", response_model=HealthOut, tags=["health"])
    async def health() -> JSONResponse:
        checks: dict[str, str] = {}

        try:
            async with get_sessionmaker()() as session:
                await session.execute(text("SELECT 1"))

            checks["database"] = "ok"

        except Exception as exc:
            checks["database"] = f"error: {type(exc).__name__}"

        checks["face_model"] = (
            "disabled" if not settings.face_analysis_enabled
            else "ok" if analyzer_available() else "missing"
        )
        checks["storage"] = settings.storage_backend
        checks["task_mode"] = settings.task_mode

        if settings.task_mode == "celery":
            try:
                import redis.asyncio as aioredis

                r = aioredis.from_url(
                    settings.redis_url,
                    socket_connect_timeout=1,
                    socket_timeout=1,
                )

                await r.ping()
                await r.aclose()

                checks["redis"] = "ok"

            except Exception as exc:
                checks["redis"] = f"error: {type(exc).__name__}"

        healthy = (
            checks["database"] == "ok"
            and checks.get("redis", "ok") == "ok"
        )

        body = HealthOut(
            status="ok" if healthy else "degraded",
            version=__version__,
            checks=checks,
        )

        return JSONResponse(
            body.model_dump(),
            status_code=200 if healthy else 503,
        )

    @app.get("/media/{key:path}", include_in_schema=False)
    async def media(
        key: str,
        exp: int = Query(...),
        sig: str = Query(..., max_length=100),
    ):
        """Serve locally-stored objects behind signed, expiring URLs."""

        storage = get_storage()

        if not isinstance(storage, LocalStorage):
            return JSONResponse(
                error_body("not_found", "Not found"),
                status_code=404,
            )

        if not verify_media_signature(
            key,
            exp,
            sig,
            settings.signing_secret.get_secret_value(),
        ):
            return JSONResponse(
                error_body("forbidden", "Link expired or invalid"),
                status_code=403,
            )

        try:
            path = storage.path_for(key)

        except ValueError:
            return JSONResponse(
                error_body("not_found", "Not found"),
                status_code=404,
            )

        if not path.is_file():
            return JSONResponse(
                error_body("not_found", "Not found"),
                status_code=404,
            )

        media_type = (
            _MEDIA_TYPES.get(path.suffix.lower())
            or mimetypes.guess_type(path.name)[0]
            or "application/octet-stream"
        )

        return FileResponse(
            path,
            media_type=media_type,
            headers={
                "Cache-Control": "private, max-age=600",
                "X-Content-Type-Options": "nosniff",
            },
        )

    # OpenAPI compatibility fix:
    # Represent uploaded files as binary so Swagger UI can render
    # a file picker instead of a text input.
    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema

        schema = get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )

        def fix_file_schema(node):
            if isinstance(node, dict):
                if node.get("contentMediaType") == "application/octet-stream":
                    node.pop("contentMediaType", None)
                    node["format"] = "binary"

                for value in node.values():
                    fix_file_schema(value)

            elif isinstance(node, list):
                for item in node:
                    fix_file_schema(item)

        fix_file_schema(schema)

        app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = custom_openapi

    return app


app = create_app()

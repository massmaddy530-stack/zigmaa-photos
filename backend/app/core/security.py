"""API-key authentication for the dashboard (admin) and the ingestion agent (upload-only)."""

from __future__ import annotations

import enum
import hmac

from fastapi import Depends, Request
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.errors import ForbiddenError, ServiceUnavailableError, UnauthorizedError

_bearer = HTTPBearer(auto_error=False, description="Admin or ingest API key as a Bearer token")
_api_key = APIKeyHeader(name="X-API-Key", auto_error=False, description="Admin or ingest API key")


class Role(str, enum.Enum):
    admin = "admin"
    ingest = "ingest"


def _matches(candidate: str, secret) -> bool:
    return bool(secret) and hmac.compare_digest(candidate.encode(), secret.get_secret_value().encode())


async def current_role(
    request: Request,
    bearer: HTTPAuthorizationCredentials | None = Depends(_bearer),
    header_key: str | None = Depends(_api_key),
    settings: Settings = Depends(get_settings),
) -> Role:
    if not settings.admin_api_key:
        raise ServiceUnavailableError("ADMIN_API_KEY is not configured on the server", code="auth_not_configured")
    supplied = (bearer.credentials if bearer else None) or header_key
    if not supplied:
        raise UnauthorizedError("Missing API key", headers={"WWW-Authenticate": "Bearer"})
    if _matches(supplied, settings.admin_api_key):
        return Role.admin
    if _matches(supplied, settings.ingest_api_key):
        return Role.ingest
    raise UnauthorizedError("Invalid API key", headers={"WWW-Authenticate": "Bearer"})


async def require_admin(role: Role = Depends(current_role)) -> Role:
    if role is not Role.admin:
        raise ForbiddenError("Admin API key required")
    return role


async def require_uploader(role: Role = Depends(current_role)) -> Role:
    return role  # admin and ingest keys may upload

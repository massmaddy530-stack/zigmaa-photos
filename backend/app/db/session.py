"""Async SQLAlchemy engine and session factories."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def build_engine(url: str | None = None, *, null_pool: bool = False) -> AsyncEngine:
    settings = get_settings()
    url = url or settings.database_url
    kwargs: dict = {"echo": settings.db_echo, "pool_pre_ping": True}
    if null_pool or url.startswith("sqlite"):
        kwargs.pop("pool_pre_ping")
        kwargs["poolclass"] = NullPool
    else:
        kwargs.update(pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow)
    return create_async_engine(url, **kwargs)


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        _engine = build_engine()
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


def set_engine(engine: AsyncEngine) -> None:
    """Override the global engine (used by tests)."""
    global _engine, _sessionmaker
    _engine = engine
    _sessionmaker = async_sessionmaker(engine, expire_on_commit=False)


async def dispose_engine() -> None:
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def get_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session

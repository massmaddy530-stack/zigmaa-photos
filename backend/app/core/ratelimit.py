"""Fixed-window rate limiter with in-memory (single process) or Redis (multi-process) backends."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict

from fastapi import Request

from app.core.config import Settings
from app.core.errors import RateLimitedError

logger = logging.getLogger(__name__)


class MemoryRateLimiter:
    def __init__(self, max_keys: int = 50_000) -> None:
        self._buckets: OrderedDict[str, tuple[int, int]] = OrderedDict()
        self._lock = asyncio.Lock()
        self._max_keys = max_keys

    async def hit(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = int(time.time())
        window_start = now - now % window
        async with self._lock:
            start, count = self._buckets.get(key, (window_start, 0))
            if start != window_start:
                start, count = window_start, 0
            count += 1
            self._buckets[key] = (start, count)
            self._buckets.move_to_end(key)
            while len(self._buckets) > self._max_keys:
                self._buckets.popitem(last=False)
        return count <= limit, start + window - now


class RedisRateLimiter:
    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(url, socket_timeout=2, socket_connect_timeout=2)

    async def hit(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = int(time.time())
        bucket = f"rl:{key}:{now - now % window}"
        async with self._redis.pipeline(transaction=True) as pipe:
            count, _ = await pipe.incr(bucket).expire(bucket, window + 1).execute()
        return int(count) <= limit, window - now % window


def client_ip(request: Request, trust_proxy: bool) -> str:
    if trust_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.backend = RedisRateLimiter(settings.redis_url) if settings.rate_limit_backend == "redis" \
            else MemoryRateLimiter()
        self._fallback = MemoryRateLimiter()

    async def check(self, request: Request, scope: str, limit: int, window: int) -> None:
        key = f"{scope}:{client_ip(request, self.settings.trust_proxy_headers)}"
        try:
            allowed, retry_after = await self.backend.hit(key, limit, window)
        except Exception:  # Redis outage: degrade to per-process limiting rather than failing open
            logger.warning("Rate limiter backend unavailable; using in-memory fallback")
            allowed, retry_after = await self._fallback.hit(key, limit, window)
        if not allowed:
            raise RateLimitedError("Too many requests. Please wait a moment and try again.",
                                   headers={"Retry-After": str(max(1, retry_after))})

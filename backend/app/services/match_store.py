"""Short-lived storage of ranked match results so guests can page through them without re-uploading a selfie.

Only (photo_id, similarity) pairs are stored, never the selfie or its embedding, and entries expire after
MATCH_SESSION_TTL_S seconds.
"""

from __future__ import annotations

import json
import secrets
import threading
import time
import uuid
from collections import OrderedDict

from app.core.config import get_settings

Results = list[tuple[uuid.UUID, float]]


class MemoryMatchStore:
    def __init__(self, max_entries: int = 5000) -> None:
        self._data: OrderedDict[str, tuple[float, str, Results]] = OrderedDict()
        self._lock = threading.Lock()
        self._max = max_entries

    async def save(self, event_id: uuid.UUID, results: Results, ttl: int) -> str:
        token = secrets.token_urlsafe(24)
        with self._lock:
            self._purge()
            self._data[token] = (time.time() + ttl, str(event_id), results)
            while len(self._data) > self._max:
                self._data.popitem(last=False)
        return token

    async def load(self, event_id: uuid.UUID, token: str) -> Results | None:
        with self._lock:
            entry = self._data.get(token)
            if not entry or entry[0] < time.time() or entry[1] != str(event_id):
                return None
            return entry[2]

    def _purge(self) -> None:
        now = time.time()
        for key in [k for k, v in self._data.items() if v[0] < now]:
            del self._data[key]


class RedisMatchStore:
    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(url, socket_timeout=2, socket_connect_timeout=2)

    async def save(self, event_id: uuid.UUID, results: Results, ttl: int) -> str:
        token = secrets.token_urlsafe(24)
        payload = json.dumps({"e": str(event_id), "r": [[str(p), round(s, 5)] for p, s in results]})
        await self._redis.set(f"match:{token}", payload, ex=ttl)
        return token

    async def load(self, event_id: uuid.UUID, token: str) -> Results | None:
        raw = await self._redis.get(f"match:{token}")
        if not raw:
            return None
        data = json.loads(raw)
        if data["e"] != str(event_id):
            return None
        return [(uuid.UUID(p), float(s)) for p, s in data["r"]]


_store: MemoryMatchStore | RedisMatchStore | None = None


def get_match_store() -> MemoryMatchStore | RedisMatchStore:
    global _store
    if _store is None:
        s = get_settings()
        _store = RedisMatchStore(s.redis_url) if s.rate_limit_backend == "redis" else MemoryMatchStore()
    return _store

"""Integration tests against real services. Skipped unless configured:

    TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/eventphoto_test   (pgvector required)
    TEST_REDIS_URL=redis://localhost:6379/15

The database name must contain "test"; the schema is dropped and re-created via Alembic.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import numpy as np
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.db.session import build_engine, set_engine
from tests.conftest import ADMIN, IDENTITIES, create_event, make_image, upload

def _from_env_file(key: str) -> str | None:
    """Fall back to backend/.env so integration tests run without exporting variables manually."""
    from dotenv import dotenv_values

    return dotenv_values(Path(__file__).resolve().parents[1] / ".env").get(key) or None


PG_URL = os.environ.get("TEST_DATABASE_URL") or _from_env_file("TEST_DATABASE_URL")
REDIS_URL = os.environ.get("TEST_REDIS_URL") or _from_env_file("TEST_REDIS_URL")

pg = pytest.mark.skipif(not PG_URL, reason="TEST_DATABASE_URL not set")
rd = pytest.mark.skipif(not REDIS_URL, reason="TEST_REDIS_URL not set")
pytestmark = pytest.mark.integration


def _alembic(url: str, *args: str) -> None:
    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    cfg.attributes["database_url"] = url
    getattr(command, args[0])(cfg, *args[1:])


@pytest_asyncio.fixture
async def pg_engine():
    assert "test" in PG_URL.rsplit("/", 1)[-1], "Refusing to run: database name must contain 'test'"
    await asyncio.to_thread(_alembic, PG_URL, "downgrade", "base")
    await asyncio.to_thread(_alembic, PG_URL, "upgrade", "head")
    eng = build_engine(PG_URL, null_pool=True)
    set_engine(eng)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def pg_client(pg_engine, storage, analyzer, settings):
    from app.api import match as match_api
    from app.main import create_app
    from app.services import match_store

    match_api._limiter = None
    match_store._store = None
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://testserver") as c:
        yield c


@pg
async def test_migration_creates_pgvector_schema(pg_engine):
    async with pg_engine.connect() as conn:
        ext = (await conn.execute(text("SELECT extversion FROM pg_extension WHERE extname='vector'"))).scalar()
        assert ext
        idx = (await conn.execute(text(
            "SELECT indexdef FROM pg_indexes WHERE indexname='ix_faces_embedding_hnsw'"))).scalar()
        assert "hnsw" in idx and "vector_cosine_ops" in idx
        coltype = (await conn.execute(text(
            "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
            "WHERE attrelid='face_embeddings'::regclass AND attname='embedding'"))).scalar()
        assert coltype == "vector(512)"


@pg
async def test_end_to_end_on_postgres(pg_client):
    ev1 = await create_event(pg_client, "PG One")
    ev2 = await create_event(pg_client, "PG Two")
    ids = {}
    for i, people in enumerate([["alice"], ["bob"], ["alice", "bob"], [], ["alice", "carol", "dave"]]):
        r = await upload(pg_client, ev1["id"], (f"p{i}.png", make_image(people, seed=i), "image/png"))
        assert r.status_code == 201, r.text
        ids[tuple(people)] = r.json()["items"][0]["photo_id"]
    other = await upload(pg_client, ev2["id"], ("x.png", make_image(["alice"], seed=50), "image/png"))
    other_id = other.json()["items"][0]["photo_id"]

    # duplicate handling via the real unique constraint
    r = await upload(pg_client, ev1["id"], ("dup.png", make_image(["alice"], seed=0), "image/png"))
    assert r.status_code == 200 and r.json()["duplicates"] == 1

    r = await pg_client.post(f"/api/v1/public/events/{ev1['slug']}/match",
                             files={"selfie": ("s.jpg", make_image(["alice"], fmt="JPEG", seed=77), "image/jpeg")},
                             data={"consent": "true"})
    assert r.status_code == 200, r.text
    got = [i["photo_id"] for i in r.json()["items"]]
    assert set(got) == {ids[("alice",)], ids[("alice", "bob")], ids[("alice", "carol", "dave")]}
    assert other_id not in got  # event isolation in SQL
    sims = [i["similarity"] for i in r.json()["items"]]
    assert sims == sorted(sims, reverse=True)

    status = (await pg_client.get(f"/api/v1/events/{ev1['id']}/status", headers=ADMIN)).json()
    assert status["counts"]["indexed"] == 5 and status["counts"]["faces"] == 7 and status["is_complete"]


@pg
async def test_vector_search_scoping_and_threshold(pg_engine, settings):
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.models import Event, FaceEmbedding, Photo, PhotoStatus
    from app.services.matching import search_event_faces

    sm = async_sessionmaker(pg_engine, expire_on_commit=False)
    rng = np.random.default_rng(0)
    async with sm() as s:
        events = [Event(slug=f"s{i}{uuid.uuid4().hex[:8]}", name=f"E{i}") for i in range(2)]
        s.add_all(events)
        await s.flush()
        target = IDENTITIES["alice"]
        for ev in events:
            for i in range(300):  # mostly random faces + a few of alice
                p = Photo(event_id=ev.id, original_filename="x", content_hash=uuid.uuid4().hex * 2,
                          content_type="image/png", size_bytes=1, original_key=f"k/{uuid.uuid4()}",
                          status=PhotoStatus.indexed)
                s.add(p)
                await s.flush()
                if i % 50 == 0:
                    v = target + rng.standard_normal(512).astype(np.float32) * 0.02
                else:
                    v = rng.standard_normal(512).astype(np.float32)
                v /= np.linalg.norm(v)
                s.add(FaceEmbedding(event_id=ev.id, photo_id=p.id, face_index=0, bbox_x1=0, bbox_y1=0,
                                    bbox_x2=1, bbox_y2=1, det_score=0.9, embedding=v))
        await s.commit()

        settings.match_similarity_threshold = 0.5
        res = await search_event_faces(s, events[0].id, target, settings)
        await s.commit()
        assert len(res) == 6
        assert all(sim > 0.89 for _, sim in res)
        photo_events = {pid: eid for pid, eid in (await s.execute(
            text("SELECT id, event_id FROM photos WHERE id = ANY(:ids)"), {"ids": [r[0] for r in res]})).all()}
        assert set(photo_events.values()) == {events[0].id}


@rd
async def test_redis_rate_limiter_and_match_store():
    from app.core.ratelimit import RedisRateLimiter
    from app.services.match_store import RedisMatchStore

    rl = RedisRateLimiter(REDIS_URL)
    key = f"test:{uuid.uuid4()}"
    results = [await rl.hit(key, 2, 60) for _ in range(3)]
    assert [ok for ok, _ in results] == [True, True, False]

    store = RedisMatchStore(REDIS_URL)
    ev, other = uuid.uuid4(), uuid.uuid4()
    data = [(uuid.uuid4(), 0.91), (uuid.uuid4(), 0.55)]
    tok = await store.save(ev, data, ttl=30)
    loaded = await store.load(ev, tok)
    assert [p for p, _ in loaded] == [p for p, _ in data]
    assert await store.load(other, tok) is None

"""Shared fixtures. Unit tests use SQLite + local storage in a temp dir + a deterministic fake face analyzer.

No cloud credentials, Redis, PostgreSQL or model weights are needed for unit tests.
"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="evp_tests_"))
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}",
    "TASK_MODE": "sync",
    "TASK_RETRY_BACKOFF_S": "0",
    "STORAGE_BACKEND": "local",
    "LOCAL_STORAGE_DIR": str(_TMP / "storage"),
    "ADMIN_API_KEY": "test-admin-key-0123456789abcdef",
    "INGEST_API_KEY": "test-ingest-key-0123456789abcdef",
    "SIGNING_SECRET": "test-signing-secret-0123456789abcdef0123",
    "PUBLIC_BASE_URL": "http://testserver",
    "LOG_JSON": "false",
    "RATE_LIMIT_BACKEND": "memory",
    "MATCH_RATE_LIMIT": "1000",
    "FACE_MODEL_DIR": str(_TMP / "no-models"),
})

import numpy as np  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import event as sa_event  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import build_engine, set_engine  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.face.engine import DetectedFace, set_analyzer  # noqa: E402
from app.services.storage import set_storage  # noqa: E402

ADMIN = {"Authorization": f"Bearer {os.environ['ADMIN_API_KEY']}"}
INGEST = {"X-API-Key": os.environ["INGEST_API_KEY"]}

# --------------------------------------------------------------------------- fake face analyzer

_rng = np.random.default_rng(42)
IDENTITIES = {name: (v / np.linalg.norm(v)).astype(np.float32)
              for name, v in ((n, _rng.standard_normal(512)) for n in ("alice", "bob", "carol", "dave"))}

# Palette colour -> identities present in the image. Colours are far apart so JPEG noise can't confuse them.
SCENES: dict[tuple[int, int, int], list[str]] = {
    (0, 0, 0): [],
    (255, 0, 0): ["alice"],
    (0, 255, 0): ["bob"],
    (0, 0, 255): ["alice", "bob"],
    (255, 255, 0): ["carol"],
    (255, 0, 255): ["dave"],
    (0, 255, 255): ["alice", "carol", "dave"],
    (255, 255, 255): ["alice", "bob"],  # used as a "group selfie" with equal-size faces
}
SCENE_BY_PEOPLE = {tuple(v): k for k, v in SCENES.items()}


class FakeAnalyzer:
    model_name = "fake"

    def __init__(self) -> None:
        self.calls = 0

    def analyze(self, image: Image.Image) -> list[DetectedFace]:
        self.calls += 1
        px = np.asarray(image.convert("RGB").getpixel((2, 2)), dtype=float)
        key = min(SCENES, key=lambda c: float(np.sum((np.asarray(c) - px) ** 2)))
        faces = []
        w, h = image.size
        for i, name in enumerate(SCENES[key]):
            noise = np.random.default_rng(self.calls * 31 + i).standard_normal(512).astype(np.float32) * 0.01
            emb = IDENTITIES[name] + noise
            emb /= np.linalg.norm(emb)
            x1 = w * (0.1 + 0.3 * i)
            faces.append(DetectedFace(bbox=np.array([x1, h * 0.2, x1 + w * 0.2, h * 0.5], dtype=np.float32),
                                      kps=np.zeros((5, 2), np.float32), det_score=0.9, embedding=emb))
        return faces


def make_image(people: list[str] | tuple[str, ...] = (), *, size=(800, 600), fmt="PNG", seed: int = 0,
               exif_orientation: int | None = None) -> bytes:
    """Solid scene colour (encodes who is in the photo) plus a unique noise patch (unique hash)."""
    color = SCENE_BY_PEOPLE[tuple(people)]
    img = Image.new("RGB", size, color)
    noise = np.random.default_rng(seed).integers(0, 255, (16, 16, 3), dtype=np.uint8)
    img.paste(Image.fromarray(noise), (size[0] - 20, size[1] - 20))
    buf = io.BytesIO()
    kwargs = {}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs["exif"] = exif
    img.save(buf, format=fmt, **({"quality": 95} if fmt == "JPEG" else {}), **kwargs)
    return buf.getvalue()


def make_mpo(primary: list[str] | tuple[str, ...], secondary: list[str] | tuple[str, ...], *, size=(800, 600),
             seed: int = 0, exif_orientation: int | None = None) -> bytes:
    """Camera-style multi-picture JPEG (MPO). The second frame shows different people, so processing the wrong
    frame is detectable through face counts."""
    first, second = (Image.open(io.BytesIO(make_image(p, size=size, seed=seed))) for p in (primary, secondary))
    buf = io.BytesIO()
    kwargs = {}
    if exif_orientation:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        kwargs["exif"] = exif
    first.save(buf, format="MPO", save_all=True, append_images=[second], quality=95, **kwargs)
    return buf.getvalue()


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def settings():
    s = get_settings()
    snapshot = s.model_dump()
    yield s
    for k, v in snapshot.items():
        object.__setattr__(s, k, v)


@pytest_asyncio.fixture
async def engine(tmp_path):
    eng = build_engine(f"sqlite+aiosqlite:///{(tmp_path / 'db.sqlite').as_posix()}")

    @sa_event.listens_for(eng.sync_engine, "connect")
    def _fk(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    set_engine(eng)
    yield eng
    await eng.dispose()


@pytest.fixture
def storage(tmp_path, settings):
    from app.services.storage import LocalStorage

    st = LocalStorage(tmp_path / "storage", settings.public_base_url, settings.signing_secret.get_secret_value(),
                      settings.signed_url_ttl_s)
    set_storage(st)
    yield st
    set_storage(None)


@pytest.fixture
def analyzer():
    fa = FakeAnalyzer()
    set_analyzer(fa)
    yield fa
    set_analyzer(None)


@pytest_asyncio.fixture
async def client(engine, storage, analyzer, settings):
    from app.api import match as match_api
    from app.main import create_app
    from app.services import match_store

    match_api._limiter = None
    match_store._store = None
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as c:
        yield c


async def create_event(client: AsyncClient, name: str = "Test Wedding", **extra) -> dict:
    r = await client.post("/api/v1/events", json={"name": name, **extra}, headers=ADMIN)
    assert r.status_code == 201, r.text
    return r.json()


async def upload(client: AsyncClient, event_id: str, *files: tuple[str, bytes, str], headers=ADMIN):
    return await client.post(f"/api/v1/events/{event_id}/photos",
                             files=[("files", f) for f in files], headers=headers)

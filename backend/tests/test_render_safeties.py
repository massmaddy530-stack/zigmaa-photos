import io
import uuid
import pytest
from httpx import AsyncClient
from PIL import Image
from app.services.storage import generate_variants
from app.models import Event, EventPhoto, FaceEmbedding, utcnow
import numpy as np


@pytest.mark.asyncio
async def test_root_health_and_service(client: AsyncClient):
    r = await client.get("/")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["service"] == "zigmaa-backend"

    # Also test /health contains service
    r_health = await client.get("/health")
    assert r_health.status_code == 200
    h_data = r_health.json()
    assert h_data["service"] == "zigmaa-backend"
    assert h_data["status"] == "ok"


@pytest.mark.asyncio
async def test_cors_headers(client: AsyncClient):
    # Pre-flight options request from production frontend origin
    headers = {
        "Origin": "https://zigmaa-photos.vercel.app",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
    }
    r = await client.options("/match-selfie", headers=headers)
    assert r.headers.get("access-control-allow-origin") == "https://zigmaa-photos.vercel.app"
    assert r.headers.get("access-control-allow-credentials") == "true"


def test_generate_variants():
    # Create simple image in memory
    img = Image.new("RGB", (1920, 1080), color=(100, 150, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()

    thumb, prev = generate_variants(img_bytes)
    assert len(thumb) > 0
    assert len(prev) > 0

    with Image.open(io.BytesIO(thumb)) as t_img:
        assert t_img.width <= 400
        assert t_img.height <= 400
        assert t_img.format == "WEBP"

    with Image.open(io.BytesIO(prev)) as p_img:
        assert p_img.width <= 1280
        assert p_img.height <= 720
        assert p_img.format == "WEBP"


@pytest.mark.asyncio
async def test_match_selfie_endpoint(client: AsyncClient):
    from tests.conftest import IDENTITIES
    from app.db.session import get_sessionmaker

    ev_id = uuid.uuid4()
    photo_id = uuid.uuid4()
    emb = IDENTITIES["alice"]

    async with get_sessionmaker()() as session:
        session.add(Event(id=ev_id, slug=f"ev-{ev_id.hex[:8]}", name="Test Event", title="Test Event"))
        from app.models import Photo, PhotoStatus
        session.add(Photo(
            id=photo_id,
            event_id=ev_id,
            original_filename="test.jpg",
            content_hash=uuid.uuid4().hex,
            content_type="image/jpeg",
            size_bytes=1000,
            original_key="orig.jpg",
            status=PhotoStatus.indexed,
        ))
        session.add(EventPhoto(
            id=photo_id,
            event_id=ev_id,
            r2_preview_url="https://pub-xxx.r2.dev/previews/1.webp",
            r2_thumbnail_url="https://pub-xxx.r2.dev/thumbnails/1.webp",
            r2_original_url="https://pub-xxx.r2.dev/originals/1.jpg",
        ))
        session.add(FaceEmbedding(
            event_id=ev_id,
            photo_id=photo_id,
            face_index=0,
            bbox_x1=0.1,
            bbox_y1=0.1,
            bbox_x2=0.5,
            bbox_y2=0.5,
            det_score=0.99,
            embedding=emb,
            model_name="buffalo_sc",
        ))
        await session.commit()

    # Red image corresponds to alice in conftest fake analyzer
    red_img = Image.new("RGB", (320, 320), color=(255, 0, 0))
    buf = io.BytesIO()
    red_img.save(buf, format="JPEG")
    buf.seek(0)

    files = {"file": ("selfie.jpg", buf, "image/jpeg")}
    data = {"event_id": str(ev_id)}

    resp = await client.post("/match-selfie", data=data, files=files)
    assert resp.status_code == 200
    res_data = resp.json()
    assert res_data["status"] == "ok"
    assert res_data["total"] == 1
    assert res_data["matches"][0]["id"] == str(photo_id)
    assert res_data["matches"][0]["r2_preview_url"] == "https://pub-xxx.r2.dev/previews/1.webp"

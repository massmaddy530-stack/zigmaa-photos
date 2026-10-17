"""FACE_ANALYSIS_ENABLED: previews-only mode (no face models) vs the default face-analysis mode."""

import os
import subprocess
import sys
import textwrap
from pathlib import Path

from app.core.config import Settings
from app.services.face.engine import set_analyzer
from tests.conftest import ADMIN, create_event, make_image, upload

BACKEND_DIR = Path(__file__).resolve().parents[1]


async def _upload_one(client, people):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.jpg", make_image(people, fmt="JPEG"), "image/jpeg"))
    assert r.status_code == 201, r.text
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    return ev, photo


async def _public_match(client, slug, consent=True):
    return await client.post(f"/api/v1/public/events/{slug}/match",
                             files={"selfie": ("s.jpg", make_image(["alice"], fmt="JPEG", seed=9), "image/jpeg")},
                             data={"consent": "true" if consent else "false"})


async def _fetch(client, url):
    return await client.get(url.replace("http://testserver", ""))


def test_enabled_by_default():
    assert Settings.model_fields["face_analysis_enabled"].default is True


async def test_enabled_mode_detects_faces_and_matches(client, analyzer):
    ev, photo = await _upload_one(client, ["alice", "bob"])
    assert photo["status"] == "indexed" and photo["face_count"] == 2
    assert analyzer.calls == 1
    r = await _public_match(client, ev["slug"])
    assert r.status_code == 200 and r.json()["total"] == 1
    assert (await client.get("/health")).json()["checks"]["face_model"] == "ok"


async def test_disabled_mode_creates_previews_without_face_analysis(client, settings, analyzer):
    settings.face_analysis_enabled = False
    ev, photo = await _upload_one(client, ["alice", "bob"])
    assert photo["status"] == "indexed" and photo["face_count"] == 0 and photo["faces"] == []
    assert photo["error_message"] is None and photo["jobs"][0]["status"] == "succeeded"
    assert photo["width"] == 800 and photo["height"] == 600
    for key in ("thumbnail_url", "preview_url"):
        r = await _fetch(client, photo[key])
        assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert (await _fetch(client, photo["original_url"])).status_code == 200
    assert analyzer.calls == 0  # face detection never ran


async def test_disabled_mode_matching_unavailable(client, settings, analyzer):
    settings.face_analysis_enabled = False
    ev, _ = await _upload_one(client, ["alice"])
    assert (await client.get(f"/api/v1/public/events/{ev['slug']}")).json()["matching_available"] is False

    r = await _public_match(client, ev["slug"], consent=False)  # consent is still checked first
    assert r.status_code == 400 and r.json()["error"]["code"] == "consent_required"
    r = await _public_match(client, ev["slug"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "face_model_unavailable"
    r = await client.post(f"/api/v1/events/{ev['id']}/match", headers=ADMIN,
                          files={"selfie": ("s.jpg", make_image(["alice"], fmt="JPEG", seed=9), "image/jpeg")})
    assert r.status_code == 503 and r.json()["error"]["code"] == "face_model_unavailable"
    assert analyzer.calls == 0

    health = await client.get("/health")
    assert health.status_code == 200 and health.json()["checks"]["face_model"] == "disabled"


async def test_enabled_mode_with_missing_weights_keeps_existing_behaviour(client, settings):
    set_analyzer(None)  # real ONNX analyzer; FACE_MODEL_DIR points at an empty directory in tests
    assert settings.face_analysis_enabled
    ev, photo = await _upload_one(client, ["alice"])
    assert photo["status"] == "failed" and "Face model unavailable" in photo["error_message"]
    assert (await client.get(f"/api/v1/public/events/{ev['slug']}")).json()["matching_available"] is False
    r = await _public_match(client, ev["slug"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "face_model_unavailable"
    assert (await client.get("/health")).json()["checks"]["face_model"] == "missing"


_NO_ONNX_SCRIPT = textwrap.dedent("""
    import io, sys, uuid
    from PIL import Image
    from app.main import app  # the full startup import graph
    from app.core.config import get_settings
    from app.core.errors import ServiceUnavailableError
    from app.models import Photo
    from app.services.face.engine import analyzer_available
    from app.services.indexing import process_file
    from app.services.matching import Timings, selfie_embeddings
    from app.services.storage import get_storage

    def jpeg():
        buf = io.BytesIO()
        Image.new("RGB", (800, 600), (200, 50, 50)).save(buf, "JPEG")
        return buf.getvalue()

    settings, storage = get_settings(), get_storage()
    photo = Photo(id=uuid.uuid4(), event_id=uuid.uuid4(), original_key="originals/test.jpg")
    storage.put_bytes(photo.original_key, jpeg(), "image/jpeg")
    result = process_file(photo, storage, settings)
    assert result.faces == [] and (result.width, result.height) == (800, 600)
    assert not analyzer_available()
    try:
        selfie_embeddings(jpeg(), settings, Timings())
        raise AssertionError("matching should be unavailable")
    except ServiceUnavailableError as exc:
        assert exc.code == "face_model_unavailable"
    print("onnxruntime imported:", "onnxruntime" in sys.modules)
""")


def test_disabled_mode_never_imports_onnxruntime(tmp_path):
    """Fresh interpreter, no model weights: processing a photo and refusing a selfie must not load ONNX Runtime."""
    (tmp_path / "models").mkdir()
    env = {**os.environ, "FACE_ANALYSIS_ENABLED": "false", "FACE_MODEL_DIR": str(tmp_path / "models"),
           "LOCAL_STORAGE_DIR": str(tmp_path / "storage")}
    out = subprocess.run([sys.executable, "-c", _NO_ONNX_SCRIPT], cwd=BACKEND_DIR, env=env,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
    assert "onnxruntime imported: False" in out.stdout

"""Pure unit tests: face geometry helpers, image helpers, storage keys, logging redaction."""

import io
import logging

import numpy as np
import pytest
from PIL import Image

from app.core.logging import JsonFormatter, redact
from app.services.face.engine import (
    ARCFACE_DST,
    DetectedFace,
    _distance2bbox,
    _nms,
    align_face,
    l2_normalize,
    umeyama_similarity,
)
from app.services.images import fit_within, sanitize_filename
from app.services.matching import choose_selfie_faces
from app.services.storage import LocalStorage, sign_media, verify_media_signature
from app.core.errors import UnprocessableError


def test_umeyama_recovers_similarity_transform():
    theta, scale, t = 0.3, 1.7, np.array([12.0, -5.0])
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    src = ARCFACE_DST.astype(np.float64)
    dst = (scale * (rot @ src.T)).T + t
    m = umeyama_similarity(src, dst)
    np.testing.assert_allclose(m[:, :2], scale * rot, atol=1e-6)
    np.testing.assert_allclose(m[:, 2], t, atol=1e-6)


def test_align_face_maps_landmarks_to_template():
    # Draw dots at landmark positions in a larger image, align, and check the dots land on the template.
    img = Image.new("RGB", (400, 400), (0, 0, 0))
    kps = ARCFACE_DST * 2.5 + np.array([60, 40])
    px = img.load()
    for x, y in kps:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                px[int(round(x)) + dx, int(round(y)) + dy] = (255, 255, 255)
    crop = np.asarray(align_face(img, kps))
    assert crop.shape == (112, 112, 3)
    for x, y in ARCFACE_DST:
        assert crop[int(round(y)), int(round(x))].mean() > 100


def test_nms_suppresses_overlaps():
    dets = np.array([[0, 0, 10, 10, 0.9], [1, 1, 11, 11, 0.8], [50, 50, 60, 60, 0.7]], dtype=np.float32)
    assert _nms(dets, 0.4) == [0, 2]


def test_distance2bbox():
    pts = np.array([[10.0, 10.0]])
    np.testing.assert_allclose(_distance2bbox(pts, np.array([[1.0, 2.0, 3.0, 4.0]])), [[9, 8, 13, 14]])


def test_l2_normalize():
    v = l2_normalize(np.array([3.0, 4.0]))
    np.testing.assert_allclose(v, [0.6, 0.8])
    with pytest.raises(ValueError):
        l2_normalize(np.zeros(4))


def _face(area_side: float) -> DetectedFace:
    return DetectedFace(bbox=np.array([0, 0, area_side, area_side], dtype=np.float32), kps=np.zeros((5, 2)),
                        det_score=0.9, embedding=np.zeros(512, np.float32))


def test_choose_selfie_faces():
    big, companion, background = _face(300), _face(170), _face(90)  # areas: 1x, ~3.1x and ~11x smaller
    assert choose_selfie_faces([companion, big], require_single=True) == [big, companion]
    assert choose_selfie_faces([background, big], require_single=True) == [big]  # background face ignored
    assert choose_selfie_faces([background, companion, big], require_single=True) == [big, companion]
    three = [_face(200), _face(190), _face(180)]
    with pytest.raises(UnprocessableError) as e:
        choose_selfie_faces(three, require_single=True)
    assert e.value.code == "multiple_faces_detected"
    assert len(choose_selfie_faces(three, require_single=False)) == 2
    with pytest.raises(UnprocessableError):
        choose_selfie_faces([], require_single=True)


def test_fit_within_never_upscales():
    img = Image.new("RGB", (100, 50))
    assert fit_within(img, 400, 400).size == (100, 50)
    assert fit_within(Image.new("RGB", (4000, 1000)), 1920, 1080).size == (1920, 480)


@pytest.mark.parametrize("raw,expected", [
    ("../../etc/passwd", "passwd"), ("C:\\Users\\x\\IMG 1.jpg", "IMG 1.jpg"), ("", "upload"),
    ("a<b>c:d.jpg", "abcd.jpg"), ("..", "upload"),
])
def test_sanitize_filename(raw, expected):
    assert sanitize_filename(raw) == expected


def test_local_storage_rejects_traversal(tmp_path):
    st = LocalStorage(tmp_path, "http://x", "s" * 40, 60)
    for bad in ("../x", "a/../../x", "/abs", "a\\b", "a//b"):
        with pytest.raises(ValueError):
            st.path_for(bad)
    st.put_bytes("events/e/thumbnails/p.webp", b"abc", "image/webp")
    assert st.exists("events/e/thumbnails/p.webp")
    st.delete("events/e/thumbnails/p.webp")
    assert not st.exists("events/e/thumbnails/p.webp")


def test_media_signature():
    import time

    exp = int(time.time()) + 60
    sig = sign_media("k", exp, "secret")
    assert verify_media_signature("k", exp, sig, "secret")
    assert not verify_media_signature("k2", exp, sig, "secret")
    assert not verify_media_signature("k", exp, sig, "other")
    assert not verify_media_signature("k", int(time.time()) - 1, sign_media("k", int(time.time()) - 1, "s"), "s")


def test_redaction():
    s = redact("Authorization: Bearer abc.def postgresql+asyncpg://user:hunter2@db/x api_key=zzz sig=QQQ")
    assert "abc.def" not in s and "hunter2" not in s and "zzz" not in s and "QQQ" not in s
    rec = logging.LogRecord("t", logging.INFO, __file__, 1, "token=%s", ("secret123",), None)
    assert "secret123" not in JsonFormatter().format(rec)


def test_embedding_type_rejects_wrong_dimension():
    from sqlalchemy.dialects import sqlite

    from app.db.types import EmbeddingType

    t = EmbeddingType(512)
    with pytest.raises(ValueError):
        t.process_bind_param([0.1] * 10, sqlite.dialect())
    out = t.process_result_value(t.process_bind_param(np.ones(512), sqlite.dialect()), sqlite.dialect())
    assert out.shape == (512,) and out.dtype == np.float32


def test_settings_production_guard(monkeypatch):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(environment="production", signing_secret="short", admin_api_key="x" * 30)
    with pytest.raises(ValidationError):
        Settings(environment="production", signing_secret="y" * 40, admin_api_key=None)
    ok = Settings(environment="production", signing_secret="y" * 40, admin_api_key="x" * 30,
                  cors_origins="https://photos.example.com")
    assert ok.cors_origins == ["https://photos.example.com"]


def test_webp_derivative_quality_settings():
    from app.services.images import to_webp

    img = Image.new("RGB", (100, 100), (10, 200, 30))
    data = to_webp(img, 75)
    assert Image.open(io.BytesIO(data)).format == "WEBP"


def test_list_settings_from_env_accept_csv_and_json(monkeypatch):
    from app.core.config import Settings

    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000, https://photos.example.com")
    monkeypatch.setenv("ALLOWED_IMAGE_FORMATS", "JPEG,PNG")
    s = Settings()
    assert s.cors_origins == ["http://localhost:3000", "https://photos.example.com"]
    assert s.allowed_image_formats == ["JPEG", "PNG"]
    monkeypatch.setenv("CORS_ORIGINS", '["https://a.example.com"]')
    assert Settings().cors_origins == ["https://a.example.com"]

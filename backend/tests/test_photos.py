import io
from urllib.parse import parse_qs, urlparse

from PIL import Image
from sqlalchemy import func, select

from app.db.session import get_sessionmaker
from app.models import FaceEmbedding, Photo, ProcessingJob
from app.services.storage import StorageError
from tests.conftest import ADMIN, INGEST, create_event, make_image, make_mpo, upload


async def test_upload_creates_indexes_and_derivatives(client):
    ev = await create_event(client)
    big = make_image(["alice", "bob"], size=(4000, 3000), fmt="JPEG")
    r = await upload(client, ev["id"], ("IMG_0001.JPG", big, "image/jpeg"))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["created"] == 1 and body["items"][0]["status"] == "created"
    photo_id = body["items"][0]["photo_id"]

    r = await client.get(f"/api/v1/events/{ev['id']}/photos/{photo_id}", headers=ADMIN)
    photo = r.json()
    assert photo["status"] == "indexed"
    assert photo["face_count"] == 2 and len(photo["faces"]) == 2
    assert all(0 <= v <= 1 for f in photo["faces"] for v in f["bbox"])
    assert photo["width"] == 4000 and photo["height"] == 3000
    assert photo["jobs"][0]["status"] == "succeeded"

    thumb = await client.get(photo["thumbnail_url"].replace("http://testserver", ""))
    preview = await client.get(photo["preview_url"].replace("http://testserver", ""))
    assert thumb.headers["content-type"] == "image/webp"
    t = Image.open(io.BytesIO(thumb.content))
    p = Image.open(io.BytesIO(preview.content))
    assert t.format == "WEBP" and max(t.size) == 400
    assert p.size == (1440, 1080)  # 4:3 bounded by 1920x1080, aspect preserved


async def test_small_images_are_not_enlarged(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("small.png", make_image(["bob"], size=(300, 200)), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    p = Image.open(io.BytesIO((await client.get(photo["preview_url"].replace("http://testserver", ""))).content))
    assert p.size == (300, 200)


async def test_exif_orientation_respected(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("rot.jpg", make_image(["bob"], size=(800, 600), fmt="JPEG",
                                                              exif_orientation=6), "image/jpeg"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert (photo["width"], photo["height"]) == (600, 800)


async def test_batch_upload_and_duplicates(client):
    ev = await create_event(client)
    a, b = make_image(["alice"], seed=1), make_image(["bob"], seed=2)
    r = await upload(client, ev["id"], ("a.png", a, "image/png"), ("b.png", b, "image/png"),
                     ("a-copy.png", a, "image/png"))
    assert r.status_code == 201
    body = r.json()
    assert (body["created"], body["duplicates"]) == (2, 1)
    assert body["items"][2]["photo_id"] == body["items"][0]["photo_id"]
    # Re-uploading only duplicates returns 200
    r = await upload(client, ev["id"], ("a.png", a, "image/png"))
    assert r.status_code == 200 and r.json()["duplicates"] == 1
    # Same bytes in a different event are NOT duplicates (dedupe is event-scoped)
    ev2 = await create_event(client, "Other")
    assert (await upload(client, ev2["id"], ("a.png", a, "image/png"))).status_code == 201


async def test_check_hashes(client):
    import hashlib

    ev = await create_event(client)
    data = make_image(["alice"], seed=9)
    await upload(client, ev["id"], ("a.png", data, "image/png"))
    h = hashlib.sha256(data).hexdigest()
    r = await client.post(f"/api/v1/events/{ev['id']}/photos/check-hashes",
                          json={"hashes": [h, "0" * 64, "not-a-hash"]}, headers=INGEST)
    assert r.status_code == 200 and r.json()["existing"] == [h]


async def test_invalid_format_rejected(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("evil.jpg", b"<?php echo 1; ?>" * 10, "image/jpeg"),
                     ("empty.png", b"", "image/png"))
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "all_files_rejected"
    codes = [i["error_code"] for i in err["details"]["items"]]
    assert codes == ["unsupported_format", "empty_file"]


async def test_disallowed_format_rejected(client):
    ev = await create_event(client)
    buf = io.BytesIO()
    Image.new("RGB", (64, 64)).save(buf, format="GIF")
    r = await upload(client, ev["id"], ("anim.gif", buf.getvalue(), "image/gif"))
    assert r.status_code == 422
    assert r.json()["error"]["details"]["items"][0]["error_code"] == "unsupported_format"


async def test_truncated_image_rejected(client):
    ev = await create_event(client)
    data = make_image(["alice"], fmt="JPEG")
    r = await upload(client, ev["id"], ("cut.jpg", data[: len(data) // 3], "image/jpeg"))
    assert r.status_code == 422


async def test_mpo_with_jpg_extension_uses_primary_frame(client):
    ev = await create_event(client)
    data = make_mpo(["alice"], ["alice", "carol", "dave"], seed=11)
    assert Image.open(io.BytesIO(data)).format == "MPO"
    r = await upload(client, ev["id"], ("DSC00348.JPG", data, "image/jpeg"))
    assert r.status_code == 201, r.text
    pid = r.json()["items"][0]["photo_id"]

    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "indexed" and photo["face_count"] == 1  # primary frame only
    assert photo["content_type"] == "image/jpeg" and photo["size_bytes"] == len(data)
    assert (photo["width"], photo["height"]) == (800, 600)
    original = await client.get(photo["original_url"].replace("http://testserver", ""))
    assert original.content == data  # stored untouched, all frames kept
    thumb = await client.get(photo["thumbnail_url"].replace("http://testserver", ""))
    assert Image.open(io.BytesIO(thumb.content)).format == "WEBP"

    # duplicate detection works on the original bytes
    r = await upload(client, ev["id"], ("DSC00348 copy.JPG", data, "image/jpeg"))
    assert r.status_code == 200 and r.json()["duplicates"] == 1

    # distribution: the guest's selfie (itself an MPO; its secondary frame would fail the single-face check) matches
    r = await client.post(f"/api/v1/public/events/{ev['slug']}/match",
                          files={"selfie": ("selfie.JPG", make_mpo(["alice"], ["alice", "bob"], seed=12),
                                            "image/jpeg")},
                          data={"consent": "true"})
    assert r.status_code == 200, r.text
    assert [i["photo_id"] for i in r.json()["items"]] == [pid]


async def test_mpo_extension_accepted_regardless_of_declared_type(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"],
                     ("DSC00346.MPO", make_mpo(["bob"], ["carol"], seed=13), "image/mpo"),
                     ("DSC00347.mpo", make_mpo(["carol"], ["bob"], seed=14), "application/octet-stream"))
    assert r.status_code == 201, r.text
    assert [i["status"] for i in r.json()["items"]] == ["created", "created"]
    for item in r.json()["items"]:
        photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{item['photo_id']}", headers=ADMIN)).json()
        assert photo["face_count"] == 1 and photo["content_type"] == "image/jpeg"


async def test_mpo_exif_orientation_respected(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("DSC00350.JPG", make_mpo(["bob"], [], exif_orientation=6), "image/jpeg"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert (photo["width"], photo["height"]) == (600, 800)
    assert photo["face_count"] == 1


async def test_corrupt_mpo_rejected(client):
    ev = await create_event(client)
    data = make_mpo(["alice"], ["bob"], seed=15)
    primary_end = data.find(b"\xff\xd8", 2)  # start of the second frame
    r = await upload(client, ev["id"], ("cut.JPG", data[: primary_end // 2], "image/jpeg"),
                     ("fake.MPO", b"MPF\x00" + b"\x00" * 200, "image/mpo"))
    assert r.status_code == 422
    items = r.json()["error"]["details"]["items"]
    assert [i["error_code"] for i in items] == ["corrupt_image", "unsupported_format"]
    assert items[0]["error"] == "Image file is corrupt or truncated"


async def test_mpo_respects_limits_and_auth(client, settings):
    ev = await create_event(client)
    data = make_mpo(["alice"], ["bob"], seed=16)
    r = await client.post(f"/api/v1/events/{ev['id']}/photos", files=[("files", ("a.JPG", data, "image/jpeg"))])
    assert r.status_code == 401
    settings.max_upload_bytes = len(data) - 1
    r = await upload(client, ev["id"], ("a.JPG", data, "image/jpeg"))
    assert r.json()["error"]["details"]["items"][0]["error_code"] == "file_too_large"
    settings.max_upload_bytes = 40 * 1024 * 1024
    settings.allowed_image_formats = ["PNG"]  # MPO is accepted only where JPEG is
    r = await upload(client, ev["id"], ("a.JPG", data, "image/jpeg"))
    assert r.json()["error"]["details"]["items"][0]["error_code"] == "unsupported_format"


async def test_oversized_file_rejected(client, settings):
    settings.max_upload_bytes = 10_000
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("big.png", make_image(["alice"], size=(1200, 900), seed=3) + b"0" * 20000,
                                        "image/png"), ("ok.png", make_image([], size=(32, 32)), "image/png"))
    assert r.status_code == 201
    items = r.json()["items"]
    assert items[0]["status"] == "rejected" and items[0]["error_code"] == "file_too_large"
    assert items[1]["status"] == "created"


async def test_request_body_limit_413(client):
    ev = await create_event(client)
    r = await client.post(f"/api/v1/events/{ev['id']}/photos", headers={**ADMIN, "content-length": str(10**12),
                                                                        "content-type": "multipart/form-data; b=x"},
                          content=b"x")
    assert r.status_code == 413


async def test_no_face_photo_indexed_with_zero_faces(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("landscape.png", make_image([]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "indexed" and photo["face_count"] == 0


async def test_ingest_key_can_upload_and_source_is_agent(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"), headers=INGEST)
    assert r.status_code == 201
    r = await client.get(f"/api/v1/events/{ev['id']}/photos", headers=ADMIN)
    assert r.json()["items"][0]["source"] == "agent"
    # but cannot list photos
    assert (await client.get(f"/api/v1/events/{ev['id']}/photos", headers=INGEST)).status_code == 403


async def test_upload_to_archived_event_conflict(client):
    ev = await create_event(client)
    await client.patch(f"/api/v1/events/{ev['id']}", json={"status": "archived"}, headers=ADMIN)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    assert r.status_code == 409


async def test_list_photos_filters(client):
    ev = await create_event(client)
    await upload(client, ev["id"], ("a.png", make_image(["alice"], seed=1), "image/png"),
                 ("n.png", make_image([], seed=2), "image/png"), ("z.png", make_image(["bob"], seed=3), "image/png"))
    base = f"/api/v1/events/{ev['id']}/photos"
    assert (await client.get(base, headers=ADMIN)).json()["total"] == 3
    assert (await client.get(base, params={"has_faces": True}, headers=ADMIN)).json()["total"] == 2
    assert (await client.get(base, params={"q": "n.png"}, headers=ADMIN)).json()["total"] == 1
    assert (await client.get(base, params={"status": "failed"}, headers=ADMIN)).json()["total"] == 0
    page = (await client.get(base, params={"limit": 2, "offset": 2}, headers=ADMIN)).json()
    assert len(page["items"]) == 1


async def test_cross_event_photo_access_is_404(client):
    ev1 = await create_event(client, "One")
    ev2 = await create_event(client, "Two")
    r = await upload(client, ev1["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    assert (await client.get(f"/api/v1/events/{ev2['id']}/photos/{pid}", headers=ADMIN)).status_code == 404
    assert (await client.delete(f"/api/v1/events/{ev2['id']}/photos/{pid}", headers=ADMIN)).status_code == 404


async def test_signed_media_urls(client):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    url = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()["thumbnail_url"]
    path = url.replace("http://testserver", "")
    assert (await client.get(path)).status_code == 200
    parsed = urlparse(path)
    q = parse_qs(parsed.query)
    tampered = f"{parsed.path}?exp={q['exp'][0]}&sig=AAAA{q['sig'][0][4:]}"
    assert (await client.get(tampered)).status_code == 403
    expired = f"{parsed.path}?exp=1000&sig={q['sig'][0]}"
    assert (await client.get(expired)).status_code == 403
    other_key = path.replace("thumbnails", "previews").split("?")[0] + "?" + parsed.query
    assert (await client.get(other_key)).status_code == 403  # signature is bound to the key
    assert (await client.get("/media/../../etc/passwd?exp=9999999999&sig=x")).status_code in (403, 404)


async def test_storage_failure_on_upload_returns_503(client, storage, monkeypatch):
    def boom(*a, **k):
        raise StorageError("R2 upload failed: SlowDown")

    monkeypatch.setattr(storage, "put_file", boom)
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "storage_unavailable"


async def test_transient_failure_retries_then_succeeds(client, storage, monkeypatch, settings):
    settings.task_max_retries = 3
    real = storage.download_to
    calls = {"n": 0}

    def flaky(key, dest):
        calls["n"] += 1
        if calls["n"] < 3:
            raise StorageError("R2 download failed: 503")
        return real(key, dest)

    monkeypatch.setattr(storage, "download_to", flaky)
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "indexed" and photo["attempts"] == 3
    assert [j["status"] for j in photo["jobs"]].count("failed") == 2


async def test_permanent_failure_then_manual_retry(client, storage, monkeypatch, settings):
    settings.task_max_retries = 1
    real = storage.download_to
    monkeypatch.setattr(storage, "download_to", lambda k, d: (_ for _ in ()).throw(StorageError("down")))
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "failed" and "Storage error" in photo["error_message"]
    status = (await client.get(f"/api/v1/events/{ev['id']}/status", headers=ADMIN)).json()
    assert status["counts"]["failed"] == 1 and status["recent_failures"][0]["id"] == pid

    monkeypatch.setattr(storage, "download_to", real)
    r = await client.post(f"/api/v1/events/{ev['id']}/photos/retry-failed", headers=ADMIN)
    assert r.status_code == 202 and r.json()["queued"] == 1
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "indexed"
    r = await client.post(f"/api/v1/events/{ev['id']}/photos/{pid}/retry", headers=ADMIN)
    assert r.status_code == 409


async def test_missing_face_model_marks_failed(client, monkeypatch):
    from app.services import indexing
    from app.services.face.engine import FaceModelUnavailableError

    def no_model():
        raise FaceModelUnavailableError("files missing")

    monkeypatch.setattr(indexing, "get_analyzer", no_model)
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    photo = (await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).json()
    assert photo["status"] == "failed" and "Face model unavailable" in photo["error_message"]
    assert photo["attempts"] == 1  # not auto-retried: needs operator action


async def test_indexing_is_idempotent(client):
    from app.services.indexing import index_photo

    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice", "bob"]), "image/png"))
    import uuid

    pid = uuid.UUID(r.json()["items"][0]["photo_id"])
    # Already indexed -> no-op
    assert await index_photo(pid) == "indexed"
    # Force a re-run (e.g. a redelivered task after a crash) -> faces replaced, not duplicated
    async with get_sessionmaker()() as s:
        photo = await s.get(Photo, pid)
        photo.status = "processing"
        await s.commit()
    assert await index_photo(pid) == "indexed"
    async with get_sessionmaker()() as s:
        n = (await s.execute(select(func.count()).select_from(FaceEmbedding)
                             .where(FaceEmbedding.photo_id == pid))).scalar_one()
        jobs = (await s.execute(select(func.count()).select_from(ProcessingJob)
                                .where(ProcessingJob.photo_id == pid))).scalar_one()
    assert n == 2 and jobs == 2


async def test_delete_photo(client, storage):
    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    pid = r.json()["items"][0]["photo_id"]
    assert (await client.delete(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)).status_code == 204
    assert not list(storage.root.rglob(f"{pid}*"))
    async with get_sessionmaker()() as s:
        assert (await s.execute(select(func.count()).select_from(FaceEmbedding))).scalar_one() == 0

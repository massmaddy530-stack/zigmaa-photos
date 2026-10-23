"""Photo workflow hardening: restoring lost originals by re-upload, storage health, storage migration, and
guest-link expiry."""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from botocore.stub import Stubber
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import Settings
from app.db.session import get_sessionmaker
from app.models import Photo
from app.services import storage as storage_mod
from app.services.storage import LocalStorage, StorageError, SupabaseStorage, connection_status
from app.services.storage_migration import collect_items, copy_objects
from tests.conftest import ADMIN, INGEST, create_event, make_image, upload


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _photo(photo_id: str) -> Photo:
    async with get_sessionmaker()() as s:
        return (await s.execute(select(Photo).where(Photo.id == uuid.UUID(photo_id)))).scalar_one()


async def _upload_one(client, ev, data, name="IMG_1.JPG", headers=ADMIN):
    r = await upload(client, ev["id"], (name, data, "image/jpeg"), headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()["items"][0]


# --------------------------------------------------------------------------- restoring lost originals


async def test_reupload_restores_a_missing_original_and_rebuilds_derivatives(client, storage):
    ev = await create_event(client)
    data = make_image(["alice"], fmt="JPEG", seed=1)
    pid = (await _upload_one(client, ev, data))["photo_id"]
    before = await _photo(pid)
    assert before.status.value == "indexed"
    # Simulate an ephemeral disk being wiped: every stored object is gone, the database row survives.
    for key in (before.original_key, before.thumbnail_key, before.preview_key):
        storage.path_for(key).unlink()

    item = await _upload_one(client, ev, data, name="again.jpg")
    assert item["status"] == "duplicate" and item["restored"] is True and item["photo_id"] == pid

    after = await _photo(pid)
    assert after.id == before.id and after.original_key == before.original_key  # same row, same key
    assert after.status.value == "indexed" and after.face_count == 1  # reprocessed (sync task mode)
    assert storage.path_for(after.original_key).read_bytes() == data
    assert storage.exists(after.thumbnail_key) and storage.exists(after.preview_key)
    r = await client.get(f"/api/v1/events/{ev['id']}/photos/{pid}", headers=ADMIN)
    thumb = await client.get(r.json()["thumbnail_url"].replace("http://testserver", ""))
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"


async def test_reupload_of_a_stored_photo_stays_a_plain_duplicate(client, storage):
    ev = await create_event(client)
    data = make_image(["bob"], fmt="JPEG", seed=2)
    pid = (await _upload_one(client, ev, data))["photo_id"]
    before = await _photo(pid)
    r = await upload(client, ev["id"], ("IMG_1.JPG", data, "image/jpeg"))
    assert r.status_code == 200
    assert r.json() == {"created": 0, "duplicates": 1, "rejected": 0, "items": [
        {"filename": "IMG_1.JPG", "status": "duplicate", "photo_id": pid, "error_code": None, "error": None,
         "restored": False}]}
    after = await _photo(pid)
    assert (after.updated_at, after.attempts, after.thumbnail_key) == \
           (before.updated_at, before.attempts, before.thumbnail_key)


async def test_restore_failure_keeps_the_photo_unchanged(client, storage, monkeypatch):
    ev = await create_event(client)
    data = make_image(["carol"], fmt="JPEG", seed=3)
    pid = (await _upload_one(client, ev, data))["photo_id"]
    storage.path_for((await _photo(pid)).original_key).unlink()

    def broken(*a, **k):
        raise StorageError("disk full")

    monkeypatch.setattr(storage, "put_file", broken)
    item = await _upload_one(client, ev, data)
    assert item["status"] == "duplicate" and item["restored"] is False
    assert (await _photo(pid)).status.value == "indexed"  # nothing reset; a later re-upload can try again


async def test_check_hashes_omits_photos_whose_original_is_missing(client, storage):
    ev = await create_event(client)
    kept, lost = make_image(["alice"], seed=10), make_image(["bob"], seed=11)
    await _upload_one(client, ev, kept, name="kept.png")
    lost_id = (await _upload_one(client, ev, lost, name="lost.png"))["photo_id"]
    storage.path_for((await _photo(lost_id)).original_key).unlink()

    r = await client.post(f"/api/v1/events/{ev['id']}/photos/check-hashes",
                          json={"hashes": [_sha(kept), _sha(lost), "0" * 64]}, headers=INGEST)
    assert r.status_code == 200 and r.json() == {"existing": [_sha(kept)]}

    # The agent then re-sends the lost file, which restores it.
    item = await _upload_one(client, ev, lost, name="lost.png", headers=INGEST)
    assert item["restored"] is True
    r = await client.post(f"/api/v1/events/{ev['id']}/photos/check-hashes",
                          json={"hashes": [_sha(lost)]}, headers=INGEST)
    assert r.json() == {"existing": [_sha(lost)]}


async def test_check_hashes_treats_a_storage_outage_as_existing(client, storage, monkeypatch):
    ev = await create_event(client)
    data = make_image(["alice"], seed=12)
    await _upload_one(client, ev, data, name="a.png")

    def down(key):
        raise StorageError("unreachable")

    monkeypatch.setattr(storage, "exists", down)
    r = await client.post(f"/api/v1/events/{ev['id']}/photos/check-hashes", json={"hashes": [_sha(data)]},
                          headers=INGEST)
    assert r.json() == {"existing": [_sha(data)]}


# --------------------------------------------------------------------------- storage health


@pytest.fixture
def fresh_status_cache(monkeypatch):
    monkeypatch.setattr(storage_mod, "_status_cache", None)


async def test_health_reports_storage_connection(client, fresh_status_cache):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["checks"]["storage"] == "local" and r.json()["checks"]["storage_connection"] == "ok"


async def test_health_reports_a_storage_outage_without_details(client, storage, fresh_status_cache, monkeypatch):
    def check():
        raise StorageError("Supabase head failed: AccessDenied secret-ish detail")

    monkeypatch.setattr(storage, "check", check)
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"  # informational, not a restart trigger
    assert r.json()["checks"]["storage_connection"] == "error"
    assert "AccessDenied" not in r.text and "secret" not in r.text


def test_connection_status_is_cached(tmp_path, fresh_status_cache):
    st = LocalStorage(tmp_path / "s", "http://x", "x" * 32, 60)
    calls = []
    st.check = lambda: calls.append(1)
    now = [100.0]
    assert connection_status(st, clock=lambda: now[0]) == "ok"
    assert connection_status(st, clock=lambda: now[0]) == "ok"
    now[0] += 31
    assert connection_status(st, clock=lambda: now[0]) == "ok"
    assert len(calls) == 2


def test_local_check_fails_when_the_directory_is_gone(tmp_path):
    st = LocalStorage(tmp_path / "s", "http://x", "x" * 32, 60)
    st.check()
    (tmp_path / "s").rmdir()
    with pytest.raises(StorageError):
        st.check()


def _supabase() -> SupabaseStorage:
    return SupabaseStorage(Settings(
        _env_file=None, storage_backend="supabase", supabase_project_ref="abcdefghijklmnopqrst",
        supabase_s3_region="ap-south-1", supabase_s3_access_key_id=SecretStr("kid"),
        supabase_s3_secret_access_key=SecretStr("test-secret-DO-NOT-LEAK"), supabase_storage_bucket="b"))


def test_s3_check_and_size():
    st = _supabase()
    with Stubber(st.client) as s:
        s.add_client_error("head_object", "404", http_status_code=404)  # probe key absent: reachable and authorized
        s.add_response("head_object", {"ContentLength": 1234})
        s.add_client_error("head_object", "403", http_status_code=403)
        st.check()
        assert st.size("events/e/originals/p.jpg") == 1234
        with pytest.raises(StorageError) as e:
            st.check()
    assert "DO-NOT-LEAK" not in str(e.value)


# --------------------------------------------------------------------------- storage migration


async def _items(event_id=None):
    async with get_sessionmaker()() as s:
        return await collect_items(s, event_id)


def _tree(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in root.rglob("*") if p.is_file()}


async def test_migration_dry_run_copy_resume_and_rollback_safety(client, storage, tmp_path):
    ev = await create_event(client)
    for i, people in enumerate((["alice"], ["bob"], [])):
        await _upload_one(client, ev, make_image(people, seed=20 + i), name=f"{i}.png")
    await client.put(f"/api/v1/events/{ev['id']}/cover", files={"file": ("c.png", make_image([], seed=30))},
                     headers=ADMIN)
    items = await _items()
    assert sorted({i.kind for i in items}) == ["cover", "original", "preview", "thumbnail"]
    source_before = _tree(storage.root)
    dest = LocalStorage(tmp_path / "bucket", "http://x", "x" * 32, 60)

    dry = copy_objects(items, storage, dest, apply=False)
    assert dry.ok and dry.outcomes == {"would_copy": len(items)} and _tree(dest.root) == {}

    # The destination fails half way through; nothing is lost and a re-run finishes the job.
    real_put, calls = dest.put_file, []

    def flaky(key, fh, ct):
        calls.append(key)
        if len(calls) > len(items) // 2:
            raise StorageError("connection reset")
        real_put(key, fh, ct)

    dest.put_file = flaky
    first = copy_objects(items, storage, dest, apply=True)
    assert not first.ok and first.outcomes["copied"] == len(items) // 2
    dest.put_file = real_put
    second = copy_objects(items, storage, dest, apply=True)
    assert second.ok and second.outcomes == {"already_copied": len(items) // 2,
                                             "copied": len(items) - len(items) // 2}
    third = copy_objects(items, storage, dest, apply=True)
    assert third.outcomes == {"already_copied": len(items)}

    assert _tree(dest.root) == _tree(storage.root) == source_before  # exact copy; source untouched


async def test_migration_reports_missing_and_corrupt_originals(client, storage, tmp_path):
    ev = await create_event(client)
    a = (await _upload_one(client, ev, make_image(["alice"], seed=40), name="a.png"))["photo_id"]
    b = (await _upload_one(client, ev, make_image(["bob"], seed=41), name="b.png"))["photo_id"]
    other = await create_event(client, name="Other")
    await _upload_one(client, other, make_image(["carol"], seed=42), name="c.png")
    storage.path_for((await _photo(a)).original_key).unlink()
    storage.path_for((await _photo(b)).original_key).write_bytes(b"tampered")

    items = await _items(uuid.UUID(ev["id"]))
    assert {i.photo_id for i in items} == {uuid.UUID(a), uuid.UUID(b)}  # --event scopes the copy
    dest = LocalStorage(tmp_path / "bucket", "http://x", "x" * 32, 60)
    report = copy_objects(items, storage, dest, apply=True)
    assert report.missing_originals == [uuid.UUID(a)]
    assert report.outcomes["missing_in_source"] == 1 and report.outcomes["hash_mismatch"] == 1
    assert not report.ok and not dest.exists((await _photo(b)).original_key)
    assert all("tampered" not in e for e in report.errors)


async def test_migration_counts_objects_already_moved_off_a_wiped_disk(client, storage, tmp_path):
    ev = await create_event(client)
    pid = (await _upload_one(client, ev, make_image(["alice"], seed=50), name="a.png"))["photo_id"]
    dest = LocalStorage(tmp_path / "bucket", "http://x", "x" * 32, 60)
    items = await _items()
    assert copy_objects(items, storage, dest, apply=True).ok
    storage.path_for((await _photo(pid)).original_key).unlink()
    report = copy_objects(items, storage, dest, apply=True)
    assert report.ok and report.outcomes == {"already_copied": len(items)} and report.missing_originals == []


# --------------------------------------------------------------------------- guest link expiry


async def _set_expiry(client, ev, value):
    r = await client.patch(f"/api/v1/events/{ev['id']}", json={"guest_link_expires_at": value}, headers=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()


async def _selfie(client, slug):
    return await client.post(f"/api/v1/public/events/{slug}/match",
                             files={"selfie": ("s.jpg", make_image(["alice"], fmt="JPEG", seed=99), "image/jpeg")},
                             data={"consent": "true"})


async def test_guest_link_expiry_lifecycle(client):
    ev = await create_event(client)
    assert ev["guest_link_expires_at"] is None
    await _upload_one(client, ev, make_image(["alice"], seed=60), name="a.png")
    slug = ev["slug"]

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    body = await _set_expiry(client, ev, future)
    assert body["guest_link_expires_at"] is not None
    assert (await client.get(f"/api/v1/public/events/{slug}")).status_code == 200
    assert (await _selfie(client, slug)).json()["total"] == 1

    await _set_expiry(client, ev, (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
    for r in (await client.get(f"/api/v1/public/events/{slug}"), await _selfie(client, slug)):
        assert r.status_code == 404 and r.json()["error"]["code"] == "link_expired"
    qr = await client.get(f"/api/v1/public/events/{slug}/qr.svg")  # the dashboard can still show the QR
    assert qr.status_code == 200

    await _set_expiry(client, ev, None)  # clearing the expiry re-opens the link
    assert (await client.get(f"/api/v1/public/events/{slug}")).status_code == 200


async def test_expired_match_results_cannot_be_paged(client):
    ev = await create_event(client)
    await _upload_one(client, ev, make_image(["alice"], seed=61), name="a.png")
    token = (await _selfie(client, ev["slug"])).json()["match_token"]
    await _set_expiry(client, ev, (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    r = await client.get(f"/api/v1/public/events/{ev['slug']}/matches/{token}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "link_expired"


async def test_expiry_without_timezone_is_utc_and_survives_link_rotation(client):
    ev = await create_event(client)
    naive = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(tzinfo=None, microsecond=0)
    body = await _set_expiry(client, ev, naive.isoformat())
    assert datetime.fromisoformat(body["guest_link_expires_at"]).replace(tzinfo=None) == naive
    rotated = (await client.post(f"/api/v1/events/{ev['id']}/rotate-link", headers=ADMIN)).json()
    assert rotated["slug"] != ev["slug"] and rotated["guest_link_expires_at"] == body["guest_link_expires_at"]
    r = await client.get(f"/api/v1/public/events/{rotated['slug']}")
    assert r.json()["error"]["code"] == "link_expired"
    # Unknown and replaced codes stay indistinguishable from each other.
    old = await client.get(f"/api/v1/public/events/{ev['slug']}")
    assert old.status_code == 404 and old.json()["error"]["code"] == "not_found"


async def test_only_admins_can_set_expiry(client):
    ev = await create_event(client)
    r = await client.patch(f"/api/v1/events/{ev['id']}", json={"guest_link_expires_at": None}, headers=INGEST)
    assert r.status_code in (401, 403)
    r = await client.patch(f"/api/v1/events/{ev['id']}", json={"guest_link_expires_at": "not a date"},
                           headers=ADMIN)
    assert r.status_code == 422

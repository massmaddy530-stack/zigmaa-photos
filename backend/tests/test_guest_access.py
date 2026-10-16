"""Customer QR flow: QR target, original-quality downloads behind signed links, guest-link rotation, event isolation."""

import hashlib
from urllib.parse import parse_qs, urlsplit

from tests.conftest import ADMIN, INGEST, create_event, make_image, upload


async def _match(client, slug, people, seed=999):
    return await client.post(f"/api/v1/public/events/{slug}/match",
                             files={"selfie": ("selfie.jpg", make_image(people, fmt="JPEG", seed=seed), "image/jpeg")},
                             data={"consent": "true"})


def _local(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.path}?{parts.query}"


async def test_qr_encodes_this_events_guest_page(client, settings):
    settings.frontend_base_url = "https://photos.example.com"
    ev = await create_event(client, "QR Party")
    r = await client.get(f"/api/v1/public/events/{ev['slug']}/qr.svg")
    assert r.status_code == 200 and "<svg" in r.text
    assert ev["public_url"] == f"https://photos.example.com/e/{ev['slug']}"
    # The QR (and guest URL) carries only the public code: no internal id, no keys.
    for secret in (ev["id"], settings.admin_api_key.get_secret_value(), settings.ingest_api_key.get_secret_value()):
        assert secret not in ev["public_url"] and secret not in r.text


async def test_guest_download_is_the_original_behind_a_signed_link(client):
    ev = await create_event(client, "Downloads")
    original = make_image(["alice"], fmt="JPEG", seed=11, size=(2400, 1600))
    r = await upload(client, ev["id"], ("DSC01234.JPG", original, "image/jpeg"))
    assert r.json()["items"][0]["status"] == "created"
    body = (await _match(client, ev["slug"], ["alice"])).json()
    [item] = body["items"]
    assert item["thumbnail_url"] and item["preview_url"] and item["download_url"]
    assert len({item["thumbnail_url"], item["preview_url"], item["download_url"]}) == 3

    got = await client.get(_local(item["download_url"]))
    assert got.status_code == 200 and got.headers["content-type"] == "image/jpeg"
    assert hashlib.sha256(got.content).digest() == hashlib.sha256(original).digest()  # full quality, unmodified
    thumb = await client.get(_local(item["thumbnail_url"]))
    assert thumb.status_code == 200 and len(thumb.content) < len(original)  # grid loads small files first

    # Links are signed and expire: tampering or a stale expiry is refused.
    q = parse_qs(urlsplit(item["download_url"]).query)
    path = urlsplit(item["download_url"]).path
    assert (await client.get(f"{path}?exp={q['exp'][0]}&sig=forged")).status_code == 403
    assert (await client.get(f"{path}?exp=1&sig={q['sig'][0]}")).status_code == 403
    assert (await client.get(path)).status_code == 422  # no signature at all


async def test_rotating_the_guest_link_revokes_the_old_qr(client):
    ev = await create_event(client, "Leaky")
    await upload(client, ev["id"], ("a.png", make_image(["alice"], seed=3), "image/png"))
    old = ev["slug"]
    r = await client.post(f"/api/v1/events/{ev['id']}/rotate-link", headers=ADMIN)
    assert r.status_code == 200
    new = r.json()["slug"]
    assert new != old and r.json()["public_url"].endswith(f"/e/{new}") and r.json()["counts"]["total"] == 1
    for path in ("", "/qr.svg"):
        assert (await client.get(f"/api/v1/public/events/{old}{path}")).status_code == 404
    assert (await _match(client, old, ["alice"])).status_code == 404
    assert (await client.get(f"/api/v1/public/events/{new}")).status_code == 200
    assert (await _match(client, new, ["alice"])).json()["total"] == 1


async def test_rotate_link_is_admin_only(client):
    ev = await create_event(client)
    assert (await client.post(f"/api/v1/events/{ev['id']}/rotate-link")).status_code == 401
    assert (await client.post(f"/api/v1/events/{ev['id']}/rotate-link", headers=INGEST)).status_code == 403
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.post(f"/api/v1/events/{missing}/rotate-link", headers=ADMIN)).status_code == 404


async def test_guest_cannot_reach_another_events_photos(client):
    ev_a = await create_event(client, "A")
    ev_b = await create_event(client, "B")
    await upload(client, ev_a["id"], ("a.png", make_image(["bob"], seed=21), "image/png"))
    await upload(client, ev_b["id"], ("b.png", make_image(["bob"], seed=22), "image/png"))
    res_a = (await _match(client, ev_a["slug"], ["bob"])).json()
    res_b = (await _match(client, ev_b["slug"], ["bob"])).json()
    ids_a = {i["photo_id"] for i in res_a["items"]}
    ids_b = {i["photo_id"] for i in res_b["items"]}
    assert len(ids_a) == len(ids_b) == 1 and not ids_a & ids_b
    assert not {i["download_url"] for i in res_a["items"]} & {i["download_url"] for i in res_b["items"]}
    # Event A's results token can't page through event B
    tok = res_a["match_token"]
    assert (await client.get(f"/api/v1/public/events/{ev_b['slug']}/matches/{tok}")).status_code == 404
    # The public endpoints never list the gallery
    assert (await client.get(f"/api/v1/public/events/{ev_a['slug']}/photos")).status_code in (404, 405)
    assert (await client.get(f"/api/v1/events/{ev_a['id']}/photos")).status_code == 401


async def test_invalid_and_archived_guest_codes(client):
    ev = await create_event(client)
    for slug in ("x" * 33, "not-a-real-code", ev["id"]):  # the internal id is not a valid guest code
        assert (await client.get(f"/api/v1/public/events/{slug}")).status_code == 404
    await client.patch(f"/api/v1/events/{ev['id']}", json={"status": "archived"}, headers=ADMIN)
    assert (await client.get(f"/api/v1/public/events/{ev['slug']}")).status_code == 404
    assert (await _match(client, ev["slug"], ["alice"])).status_code == 404


async def test_unicode_camera_filename_is_kept(client):
    ev = await create_event(client)
    name = "Hochzeit_Ü_写真_1.jpg"
    r = await upload(client, ev["id"], (name, make_image(["carol"], fmt="JPEG", seed=5), "image/jpeg"),
                     headers=INGEST)
    assert r.json()["items"][0]["status"] == "created"
    listed = (await client.get(f"/api/v1/events/{ev['id']}/photos", headers=ADMIN)).json()["items"]
    assert [p["original_filename"] for p in listed] == [name]

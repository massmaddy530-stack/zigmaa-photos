from tests.conftest import ADMIN, INGEST, create_event


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["checks"]["database"] == "ok"


async def test_create_and_get_event(client):
    ev = await create_event(client, "  Sharma Wedding ", event_date="2026-11-02", venue="Jaipur",
                            description="Reception")
    assert ev["name"] == "Sharma Wedding"
    assert len(ev["slug"]) == 12
    assert ev["public_url"].endswith(f"/e/{ev['slug']}")
    assert ev["counts"]["total"] == 0

    r = await client.get(f"/api/v1/events/{ev['id']}", headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["venue"] == "Jaipur"


async def test_event_validation(client):
    for payload in ({"name": ""}, {"name": "   "}, {"name": "x" * 201}, {}, {"name": "ok", "event_date": "nope"}):
        r = await client.post("/api/v1/events", json=payload, headers=ADMIN)
        assert r.status_code == 422, payload
        assert r.json()["error"]["code"] == "validation_error"


async def test_list_search_filter_and_paginate(client):
    for i in range(5):
        await create_event(client, f"Event {i}", venue="Goa" if i % 2 else "Pune")
    r = await client.get("/api/v1/events", params={"limit": 2}, headers=ADMIN)
    body = r.json()
    assert body["total"] == 5 and len(body["items"]) == 2
    r = await client.get("/api/v1/events", params={"q": "goa"}, headers=ADMIN)
    assert r.json()["total"] == 2


async def test_update_and_archive(client):
    ev = await create_event(client)
    r = await client.patch(f"/api/v1/events/{ev['id']}", json={"status": "archived", "venue": "Hall B"},
                           headers=ADMIN)
    assert r.status_code == 200
    assert r.json()["status"] == "archived" and r.json()["venue"] == "Hall B"
    r = await client.get("/api/v1/events", params={"status": "archived"}, headers=ADMIN)
    assert r.json()["total"] == 1
    # Archived events are hidden from guests
    r = await client.get(f"/api/v1/public/events/{ev['slug']}")
    assert r.status_code == 404


async def test_auth_required_and_roles(client):
    r = await client.get("/api/v1/events")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
    r = await client.get("/api/v1/events", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    # The ingest key may only upload; it cannot manage events.
    r = await client.post("/api/v1/events", json={"name": "x"}, headers=INGEST)
    assert r.status_code == 403


async def test_unknown_event_404(client):
    r = await client.get("/api/v1/events/00000000-0000-0000-0000-000000000000", headers=ADMIN)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


async def test_public_event_and_qr(client):
    ev = await create_event(client)
    r = await client.get(f"/api/v1/public/events/{ev['slug']}")
    assert r.status_code == 200
    assert r.json()["name"] == "Test Wedding"
    assert "id" not in r.json()  # internal ids are not exposed to guests
    r = await client.get(f"/api/v1/public/events/{ev['slug']}/qr.svg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    assert (await client.get("/api/v1/public/events/doesnotexist")).status_code == 404


async def test_cover_upload(client):
    from tests.conftest import make_image

    ev = await create_event(client)
    r = await client.put(f"/api/v1/events/{ev['id']}/cover", files={"file": ("c.jpg", make_image(fmt="JPEG"),
                                                                              "image/jpeg")}, headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["cover_url"]
    img = await client.get(r.json()["cover_url"].replace("http://testserver", ""))
    assert img.status_code == 200 and img.headers["content-type"] == "image/webp"


async def test_overview(client):
    await create_event(client)
    r = await client.get("/api/v1/dashboard/overview", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert body["events"] == 1 and body["photos"] == 0 and len(body["recent_events"]) == 1


async def test_delete_event_removes_everything(client, storage):
    from tests.conftest import make_image, upload

    ev = await create_event(client)
    r = await upload(client, ev["id"], ("a.png", make_image(["alice"]), "image/png"))
    assert r.status_code == 201
    files_before = list(storage.root.rglob("*.*"))
    assert files_before
    r = await client.delete(f"/api/v1/events/{ev['id']}", headers=ADMIN)
    assert r.status_code == 204
    assert not list(storage.root.rglob("*.*"))
    assert (await client.get(f"/api/v1/events/{ev['id']}", headers=ADMIN)).status_code == 404

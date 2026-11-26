"""Regression tests for security fixes:
- match_selfie_router requires an admin/ingest API key (was previously unauthenticated).
- Event/photo routes enforce per-account ownership via X-User-Email (was previously any API-key holder
  could read/modify/delete any tenant's event by UUID).
"""

from __future__ import annotations

from tests.conftest import ADMIN, INGEST, create_event, make_image


async def test_match_selfie_router_requires_auth(client):
    """/match-selfie and /upload-event-photo must reject unauthenticated requests."""
    ev = await create_event(client)

    r = await client.post("/match-selfie", data={"event_id": ev["id"]})
    assert r.status_code == 401

    r = await client.post("/upload-event-photo", data={"event_id": ev["id"]})
    assert r.status_code == 401

    r = await client.post(f"/api/v1/events/{ev['id']}/match-selfie")
    assert r.status_code == 401


async def test_match_selfie_router_accepts_valid_key(client):
    """A valid admin/ingest key may still call the legacy router (no functional regression)."""
    ev = await create_event(client)
    r = await client.post(
        "/upload-event-photo",
        data={"event_id": ev["id"]},
        files={"file": ("a.jpg", make_image(["alice"], seed=1, fmt="JPEG"), "image/jpeg")},
        headers=ADMIN,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    # The ingest key (upload-only) must also be accepted.
    r = await client.post(
        "/upload-event-photo",
        data={"event_id": ev["id"]},
        files={"file": ("b.jpg", make_image(["bob"], seed=2, fmt="JPEG"), "image/jpeg")},
        headers=INGEST,
    )
    assert r.status_code == 200, r.text


async def test_cross_tenant_event_access_is_blocked(client):
    """A caller authenticated as one account cannot access another account's event by UUID."""
    owner_a = {**ADMIN, "X-User-Email": "alice@studio.test"}
    owner_b = {**ADMIN, "X-User-Email": "bob@studio.test"}

    r = await client.post("/api/v1/events", json={"name": "Alice's Wedding"}, headers=owner_a)
    assert r.status_code == 201, r.text
    event_id = r.json()["id"]

    # Owner can read their own event.
    r = await client.get(f"/api/v1/events/{event_id}", headers=owner_a)
    assert r.status_code == 200

    # A different account cannot read, update or delete it, even with a valid admin key.
    r = await client.get(f"/api/v1/events/{event_id}", headers=owner_b)
    assert r.status_code == 404

    r = await client.patch(f"/api/v1/events/{event_id}", json={"venue": "Hacked"}, headers=owner_b)
    assert r.status_code == 404

    r = await client.delete(f"/api/v1/events/{event_id}", headers=owner_b)
    assert r.status_code == 404

    # Photo routes scoped to the event are likewise blocked for the other account.
    r = await client.get(f"/api/v1/events/{event_id}/photos", headers=owner_b)
    assert r.status_code == 404

    # The event is untouched and still reachable by its real owner.
    r = await client.get(f"/api/v1/events/{event_id}", headers=owner_a)
    assert r.status_code == 200
    assert r.json()["venue"] != "Hacked"


async def test_event_access_without_user_email_header_is_unaffected(client):
    """Callers that don't send X-User-Email (e.g. the ingestion agent, or legacy admin tooling)
    keep working exactly as before: the admin/ingest key alone is sufficient."""
    ev = await create_event(client)
    r = await client.get(f"/api/v1/events/{ev['id']}", headers=ADMIN)
    assert r.status_code == 200

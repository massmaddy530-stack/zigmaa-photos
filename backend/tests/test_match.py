import pytest

from tests.conftest import ADMIN, create_event, make_image, upload


async def _seed(client):
    ev = await create_event(client, "Gala")
    photos = {}
    for i, people in enumerate([["alice"], ["bob"], ["alice", "bob"], ["carol"], [], ["alice", "carol", "dave"]]):
        r = await upload(client, ev["id"], (f"p{i}.png", make_image(people, seed=100 + i), "image/png"))
        photos[tuple(people)] = r.json()["items"][0]["photo_id"]
    return ev, photos


async def _match(client, slug, people, consent=True, fmt="JPEG", **params):
    data = make_image(people, size=(640, 480), fmt=fmt, seed=999)
    return await client.post(f"/api/v1/public/events/{slug}/match", params=params,
                             files={"selfie": ("selfie.jpg", data, "image/jpeg")},
                             data={"consent": "true" if consent else "false"})


async def test_selfie_returns_only_photos_with_that_person(client):
    ev, photos = await _seed(client)
    r = await _match(client, ev["slug"], ["alice"])
    assert r.status_code == 200, r.text
    body = r.json()
    got = {i["photo_id"] for i in body["items"]}
    assert got == {photos[("alice",)], photos[("alice", "bob")], photos[("alice", "carol", "dave")]}
    sims = [i["similarity"] for i in body["items"]]
    assert sims == sorted(sims, reverse=True)
    assert all(s >= body["threshold"] for s in sims)
    assert all(i["thumbnail_url"] and i["preview_url"] for i in body["items"])
    t = body["timings"]
    assert {"validation_ms", "detection_embedding_ms", "vector_search_ms", "serialization_ms", "total_ms"} <= set(t)


async def test_empty_results(client):
    ev, _ = await _seed(client)
    # Delete dave's only photo? Simpler: a fresh event with no matching person.
    ev2 = await create_event(client, "Empty")
    await upload(client, ev2["id"], ("x.png", make_image(["bob"], seed=5), "image/png"))
    r = await _match(client, ev2["slug"], ["carol"])
    assert r.status_code == 200
    assert r.json()["total"] == 0 and r.json()["items"] == [] and r.json()["match_token"] is None


async def test_cross_event_isolation(client):
    ev1 = await create_event(client, "One")
    ev2 = await create_event(client, "Two")
    await upload(client, ev1["id"], ("a1.png", make_image(["alice"], seed=1), "image/png"))
    r2 = await upload(client, ev2["id"], ("a2.png", make_image(["alice"], seed=2), "image/png"))
    p2 = r2.json()["items"][0]["photo_id"]
    r = await _match(client, ev2["slug"], ["alice"])
    assert [i["photo_id"] for i in r.json()["items"]] == [p2]
    # Admin match endpoint is scoped the same way
    r = await client.post(f"/api/v1/events/{ev2['id']}/match", headers=ADMIN,
                          files={"selfie": ("s.jpg", make_image(["alice"], fmt="JPEG", seed=7), "image/jpeg")})
    assert [i["photo_id"] for i in r.json()["items"]] == [p2]
    # A match token from one event cannot be used on another
    tok = r.json()["match_token"]
    r = await client.get(f"/api/v1/public/events/{ev1['slug']}/matches/{tok}")
    assert r.status_code == 404


async def test_no_face_selfie(client):
    ev, _ = await _seed(client)
    r = await _match(client, ev["slug"], [])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "no_face_detected"


async def test_two_face_selfie_searches_both_and_dedupes(client):
    ev, photos = await _seed(client)
    r = await _match(client, ev["slug"], ["alice", "bob"])
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [i["photo_id"] for i in body["items"]]
    assert len(ids) == len(set(ids)) == body["total"]  # the alice+bob photo appears once
    assert set(ids) == {photos[("alice",)], photos[("bob",)], photos[("alice", "bob")],
                        photos[("alice", "carol", "dave")]}
    sims = [i["similarity"] for i in body["items"]]
    assert sims == sorted(sims, reverse=True) and all(s >= body["threshold"] for s in sims)


async def test_group_selfie_rejected(client):
    ev, _ = await _seed(client)
    r = await _match(client, ev["slug"], ["alice", "carol", "dave"])
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "multiple_faces_detected"


async def test_two_face_selfie_stays_in_event(client):
    ev1 = await create_event(client, "One")
    ev2 = await create_event(client, "Two")
    await upload(client, ev1["id"], ("a1.png", make_image(["alice"], seed=1), "image/png"))
    await upload(client, ev1["id"], ("b1.png", make_image(["bob"], seed=2), "image/png"))
    r2 = await upload(client, ev2["id"], ("b2.png", make_image(["bob"], seed=3), "image/png"))
    p2 = r2.json()["items"][0]["photo_id"]
    r = await _match(client, ev2["slug"], ["alice", "bob"])
    assert r.status_code == 200
    assert [i["photo_id"] for i in r.json()["items"]] == [p2]


async def test_multiple_faces_allowed_when_configured(client, settings):
    settings.selfie_require_single_face = False
    ev, _ = await _seed(client)
    r = await _match(client, ev["slug"], ["alice", "bob"])
    assert r.status_code == 200


async def test_invalid_selfie_file(client):
    ev, _ = await _seed(client)
    r = await client.post(f"/api/v1/public/events/{ev['slug']}/match",
                          files={"selfie": ("s.jpg", b"definitely not an image", "image/jpeg")},
                          data={"consent": "true"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "unsupported_format"


async def test_oversized_selfie(client, settings):
    settings.selfie_max_bytes = 2000
    ev, _ = await _seed(client)
    r = await _match(client, ev["slug"], ["alice"], fmt="PNG")
    assert r.status_code == 413


async def test_consent_required(client):
    ev, _ = await _seed(client)
    for people in (["alice"], ["alice", "bob"]):
        r = await _match(client, ev["slug"], people, consent=False)
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "consent_required"


async def test_unknown_or_archived_event(client):
    r = await _match(client, "nosuchevent", ["alice"])
    assert r.status_code == 404
    ev = await create_event(client)
    await client.patch(f"/api/v1/events/{ev['id']}", json={"status": "archived"}, headers=ADMIN)
    assert (await _match(client, ev["slug"], ["alice"])).status_code == 404


async def test_rate_limit(client, settings):
    settings.match_rate_limit = 2
    ev, _ = await _seed(client)
    codes = [(await _match(client, ev["slug"], ["alice"])).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


async def test_pagination_via_match_token(client):
    ev = await create_event(client)
    ids = set()
    for i in range(7):
        r = await upload(client, ev["id"], (f"a{i}.png", make_image(["alice"], seed=i), "image/png"))
        ids.add(r.json()["items"][0]["photo_id"])
    r = await _match(client, ev["slug"], ["alice"], page_size=3)
    body = r.json()
    assert body["total"] == 7 and len(body["items"]) == 3 and body["next_cursor"] == 3
    seen = [i["photo_id"] for i in body["items"]]
    cursor = body["next_cursor"]
    while cursor is not None:
        page = (await client.get(f"/api/v1/public/events/{ev['slug']}/matches/{body['match_token']}",
                                 params={"cursor": cursor, "limit": 3})).json()
        seen += [i["photo_id"] for i in page["items"]]
        cursor = page["next_cursor"]
    assert len(seen) == 7 and set(seen) == ids
    r = await client.get(f"/api/v1/public/events/{ev['slug']}/matches/bogus-token")
    assert r.status_code == 404 and r.json()["error"]["code"] == "match_expired"


async def test_model_unavailable_returns_503(client, monkeypatch):
    from app.services import matching
    from app.services.face.engine import FaceModelUnavailableError

    ev, _ = await _seed(client)

    def no_model():
        raise FaceModelUnavailableError("missing")

    monkeypatch.setattr(matching, "get_analyzer", no_model)
    r = await _match(client, ev["slug"], ["alice"])
    assert r.status_code == 503 and r.json()["error"]["code"] == "face_model_unavailable"


async def test_purge_faces(client):
    ev, _ = await _seed(client)
    r = await client.delete(f"/api/v1/events/{ev['id']}/faces", headers=ADMIN)
    assert r.status_code == 200 and r.json()["deleted_faces"] > 0
    r = await _match(client, ev["slug"], ["alice"])
    assert r.json()["total"] == 0


@pytest.mark.parametrize("threshold,expected", [(0.99, 0), (0.5, 3)])
async def test_threshold_is_configurable(client, settings, threshold, expected):
    ev, _ = await _seed(client)
    settings.match_similarity_threshold = threshold
    r = await _match(client, ev["slug"], ["alice"])
    assert r.json()["total"] == expected

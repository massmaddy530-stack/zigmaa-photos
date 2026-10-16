import json
import uuid

import httpx
import pytest

from tests.conftest import EVENT, INGEST_KEY, FakeBackend, jpeg_bytes
from zigmaa_agent.uploader import FatalUploadError, TransientUploadError, Uploader


def _spool(spool, *payloads, mock=True):
    return [spool.save(p, "cam1", mock=mock) for p in payloads]


def test_successful_upload_uses_ingest_key_event_and_agent_source(make_cfg, make_uploader, backend, spool_files):
    cfg = make_cfg()
    up, spool = make_uploader(cfg)
    stills = _spool(spool, jpeg_bytes((255, 0, 0)), jpeg_bytes((0, 255, 0)))
    assert all(s.path.name.startswith("MOCK_cam1_") for s in stills)

    res = up.flush_once()
    assert (res.created, res.duplicates, res.rejected) == (2, 0, 0)
    assert spool_files(spool, "pending") == [] and len(spool_files(spool, "uploaded")) == 2
    uploads = [r for r in backend.requests if r.url.path.endswith("/photos")]
    assert len(uploads) == 1
    req = uploads[0]
    assert req.url.path == f"/api/v1/events/{EVENT}/photos"  # explicitly selected event only
    assert req.headers["X-API-Key"] == INGEST_KEY and "authorization" not in req.headers
    assert b'name="source"\r\n\r\nagent' in req.content
    assert {k[0] for k in backend.photos} == {str(EVENT)}


def test_event_association_is_per_event_spool(make_cfg, make_uploader, backend, spool_files):
    other = uuid.UUID("99999999-2222-3333-4444-555555555555")
    backend.events.add(str(other))
    up_a, spool_a = make_uploader(make_cfg())
    up_b, spool_b = make_uploader(make_cfg(EVENT_ID=other))
    _spool(spool_a, jpeg_bytes((1, 2, 3)))
    _spool(spool_b, jpeg_bytes((4, 5, 6)))
    assert spool_a.root != spool_b.root
    up_a.flush_once()
    assert {e for e, _ in backend.photos} == {str(EVENT)}  # B's still was not sent to A
    assert len(spool_files(spool_b, "pending")) == 1
    up_b.flush_once()
    assert {e for e, _ in backend.photos} == {str(EVENT), str(other)}
    # identical bytes in different events are separate photos (server de-dup is event-scoped)
    _spool(spool_b, jpeg_bytes((1, 2, 3)))
    assert up_b.flush_once().created == 1


def test_transient_failures_keep_files_pending(make_cfg, make_uploader, backend, spool_files):
    up, spool = make_uploader(make_cfg())
    _spool(spool, jpeg_bytes())
    backend.fail_next = ["connect", 503, 500, 429]
    for _ in range(4):
        with pytest.raises(TransientUploadError):
            up.flush_once()
        assert len(spool_files(spool, "pending")) == 1
    assert up.flush_once().created == 1
    assert spool_files(spool, "pending") == []


def test_lost_response_after_server_stored_does_not_duplicate(make_cfg, make_uploader, backend, spool_files):
    up, spool = make_uploader(make_cfg())
    _spool(spool, jpeg_bytes((9, 9, 9)))
    backend.fail_next = ["timeout_after_store"]
    with pytest.raises(TransientUploadError, match="timed out"):
        up.flush_once()
    assert len(backend.photos) == 1 and len(spool_files(spool, "pending")) == 1
    res = up.flush_once()  # retry: check-hashes finds it, so it is not uploaded again
    assert res.skipped_existing == 1 and res.created == 0
    assert backend.upload_calls == 1 and len(backend.photos) == 1
    assert spool_files(spool, "pending") == []


def test_server_side_duplicate_is_confirmed_not_retried(make_cfg, make_uploader, backend, spool_files):
    up, spool = make_uploader(make_cfg())
    data = jpeg_bytes((7, 7, 7))
    _spool(spool, data, data)  # e.g. a static scene encoded identically twice
    res = up.flush_once()
    assert res.created == 1 and res.duplicates == 1 and len(backend.photos) == 1
    assert spool_files(spool, "pending") == []


def test_corrupt_still_is_moved_to_rejected_with_reason(make_cfg, make_uploader, backend, spool_files):
    up, spool = make_uploader(make_cfg())
    good, bad = jpeg_bytes(), jpeg_bytes()[:200]
    _spool(spool, good, bad)
    res = up.flush_once()
    assert (res.created, res.rejected) == (1, 1)
    rejected = spool_files(spool, "rejected")
    assert len(rejected) == 1
    reason = json.loads((rejected[0].parent / (rejected[0].name + ".json")).read_text())
    assert reason["error_code"] == "corrupt_image"
    _spool(spool, jpeg_bytes()[:100])  # all files rejected -> 422 with item details
    assert up.flush_once().rejected == 1


@pytest.mark.parametrize("setup, match", [
    (lambda b, c: None, "ingest key"),  # wrong key -> 401
    (lambda b, c: b.events.clear(), "not found"),
    (lambda b, c: b.archived.add(str(EVENT)), "archived"),
])
def test_fatal_errors_stop_without_losing_files(make_cfg, backend, setup, match, spool_files):
    key = "wrong-key" if match == "ingest key" else INGEST_KEY
    cfg = make_cfg(INGEST_API_KEY=key)
    from zigmaa_agent.capture import Spool
    spool = Spool(cfg.event_spool)
    up = Uploader(cfg, spool, transport=httpx.MockTransport(backend.handler))
    setup(backend, cfg)
    _spool(spool, jpeg_bytes())
    with pytest.raises(FatalUploadError, match=match):
        up.flush_once()
    assert len(spool_files(spool, "pending")) == 1


def test_check_connection(make_cfg, make_uploader, backend):
    up, _ = make_uploader(make_cfg())
    up.check_connection()
    assert backend.photos == {}  # nothing written
    backend.events.clear()
    with pytest.raises(FatalUploadError, match="not found"):
        up.check_connection()

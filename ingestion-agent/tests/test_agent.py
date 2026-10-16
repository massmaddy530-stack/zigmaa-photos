import json
import logging

import numpy as np
import pytest

from tests.conftest import CAM_PASSWORD, INGEST_KEY, FakeCapture
from zigmaa_agent.agent import Agent, Backoff, RedactingFilter
from zigmaa_agent.sources import MockSource, RtspSource, SourceError


class Clock:
    def __init__(self):
        self.t = 0.0
        self.sleeps = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


class ScriptedSource:
    """Source whose open()/read() outcomes are scripted: True/False for open, arrays or exceptions for read."""

    is_mock = False
    name = "cam1"

    def __init__(self, opens, reads):
        self.opens, self.reads = list(opens), list(reads)
        self.open_calls = 0

    def open(self):
        self.open_calls += 1
        if not self.opens.pop(0):
            raise SourceError("connection refused by 192.168.1.50")

    def read(self):
        item = self.reads.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def close(self):
        pass


def frame(value=100):
    return np.full((48, 64, 3), value, np.uint8)


def _agent(cfg, source, make_uploader, clock):
    uploader, spool = make_uploader(cfg)
    return Agent(cfg, source, uploader, spool, clock=clock, sleep=clock.sleep), spool


def test_backoff_grows_and_caps():
    b = Backoff(1, 8)
    b.rng.random = lambda: 0.5  # no jitter
    assert [round(b.next_delay(), 2) for _ in range(5)] == [1, 2, 4, 8, 8]
    b.reset()
    assert b.next_delay() == 1


def test_failed_connections_back_off_then_connect(make_cfg, make_uploader):
    clock = Clock()
    src = ScriptedSource([False, False, False, True], [frame()])
    agent, spool = _agent(make_cfg(RECONNECT_MIN_S=1, RECONNECT_MAX_S=60), src, make_uploader, clock)
    agent.camera_backoff.rng.random = lambda: 0.5
    assert [agent.ensure_connected() for _ in range(4)] == [False, False, False, True]
    assert clock.sleeps == [1, 2, 4]
    assert agent.status["camera_state"] == "connected" and agent.status["last_camera_error"] is None
    assert agent.capture_once() and len(spool.list_pending()) == 1


def test_reconnect_after_stream_loss_continues_capturing(make_cfg, make_uploader):
    clock = Clock()
    src = ScriptedSource([True, True], [frame(10), SourceError("stream ended"), frame(20)])
    agent, spool = _agent(make_cfg(CAPTURE_INTERVAL_S=1), src, make_uploader, clock)
    assert agent.ensure_connected() and agent.capture_once()
    clock.t += 2
    assert agent.capture_once() is False and agent.connected is False
    assert agent.status["camera_state"] == "reconnecting"
    assert agent.ensure_connected() and agent.capture_once()
    assert agent.stats["reconnects"] == 1 and agent.stats["captures"] == 2
    assert len(spool.list_pending()) == 2


def test_rtsp_reconnect_with_fake_device(make_cfg, make_uploader):
    """The real RtspSource + agent loop against a fake OpenCV device that drops after a few reads."""
    clock = Clock()
    caps = [FakeCapture(fail_after=2), FakeCapture()]
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/stream", CAPTURE_INTERVAL_S=1)
    src = RtspSource(cfg, capture_factory=lambda url: caps.pop(0))
    agent, spool = _agent(cfg, src, make_uploader, clock)
    assert agent.ensure_connected()
    import time
    deadline = time.monotonic() + 5
    while agent.connected and time.monotonic() < deadline:  # reader thread hits the dropped stream
        agent.capture_once()
        clock.t += 2
        time.sleep(0.02)
    assert agent.connected is False
    assert agent.ensure_connected() and agent.capture_once()
    assert agent.stats["reconnects"] == 1
    src.close()


def test_interval_mode_does_not_save_every_frame(make_cfg, make_uploader):
    clock = Clock()
    src = ScriptedSource([True], [frame(i) for i in range(20)])
    agent, spool = _agent(make_cfg(CAPTURE_INTERVAL_S=5), src, make_uploader, clock)
    agent.ensure_connected()
    saved = []
    for _ in range(20):  # 20 frames over 10 seconds
        saved.append(agent.capture_once())
        clock.t += 0.5
    assert sum(saved) == 2 and len(spool.list_pending()) == 2


def test_motion_mode_captures_only_on_change(make_cfg, make_uploader):
    clock = Clock()
    still, moved = frame(0), frame(0)
    moved[:, :40] = 255
    src = ScriptedSource([True], [still, still, still, moved, moved, still])
    agent, spool = _agent(make_cfg(CAPTURE_MODE="motion", MOTION_COOLDOWN_S=0), src, make_uploader, clock)
    agent.ensure_connected()
    results = []
    for _ in range(6):
        results.append(agent.capture_once())
        clock.t += 1
    assert results == [False, False, False, True, False, True]


def test_malformed_frames_are_skipped_not_uploaded(make_cfg, make_uploader):
    clock = Clock()
    bad = [np.zeros((48, 64), np.uint8), np.zeros((4, 4, 3), np.uint8), np.zeros((48, 64, 3), np.float64)]
    src = ScriptedSource([True], bad + [frame()])
    agent, spool = _agent(make_cfg(CAPTURE_INTERVAL_S=1), src, make_uploader, clock)
    agent.ensure_connected()
    assert [agent.capture_once() for _ in range(4)] == [False, False, False, True]
    assert agent.stats["frames_rejected"] == 3 and len(spool.list_pending()) == 1
    assert agent.connected  # a bad frame is not a disconnect


def test_upload_failure_retries_with_backoff_then_succeeds(make_cfg, make_uploader, backend):
    clock = Clock()
    src = ScriptedSource([True], [frame()])
    agent, spool = _agent(make_cfg(), src, make_uploader, clock)
    agent.ensure_connected()
    agent.capture_once()
    backend.fail_next = ["connect", 503]
    assert agent.upload_step() and agent.upload_step()
    assert agent.status["upload_state"] == "retrying" and agent.stats["upload_failures"] == 2
    assert len(clock.sleeps) == 2 and len(spool.list_pending()) == 1
    assert agent.upload_step()
    assert agent.stats["uploaded"] == 1 and agent.status["upload_state"] == "ok"
    assert spool.list_pending() == []


def test_fatal_upload_error_stops_agent(make_cfg, make_uploader, backend):
    clock = Clock()
    agent, spool = _agent(make_cfg(), ScriptedSource([True], [frame()]), make_uploader, clock)
    agent.ensure_connected()
    agent.capture_once()
    backend.archived.add(str(agent.cfg.event_id))
    assert agent.upload_step() is False
    assert agent.stop_event.is_set() and "archived" in agent.fatal
    assert len(spool.list_pending()) == 1  # kept for later


def test_full_run_with_mock_camera(make_cfg, make_uploader, backend):
    cfg = make_cfg(CAPTURE_INTERVAL_S=1, UPLOAD_INTERVAL_S=0.1)
    uploader, spool = make_uploader(cfg)
    agent = Agent(cfg, MockSource(cfg.camera_name, size=(320, 240)), uploader, spool)
    agent._next_capture = 0
    assert agent.run(max_captures=3) == 0
    assert agent.stats["captures"] == 3 and agent.stats["uploaded"] == 3
    assert len(backend.photos) == 3 and spool.list_pending() == []
    status = json.loads((spool.root / "status.json").read_text())
    assert status["mock"] is True and status["uploaded"] == 3 and status["spool"]["pending"] == 0
    assert INGEST_KEY not in (spool.root / "status.json").read_text()


def test_secrets_never_reach_logs(make_cfg, caplog):
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/stream",
                   CAMERA_USERNAME="admin", CAMERA_PASSWORD=CAM_PASSWORD)
    handler = logging.StreamHandler()
    flt = RedactingFilter(cfg.secrets())
    record = logging.LogRecord("x", logging.ERROR, __file__, 1, "opening %s with key %s", (cfg.camera_url(),
                               INGEST_KEY), None)
    flt.filter(record)
    text = handler.format(record)
    assert CAM_PASSWORD not in text and INGEST_KEY not in text and "s3cr3t" not in text
    assert "***" in text

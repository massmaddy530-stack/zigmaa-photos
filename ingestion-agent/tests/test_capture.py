import io
import time

import numpy as np
import pytest
from PIL import Image

from tests.conftest import FakeCapture
from zigmaa_agent.capture import FrameError, MotionDetector, encode_jpeg, validate_frame
from zigmaa_agent.sources import MOCK_LABEL, MockSource, RtspSource, SourceError


@pytest.mark.parametrize("frame", [
    None, b"\xff\xd8garbage", np.zeros((48, 64), np.uint8), np.zeros((48, 64, 4), np.uint8),
    np.zeros((48, 64, 3), np.float32), np.zeros((8, 64, 3), np.uint8),
])
def test_malformed_frames_are_rejected(frame):
    with pytest.raises(FrameError):
        validate_frame(frame)


def test_encode_jpeg_is_valid_and_respects_size_limit():
    frame = np.random.default_rng(0).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    data = encode_jpeg(frame, 90, 10 * 1024 * 1024)
    with Image.open(io.BytesIO(data)) as im:
        assert im.format == "JPEG" and im.size == (640, 480)
    with pytest.raises(FrameError, match="upload limit"):
        encode_jpeg(frame, 90, 2048)


def test_mock_frames_are_labelled_unique_and_change_scene():
    t = [0.0]
    src = MockSource("cam1", scene_seconds=10, clock=lambda: t[0])
    with pytest.raises(SourceError):
        src.read()  # not opened yet
    src.open()
    a, b = src.read(), src.read()
    assert a.shape == (720, 1280, 3) and a.dtype == np.uint8
    assert not np.array_equal(a, b)  # read counter in the banner makes each frame unique
    assert (a[2, 2] == (200, 0, 0)).all()  # red MOCK banner
    t[0] = 25.0
    c = src.read()
    assert np.mean(np.abs(c[100:].astype(int) - a[100:].astype(int))) > 10  # new scene
    assert "MOCK" in MOCK_LABEL


def test_mock_captures_are_distinct_files_even_when_small():
    src = MockSource("cam1", size=(64, 48))
    src.open()
    stills = {encode_jpeg(src.read(), 90, 10**7) for _ in range(5)}
    assert len(stills) == 5  # identical bytes would be skipped as duplicates


def test_mock_image_dir_and_simulated_drop(tmp_path):
    Image.new("RGB", (300, 200), (0, 200, 0)).save(tmp_path / "guest.jpg")
    (tmp_path / "notes.txt").write_text("ignored")
    src = MockSource("cam1", image_dir=tmp_path, drop_every_n_reads=2)
    src.open()
    assert src.read().shape == (200, 300, 3)
    with pytest.raises(SourceError, match="simulated"):
        src.read()
    with pytest.raises(SourceError, match="no .jpg"):
        empty = tmp_path / "empty"
        empty.mkdir()
        MockSource("cam1", image_dir=empty)


def test_motion_detector_triggers_on_change_with_cooldown():
    md = MotionDetector(threshold=0.05, cooldown_s=5)
    still = np.zeros((120, 160, 3), np.uint8)
    moved = still.copy()
    moved[:, :80] = 255
    assert md.update(still, 0) is False  # baseline
    assert md.update(still, 1) is False  # no change
    assert md.update(moved, 2) is True
    assert md.update(still, 3) is False  # changed again but inside the cooldown
    assert md.update(moved, 8) is True
    md.reset()
    assert md.update(still, 20) is False  # after reconnect: new baseline, not motion


def test_rtsp_source_reads_latest_frame_as_rgb(make_cfg):
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/stream")
    cap = FakeCapture()
    src = RtspSource(cfg, capture_factory=lambda url: cap)
    src.open()
    try:
        frame = src.read()
        assert frame.shape == (120, 160, 3) and tuple(frame[0, 0]) == (230, 20, 10)  # BGR -> RGB
    finally:
        src.close()
    assert cap.released


def test_rtsp_failed_connection_reports_safe_message(make_cfg):
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/stream",
                   CAMERA_USERNAME="admin", CAMERA_PASSWORD="hunter2-secret")
    seen = []
    src = RtspSource(cfg, capture_factory=lambda url: seen.append(url) or FakeCapture(opened=False))
    with pytest.raises(SourceError) as exc:
        src.open()
    assert "hunter2-secret" in seen[0]  # credentials reach only the capture library
    assert "hunter2-secret" not in str(exc.value) and "192.168.1.50" in str(exc.value)

    def boom(url):
        raise RuntimeError(f"ffmpeg failed for {url}")
    with pytest.raises(SourceError) as exc:
        RtspSource(cfg, capture_factory=boom).open()
    assert "hunter2-secret" not in str(exc.value)


def test_rtsp_stream_end_and_stale_frames_raise(make_cfg):
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/stream", CAMERA_STALE_AFTER_S="1")
    src = RtspSource(cfg, capture_factory=lambda url: FakeCapture(fail_after=3))
    src.open()
    deadline = time.monotonic() + 5
    with pytest.raises(SourceError, match="stream ended"):
        while time.monotonic() < deadline:
            src.read()
            time.sleep(0.01)
    src.close()
    with pytest.raises(SourceError, match="not connected"):
        src.read()

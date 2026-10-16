import pytest

from tests.conftest import CAM_PASSWORD, INGEST_KEY, private_resolver
from zigmaa_agent.config import ConfigError, is_private_host, load_config, redact_url


def test_missing_required_settings_are_reported_without_values():
    with pytest.raises(ConfigError) as exc:
        load_config({"EVENT_ID": "not-a-uuid"}, env_file=None)
    msg = str(exc.value)
    assert "INGEST_API_KEY is required" in msg and "EVENT_ID is required" in msg


def test_rtsp_requires_private_lan_address(make_cfg):
    public = lambda h, p: [(None, None, None, None, ("8.8.8.8", 0))]  # noqa: E731
    with pytest.raises(ConfigError, match="private LAN address"):
        load_config({"INGEST_API_KEY": "k", "EVENT_ID": "11111111-2222-3333-4444-555555555555",
                     "CAMERA_SOURCE": "rtsp", "CAMERA_RTSP_URL": "rtsp://cam.example.com/stream"},
                    env_file=None, resolve=public)
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50:554/stream1")
    assert cfg.camera_source == "rtsp"
    with pytest.raises(ConfigError, match="rtsp:// URL"):
        make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="http://192.168.1.50/snapshot.jpg")


def test_private_host_detection():
    assert is_private_host("192.168.0.10") and is_private_host("10.1.2.3") and is_private_host("127.0.0.1")
    assert not is_private_host("8.8.8.8")
    assert is_private_host("cam.local", private_resolver)
    assert not is_private_host("unresolvable.invalid", lambda h, p: (_ for _ in ()).throw(OSError()))


def test_credentials_are_encoded_into_url_but_never_described(make_cfg):
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50:554/Streaming/Channels/101",
                   CAMERA_USERNAME="admin", CAMERA_PASSWORD=CAM_PASSWORD)
    assert cfg.camera_url() == "rtsp://admin:s3cr3t-cam-pa%24%24@192.168.1.50:554/Streaming/Channels/101"
    text = str(cfg.describe()) + repr(cfg)
    assert CAM_PASSWORD not in text and INGEST_KEY not in text and "admin" not in text
    assert cfg.describe()["credentials"] == "set"
    assert CAM_PASSWORD in cfg.secrets() and INGEST_KEY in cfg.secrets()


def test_credentials_in_url_are_redacted(make_cfg):
    url = f"rtsp://admin:{CAM_PASSWORD}@192.168.1.50/stream"
    assert redact_url(url) == "rtsp://***@192.168.1.50/stream"
    cfg = make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL=url)
    assert CAM_PASSWORD not in str(cfg.describe()) and CAM_PASSWORD in cfg.secrets()
    with pytest.raises(ConfigError, match="not both"):
        make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL=url, CAMERA_USERNAME="x")


def test_invalid_numbers_and_modes(make_cfg):
    with pytest.raises(ConfigError) as exc:
        make_cfg(CAPTURE_INTERVAL_S="0", CAPTURE_MODE="video", UPLOAD_BATCH_SIZE="500", CAMERA_NAME="bad name")
    msg = str(exc.value)
    for key in ("CAPTURE_INTERVAL_S", "CAPTURE_MODE", "UPLOAD_BATCH_SIZE", "CAMERA_NAME"):
        assert key in msg

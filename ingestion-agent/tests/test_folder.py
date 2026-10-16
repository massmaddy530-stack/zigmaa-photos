"""Folder source: discovery, stability, filtering, de-duplication, restart recovery, errors and the full agent loop.
Everything runs in temporary folders against the fake backend."""

import hashlib
import io
import os
import threading
import time

import pytest
from PIL import Image

from tests.conftest import jpeg_bytes
from zigmaa_agent.agent import Agent
from zigmaa_agent.capture import Spool, SpoolLock, SpoolLockedError, upload_name
from zigmaa_agent.config import ConfigError
from zigmaa_agent.folder import FolderSource, check_complete, is_candidate_name
from zigmaa_agent.sources import SourceError, build_source


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def png_bytes(color=(10, 200, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def watch(tmp_path):
    d = tmp_path / "EventPhotos"
    d.mkdir()
    return d


@pytest.fixture
def folder_cfg(make_cfg, watch):
    def _make(**overrides):
        env = {"CAMERA_SOURCE": "folder", "WATCH_FOLDER": str(watch), "FILE_STABLE_SECONDS": "2",
               "FOLDER_POLL_INTERVAL_S": "0.2"}
        env.update(overrides)
        return make_cfg(**env)
    return _make


def _source(cfg, clock=None):
    spool = Spool(cfg.event_spool)
    src = FolderSource(cfg, spool, clock=clock or Clock())
    src.open()
    return src, spool


def _settle(src, clock, polls=2, step=3.0):
    """Poll until files are stable: first sighting, then again after the stable period."""
    out = []
    for _ in range(polls):
        out += src.poll()
        clock.t += step
    return out + src.poll()


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --------------------------------------------------------------------------- config


def test_folder_config_validation(make_cfg, watch, tmp_path):
    with pytest.raises(ConfigError, match="WATCH_FOLDER is required"):
        make_cfg(CAMERA_SOURCE="folder")
    with pytest.raises(ConfigError, match="must not contain each other"):
        make_cfg(CAMERA_SOURCE="folder", WATCH_FOLDER=str(tmp_path))  # spool is tmp_path/spool
    with pytest.raises(ConfigError, match="'mock', 'rtsp' or 'folder'"):
        make_cfg(CAMERA_SOURCE="usb")
    cfg = make_cfg(CAMERA_SOURCE="folder", WATCH_FOLDER=str(watch), FOLDER_RECURSIVE="true",
                   FOLDER_POLL_INTERVAL_S="5", FILE_STABLE_SECONDS="4")
    assert cfg.is_folder and not cfg.is_mock and cfg.folder_recursive
    assert (cfg.folder_poll_interval_s, cfg.file_stable_seconds) == (5, 4)
    assert cfg.describe()["watch_folder"] == str(watch)
    # Missing folder is allowed at config time (a card or share may appear later)
    assert make_cfg(CAMERA_SOURCE="folder", WATCH_FOLDER=str(tmp_path / "later")).is_folder


def test_existing_modes_unaffected_by_folder_settings(make_cfg, watch):
    cfg = make_cfg(WATCH_FOLDER=str(watch))
    assert cfg.is_mock and not cfg.is_folder
    assert make_cfg(CAMERA_SOURCE="rtsp", CAMERA_RTSP_URL="rtsp://192.168.1.50/s").camera_source == "rtsp"


# --------------------------------------------------------------------------- discovery & filtering


def test_candidate_names():
    ok = ["DSC01234.JPG", "img.jpeg", "IMG_0001.jpg", "photo 1.JPG", "Hochzeit Ü 写真.jpg", "a.png"]
    bad = ["DSC01234.ARW", "IMG_0001.CR3", "x.NEF", "notes.txt", "~$tmp.jpg", ".hidden.jpg", "._DSC1.JPG",
           "DSC1.JPG.part", "DSC1.tmp", "dl.jpg.crdownload", "Thumbs.db", "$x.jpg", "noext"]
    assert all(is_candidate_name(n, True) for n in ok)
    assert not any(is_candidate_name(n, True) for n in bad)
    assert not is_candidate_name("a.png", include_png=False)


def test_non_recursive_and_recursive_discovery(folder_cfg, watch):
    (watch / "sub").mkdir()
    (watch / "top.jpg").write_bytes(jpeg_bytes((1, 1, 1)))
    (watch / "sub" / "deep.jpg").write_bytes(jpeg_bytes((2, 2, 2)))
    clock = Clock()
    cfg = folder_cfg(FOLDER_INCLUDE_EXISTING="true")
    src, _ = _source(cfg, clock)
    assert [upload_name(s.path) for s in _settle(src, clock)] == ["top.jpg"]

    cfg_r = folder_cfg(FOLDER_INCLUDE_EXISTING="true", FOLDER_RECURSIVE="true", SPOOL_DIR=str(watch.parent / "s2"))
    src_r, _ = _source(cfg_r, clock)
    assert sorted(upload_name(s.path) for s in _settle(src_r, clock)) == ["deep.jpg", "top.jpg"]


def test_unsupported_temporary_and_hidden_files_are_ignored(folder_cfg, watch):
    for name in ("DSC1.ARW", "notes.txt", "DSC2.JPG.part", "~DSC3.jpg", ".DSC4.jpg", "DSC5.tmp"):
        (watch / name).write_bytes(jpeg_bytes())
    clock = Clock()
    src, spool = _source(folder_cfg(), clock)
    (watch / "real.JPG").write_bytes(jpeg_bytes((5, 5, 5)))
    assert [upload_name(s.path) for s in _settle(src, clock)] == ["real.jpg"]


def test_png_optional(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(FOLDER_INCLUDE_PNG="false"), clock)
    (watch / "a.png").write_bytes(png_bytes())
    assert _settle(src, clock) == []
    clock2 = Clock()
    src2, spool2 = _source(folder_cfg(SPOOL_DIR=str(watch.parent / "s2")), clock2)
    (watch / "b.png").write_bytes(png_bytes((1, 2, 3)))
    got = _settle(src2, clock2)
    assert [s.path.suffix for s in got] == [".png"] and len(spool2.list_pending()) == 1


# --------------------------------------------------------------------------- stability & completeness


def test_file_is_taken_only_after_it_stops_changing(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(FILE_STABLE_SECONDS="2"), clock)
    data = jpeg_bytes((9, 9, 9), size=(400, 300))
    f = watch / "DSC0001.JPG"
    f.write_bytes(data[:100])  # copy in progress
    assert src.poll() == []
    clock.t += 5
    with open(f, "ab") as fh:  # still growing
        fh.write(data[100:400])
    assert src.poll() == []
    clock.t += 1
    with open(f, "ab") as fh:
        fh.write(data[400:])
    assert src.poll() == []  # changed again: the stable timer restarts
    clock.t += 1
    assert src.poll() == []  # unchanged, but only 1s of the 2s stable period has passed
    clock.t += 1.5
    got = src.poll()
    assert len(got) == 1 and got[0].path.read_bytes() == data
    assert src.stats.files_spooled == 1


def test_truncated_image_is_never_uploaded_then_completed_file_is(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(FILE_STABLE_SECONDS="1"), clock)
    data = jpeg_bytes((3, 4, 5), size=(300, 200))
    f = watch / "cut.jpg"
    f.write_bytes(data[:-50])  # stalled copy: no JPEG end marker
    for _ in range(12):
        assert src.poll() == []
        clock.t += 1.5
    assert src.stats.skipped_invalid == 1 and spool.list_pending() == []
    f.write_bytes(data)  # the copy is finished later
    os.utime(f, ns=(time.time_ns(), time.time_ns() + 10**9))
    assert len(_settle(src, clock)) == 1


def test_check_complete():
    assert check_complete(jpeg_bytes()) == ".jpg"
    assert check_complete(png_bytes()) == ".png"
    for bad in (jpeg_bytes()[:-10], png_bytes()[:-12], b"GIF89a....", b""):
        with pytest.raises(ValueError):
            check_complete(bad)


def test_locked_file_is_retried_later(folder_cfg, watch, monkeypatch):
    import builtins

    clock = Clock()
    src, spool = _source(folder_cfg(FILE_STABLE_SECONDS="0"), clock)
    f = watch / "locked.jpg"
    f.write_bytes(jpeg_bytes((7, 1, 1)))
    real_open = builtins.open
    locked = {"on": True}

    def fake_open(path, mode="r", *a, **kw):
        if locked["on"] and os.fspath(path) == os.fspath(f):
            raise PermissionError(13, "The process cannot access the file because it is being used")
        return real_open(path, mode, *a, **kw)

    monkeypatch.setattr(builtins, "open", fake_open)
    assert src.poll() == [] and src.poll() == [] and src.poll() == []
    assert src.stats.locked_or_unreadable >= 1 and src.stats.waiting == 1
    locked["on"] = False
    assert len(src.poll()) == 1


def test_large_file_is_skipped(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(MAX_UPLOAD_BYTES="2048"), clock)
    (watch / "huge.jpg").write_bytes(jpeg_bytes(size=(800, 600)) + b"\0" * 4096)
    assert _settle(src, clock) == [] and src.stats.skipped_too_large == 1


# --------------------------------------------------------------------------- originals, names, duplicates


def test_originals_are_never_modified_and_bytes_are_preserved(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(), clock)
    f = watch / "DSC09999.JPG"
    data = jpeg_bytes((120, 30, 200), size=(320, 240))
    f.write_bytes(data)
    before = (f.stat().st_size, f.stat().st_mtime_ns, _sha(f))
    [still] = _settle(src, clock)
    assert (f.stat().st_size, f.stat().st_mtime_ns, _sha(f)) == before  # untouched
    assert still.path.read_bytes() == data  # no re-encoding: original quality
    assert sorted(p.name for p in watch.iterdir()) == ["DSC09999.JPG"]  # nothing added/removed in the camera folder


def test_unicode_and_space_filenames(folder_cfg, watch, make_uploader, backend):
    clock = Clock()
    cfg = folder_cfg()
    src, _ = _source(cfg, clock)
    name = "Hochzeit Ü 写真 #1 (copy).JPG"
    (watch / name).write_bytes(jpeg_bytes((1, 99, 1)))
    [still] = _settle(src, clock)
    assert upload_name(still.path) == "Hochzeit_Ü_写真_1_copy.jpg"
    uploader, _ = make_uploader(cfg)
    assert uploader.flush_once().created == 1
    req = [r for r in backend.requests if r.url.path.endswith("/photos")][0]
    assert "Hochzeit_Ü_写真_1_copy.jpg".encode() in req.content and b"image/jpeg" in req.content


def test_identical_files_are_spooled_once(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(FOLDER_RECURSIVE="true"), clock)
    data = jpeg_bytes((50, 60, 70))
    (watch / "a.jpg").write_bytes(data)
    (watch / "copy").mkdir()
    (watch / "copy" / "a (1).jpg").write_bytes(data)  # transfer software made a second copy
    assert len(_settle(src, clock)) == 1
    assert src.stats.skipped_duplicate == 1 and len(spool.list_pending()) == 1


# --------------------------------------------------------------------------- restart & first-run behaviour


def test_existing_photos_skipped_on_first_run_but_new_ones_after_restart_are_taken(folder_cfg, watch):
    (watch / "old_event.jpg").write_bytes(jpeg_bytes((11, 11, 11)))
    clock = Clock()
    cfg = folder_cfg()
    src, spool = _source(cfg, clock)
    assert _settle(src, clock) == [] and src.stats.skipped_existing_at_start == 1
    (watch / "new1.jpg").write_bytes(jpeg_bytes((12, 12, 12)))
    assert [upload_name(s.path) for s in _settle(src, clock)] == ["new1.jpg"]

    # Agent stopped; a photo arrives while it is down; agent restarts with the same spool.
    (watch / "while_down.jpg").write_bytes(jpeg_bytes((13, 13, 13)))
    src2, _ = _source(cfg, Clock())
    clock2 = src2.clock
    got = [upload_name(s.path) for s in _settle(src2, clock2)]
    assert got == ["while_down.jpg"]  # not old_event.jpg, not new1.jpg again
    assert len(spool.list_pending()) == 2


def test_include_existing_uploads_photos_already_present(folder_cfg, watch):
    (watch / "before.jpg").write_bytes(jpeg_bytes((21, 21, 21)))
    clock = Clock()
    src, _ = _source(folder_cfg(FOLDER_INCLUDE_EXISTING="true"), clock)
    assert [upload_name(s.path) for s in _settle(src, clock)] == ["before.jpg"]


def test_ledger_survives_a_torn_last_line(folder_cfg, watch):
    clock = Clock()
    cfg = folder_cfg()
    src, spool = _source(cfg, clock)
    (watch / "a.jpg").write_bytes(jpeg_bytes((31, 31, 31)))
    assert len(_settle(src, clock)) == 1
    with open(src.ledger_path, "a", encoding="utf-8") as fh:
        fh.write('{"key": "trunc')  # crash mid-write
    src2, _ = _source(cfg, Clock())
    assert _settle(src2, src2.clock) == []


def test_modified_photo_is_taken_again(folder_cfg, watch):
    clock = Clock()
    src, spool = _source(folder_cfg(), clock)
    f = watch / "edit.jpg"
    f.write_bytes(jpeg_bytes((40, 40, 40)))
    assert len(_settle(src, clock)) == 1
    f.write_bytes(jpeg_bytes((41, 90, 41), size=(80, 60)))  # photographer re-exported it
    assert len(_settle(src, clock)) == 1 and len(spool.list_pending()) == 2


# --------------------------------------------------------------------------- errors


def test_missing_folder_reports_and_recovers(folder_cfg, watch, make_uploader):
    missing = watch.parent / "CardNotInserted"
    cfg = folder_cfg(WATCH_FOLDER=str(missing))
    uploader, spool = make_uploader(cfg)
    src = build_source(cfg, spool)
    sleeps = []
    agent = Agent(cfg, src, uploader, spool, sleep=sleeps.append)
    assert agent.ensure_connected() is False
    assert "does not exist" in agent.status["last_camera_error"] and agent.status["camera_state"] == "reconnecting"
    assert len(sleeps) == 1  # backed off
    missing.mkdir()
    assert agent.ensure_connected() is True and agent.status["camera_state"] == "connected"
    # Folder disappears mid-event (card removed / share offline): reported, then reconnected
    missing.rmdir()
    assert agent.ingest_once() == 0 and agent.connected is False
    assert "no longer available" in agent.status["last_camera_error"]


def test_permission_error_is_reported(folder_cfg, watch, monkeypatch, make_uploader):
    cfg = folder_cfg()
    _, spool = make_uploader(cfg)
    src = FolderSource(cfg, spool)

    def denied(path):
        raise PermissionError(13, "Access is denied", str(path))

    monkeypatch.setattr("zigmaa_agent.folder.os.scandir", denied)
    with pytest.raises(SourceError, match="no permission"):
        src.open()


def test_build_source_requires_spool(folder_cfg):
    with pytest.raises(SourceError):
        build_source(folder_cfg())


# --------------------------------------------------------------------------- spool lock / concurrency


def test_only_one_agent_per_event_spool(tmp_path):
    a, b = SpoolLock(tmp_path), SpoolLock(tmp_path)
    a.acquire()
    with pytest.raises(SpoolLockedError):
        b.acquire()
    a.release()
    with b:
        pass  # free again after release


# --------------------------------------------------------------------------- full agent loop


def test_full_run_folder_mode_uploads_each_photo_once(folder_cfg, watch, make_uploader, backend):
    cfg = folder_cfg(FILE_STABLE_SECONDS="0", FOLDER_POLL_INTERVAL_S="0.2", UPLOAD_INTERVAL_S="0.1",
                     FOLDER_INCLUDE_EXISTING="true")
    uploader, spool = make_uploader(cfg)
    agent = Agent(cfg, build_source(cfg, spool), uploader, spool)
    originals = {}
    for i, name in enumerate(["DSC00001.JPG", "DSC00002.JPG", "café 3.jpg"]):
        (watch / name).write_bytes(jpeg_bytes((i * 40, 10, 10), size=(120, 90)))
        originals[name] = _sha(watch / name)
    assert agent.run(max_captures=3) == 0
    assert agent.stats["captures"] == 3 and agent.stats["uploaded"] == 3
    assert len(backend.photos) == 3 and spool.list_pending() == []
    assert {n: _sha(watch / n) for n in originals} == originals  # originals intact
    status = (spool.root / "status.json").read_text(encoding="utf-8")
    assert '"mode": "folder"' in status and '"files_spooled": 3' in status

    # Restart: nothing is uploaded twice
    uploader2, spool2 = make_uploader(cfg)
    agent2 = Agent(cfg, build_source(cfg, spool2), uploader2, spool2)
    assert agent2.run(duration_s=1.0) == 0
    assert agent2.stats["captures"] == 0 and backend.upload_calls == 1


def test_interrupted_upload_recovers_after_restart(folder_cfg, watch, make_uploader, backend):
    cfg = folder_cfg(FILE_STABLE_SECONDS="0")
    uploader, spool = make_uploader(cfg)
    clock = Clock()
    src = FolderSource(cfg, spool, clock=clock)
    src.open()
    (watch / "a.jpg").write_bytes(jpeg_bytes((70, 0, 0)))
    (watch / "b.jpg").write_bytes(jpeg_bytes((0, 70, 0)))
    assert len(_settle(src, clock)) == 2
    backend.fail_next = ["timeout_after_store"]  # stored on the server, but the response is lost
    from zigmaa_agent.uploader import TransientUploadError

    with pytest.raises(TransientUploadError):
        uploader.flush_once()
    assert len(spool.list_pending()) == 2  # nothing lost; agent "crashes" here
    uploader2, spool2 = make_uploader(cfg)  # restart
    res = uploader2.flush_once()
    assert res.skipped_existing == 2 and res.created == 0
    assert len(backend.photos) == 2 and spool2.list_pending() == []


def test_safe_shutdown_keeps_pending_and_stops_quickly(folder_cfg, watch, make_uploader, backend):
    cfg = folder_cfg(FILE_STABLE_SECONDS="0", RECONNECT_MIN_S="30", RECONNECT_MAX_S="60",
                     FOLDER_INCLUDE_EXISTING="true")
    uploader, spool = make_uploader(cfg)
    backend.fail_next = ["connect"] * 100  # backend down the whole time
    agent = Agent(cfg, build_source(cfg, spool), uploader, spool)
    (watch / "keep.jpg").write_bytes(jpeg_bytes((90, 90, 0)))
    t = threading.Thread(target=agent.run)
    t.start()
    deadline = time.monotonic() + 5
    while not agent.stats["upload_failures"] and time.monotonic() < deadline:
        time.sleep(0.05)
    assert agent.stats["upload_failures"] >= 1  # now inside a 30s+ upload backoff
    started = time.monotonic()
    agent.stop_event.set()  # what Ctrl+C / shutdown does
    t.join(timeout=10)
    assert not t.is_alive() and time.monotonic() - started < 5
    assert len(spool.list_pending()) == 1  # kept for the next run, never deleted
    assert (watch / "keep.jpg").exists()

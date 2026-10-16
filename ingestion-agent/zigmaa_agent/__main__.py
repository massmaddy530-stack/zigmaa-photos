"""Command line:  python -m zigmaa_agent check | run [--max-captures N] [--duration SECONDS]"""

from __future__ import annotations

import argparse
import logging
import sys

from zigmaa_agent.agent import Agent, RedactingFilter
from zigmaa_agent.capture import Spool, SpoolLock, SpoolLockedError, encode_jpeg
from zigmaa_agent.config import AgentConfig, ConfigError, load_config
from zigmaa_agent.sources import SourceError, build_source
from zigmaa_agent.uploader import FatalUploadError, TransientUploadError, Uploader


def _setup_logging(cfg: AgentConfig | None, verbose: bool) -> None:
    if hasattr(sys.stdout, "reconfigure"):  # Unicode filenames must not break logging on a cp1252 console
        sys.stdout.reconfigure(errors="backslashreplace")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%H:%M:%S"))
    if cfg is not None:
        handler.addFilter(RedactingFilter(cfg.secrets()))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # request lines are noisy


def cmd_check(cfg: AgentConfig) -> int:
    log = logging.getLogger("check")
    log.info("config OK: %s", cfg.describe())
    spool = Spool(cfg.event_spool)
    uploader = Uploader(cfg, spool)
    ok = True
    try:
        uploader.check_connection()
        log.info("backend OK: reachable, ingest key accepted, event %s exists", cfg.event_id)
    except (FatalUploadError, TransientUploadError) as exc:
        log.error("backend check FAILED: %s", exc)
        ok = False
    finally:
        uploader.close()
    if cfg.is_folder:
        ok = _check_folder(cfg, spool, log) and ok
        return _check_done(spool, log, ok)
    source = build_source(cfg)
    try:
        source.open()
        frame = source.read()
        size = len(encode_jpeg(frame, cfg.jpeg_quality, cfg.max_upload_bytes))
        log.info("camera OK: %s delivered a %dx%d frame (%d KB as JPEG)%s", cfg.camera_name, frame.shape[1],
                 frame.shape[0], size // 1024, " [MOCK source - no real camera tested]" if cfg.is_mock else "")
    except Exception as exc:  # noqa: BLE001
        log.error("camera check FAILED: %s", exc if isinstance(exc, SourceError) else type(exc).__name__)
        ok = False
    finally:
        source.close()
    return _check_done(spool, log, ok)


def _check_folder(cfg: AgentConfig, spool: Spool, log: logging.Logger) -> bool:
    from zigmaa_agent.folder import FolderSource

    source = FolderSource(cfg, spool)
    if not cfg.watch_folder.is_dir():
        log.error("folder check FAILED: watch folder %s does not exist or is not a folder", cfg.watch_folder)
        return False
    try:
        info = source.summary()
    except OSError as exc:
        log.error("folder check FAILED: cannot read %s (%s)", cfg.watch_folder, exc.strerror or type(exc).__name__)
        return False
    log.info("folder OK: %s readable, %d JPEG%s file(s) found%s, %d already handled by earlier runs",
             cfg.watch_folder, info["supported_files"], "/PNG" if cfg.folder_include_png else "",
             " (including subfolders)" if cfg.folder_recursive else "", info["already_handled"])
    if info["first_run"] and info["supported_files"]:
        log.warning("first run for this event: the %d photo(s) already in the folder will be %s "
                    "(FOLDER_INCLUDE_EXISTING=%s)", info["supported_files"], info["existing_will_be"],
                    str(cfg.folder_include_existing).lower())
    return True


def _check_done(spool: Spool, log: logging.Logger, ok: bool) -> int:
    pending = spool.counts()["pending"]
    if pending:
        log.info("%d still(s) are pending upload from a previous run; 'run' will upload them first", pending)
    log.info("check %s (nothing was uploaded)", "PASSED" if ok else "FAILED")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="zigmaa_agent", description="Zigmaa Photos camera ingestion agent")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="validate config, backend access and the camera; uploads nothing")
    run = sub.add_parser("run", help="capture and upload until Ctrl+C")
    run.add_argument("--max-captures", type=int, help="stop after this many stills / new folder photos (testing)")
    run.add_argument("--duration", type=float, help="stop after this many seconds (testing)")
    args = parser.parse_args(argv)

    try:
        cfg = load_config()
    except ConfigError as exc:
        _setup_logging(None, args.verbose)
        logging.getLogger("config").error("%s", exc)
        return 2
    _setup_logging(cfg, args.verbose)
    if args.command == "check":
        return cmd_check(cfg)

    log = logging.getLogger("agent")
    log.info("starting: %s", cfg.describe())
    if cfg.is_mock:
        log.warning("MOCK camera source: stills are synthetic test images labelled 'MOCK CAPTURE' (files MOCK_*.jpg)")
    spool = Spool(cfg.event_spool)
    lock = SpoolLock(cfg.event_spool)
    try:
        lock.acquire()
    except SpoolLockedError as exc:
        log.error("%s; stop the other agent first (only one agent may upload an event's spool)", exc)
        return 2
    other = [p.name for p in cfg.spool_dir.iterdir() if p.is_dir() and p != cfg.event_spool
             and (p / "pending").is_dir() and Spool(p).list_pending(1)] if cfg.spool_dir.exists() else []
    if other:
        log.warning("pending stills for other event(s) %s are NOT uploaded (set EVENT_ID to that event to send them)",
                    ", ".join(other))
    try:
        try:
            source = build_source(cfg, spool)
        except SourceError as exc:
            log.error("%s", exc)
            return 2
        agent = Agent(cfg, source, Uploader(cfg, spool), spool)
        return agent.run(max_captures=args.max_captures, duration_s=args.duration)
    finally:
        lock.release()


if __name__ == "__main__":
    sys.exit(main())

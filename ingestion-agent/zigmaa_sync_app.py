"""Zigmaa Photos - Standalone Camera Auto Sync Agent.

Executable entry point for field cameramen (Sony FX3, Canon, Nikon Wi-Fi FTP, folder ingestion).
Allows double-clicking without requiring Python or terminal setup.
"""

from __future__ import annotations

import logging
import os
import re
import socket
import sys
import threading
import time
from pathlib import Path

# Configure logging early
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("zigmaa.sync")


def get_local_ip() -> str:
    """Detect the local Wi-Fi / LAN IP address of this computer."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "192.168.1.29"


def resolve_event_id(raw_input: str, api_base: str) -> str:
    """Extract UUID from raw input or resolve from guest slug / dashboard URL."""
    raw = raw_input.strip()
    if not raw:
        return "100b1ef3-ccf3-4c24-8aca-16df4f6f6a63"

    # 1. Direct UUID match (36 chars)
    uuid_match = re.search(
        r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
        raw,
        re.I,
    )
    if uuid_match:
        return uuid_match.group(0)

    # 2. Guest URL or slug (/e/...)
    slug_match = re.search(r"/e/([A-Za-z0-9_-]+)", raw)
    slug = slug_match.group(1) if slug_match else raw.strip("/").split("/")[-1]

    # Try resolving via public API
    try:
        import httpx
        url = f"{api_base.rstrip('/')}/api/v1/public/events/{slug}/resolve"
        resp = httpx.get(url, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            if "id" in data:
                logger.info("Resolved event '%s' -> %s", data.get("name", slug), data["id"])
                return data["id"]
    except Exception as e:
        logger.debug("Could not resolve slug '%s': %s", slug, e)

    return raw


def run_ftp_server(watch_dir: Path, port: int = 21):
    """Start pyftpdlib FTP server in a background thread."""
    from pyftpdlib.authorizers import DummyAuthorizer
    from pyftpdlib.handlers import FTPHandler
    from pyftpdlib.servers import FTPServer

    watch_dir.mkdir(parents=True, exist_ok=True)
    authorizer = DummyAuthorizer()
    # Read/write permissions for incoming camera photos
    authorizer.add_anonymous(str(watch_dir), perm="elradfmwMT")
    authorizer.add_user("sony", "sony", str(watch_dir), perm="elradfmwMT")
    authorizer.add_user("camera", "camera", str(watch_dir), perm="elradfmwMT")

    handler = FTPHandler
    handler.authorizer = authorizer
    handler.banner = "Zigmaa Photos Camera Receiver Ready"
    handler.passive_ports = range(60000, 60050)

    chosen_port = port
    server: FTPServer | None = None
    try:
        server = FTPServer(("0.0.0.0", chosen_port), handler)
    except Exception as e:
        logger.warning("Port %d busy or restricted (%s), falling back to 2121", chosen_port, e)
        chosen_port = 2121
        server = FTPServer(("0.0.0.0", chosen_port), handler)

    local_ip = get_local_ip()
    print()
    print("=" * 65)
    print("      ZIGMAA PHOTOS — CAMERA WI-FI FTP RECEIVER ACTIVE")
    print("=" * 65)
    print(f"  Target Folder : {watch_dir}")
    print(f"  Laptop IP     : {local_ip}")
    print(f"  Port          : {chosen_port}")
    print(f"  User / Pass   : sony / sony  (or anonymous / no password)")
    print("=" * 65)
    print("  ON YOUR CAMERA (Sony FX3 / A7IV / Canon R5 / Nikon Z8):")
    print("  1. Connect camera to same Wi-Fi network.")
    print("  2. Menu -> Network -> FTP Transfer -> FTP Function -> ON")
    print("  3. Auto FTP Transfer -> ON")
    print(f"  4. Server Setting 1 -> Host: {local_ip}")
    print(f"     Port: {chosen_port} | User: sony | Pass: sony | Secure: OFF")
    print("=" * 65)
    print()

    server.max_cons = 25
    server.max_cons_per_ip = 15

    t = threading.Thread(target=server.serve_forever, daemon=True, name="FTPServerThread")
    t.start()
    return server, chosen_port


def main():
    print()
    print("===================================================")
    print("     Zigmaa Photos — Camera Auto Sync Agent")
    print("===================================================")
    print()

    default_event = os.environ.get("EVENT_ID", "100b1ef3-ccf3-4c24-8aca-16df4f6f6a63")
    default_folder = os.environ.get("WATCH_FOLDER", r"C:\EventPhotos")
    default_api = os.environ.get("API_BASE_URL", "https://zigmaa-photos-backend.onrender.com")
    ingest_key = os.environ.get("INGEST_API_KEY", "HbwzKQUT3Jeg63DZz6xwsc9NkJ8SAOSH9KOP_e8AJIk")

    # If run interactively in a console:
    try:
        ev_prompt = f"Paste Event ID or Event URL (Press Enter for {default_event}): "
        ev_input = input(ev_prompt).strip()
        raw_event = ev_input if ev_input else default_event
    except (EOFError, KeyboardInterrupt):
        raw_event = default_event

    try:
        folder_prompt = f"Enter Folder to watch (Press Enter for {default_folder}): "
        folder_input = input(folder_prompt).strip()
        watch_folder_str = folder_input if folder_input else default_folder
    except (EOFError, KeyboardInterrupt):
        watch_folder_str = default_folder

    event_id = resolve_event_id(raw_event, default_api)
    watch_folder = Path(watch_folder_str)
    watch_folder.mkdir(parents=True, exist_ok=True)

    # Set up environment variables for the agent configuration
    os.environ["API_BASE_URL"] = default_api
    os.environ["INGEST_API_KEY"] = ingest_key
    os.environ["EVENT_ID"] = event_id
    os.environ["WATCH_FOLDER"] = str(watch_folder)
    os.environ["CAMERA_SOURCE"] = "folder"
    os.environ["FOLDER_RECURSIVE"] = "true"
    os.environ["FILE_STABLE_SECONDS"] = "2"

    print()
    print("---------------------------------------------------")
    print(f" Event ID:      {event_id}")
    print(f" Watch Folder:  {watch_folder}")
    print(f" Cloud Server:  {default_api}")
    print("---------------------------------------------------")
    print(f"[READY] Every photo saved to {watch_folder} will auto-upload!")
    print("Keep this window open during the photoshoot.")
    print("Press Ctrl+C to stop.")
    print("---------------------------------------------------")

    from zigmaa_agent.agent import Agent
    from zigmaa_agent.capture import Spool, SpoolLock
    from zigmaa_agent.config import load_config
    from zigmaa_agent.sources import build_source
    from zigmaa_agent.uploader import Uploader

    try:
        cfg = load_config()
    except Exception as exc:
        logger.error("Configuration error: %s", exc)
        print("\n[ERROR] Could not initialize configuration. Please verify Event ID.")
        input("\nPress Enter to exit...")
        sys.exit(1)

    # Start Wi-Fi FTP Receiver
    logger.info("Starting Wi-Fi FTP server for %s...", watch_folder)
    ftp_server, port = run_ftp_server(watch_folder, port=21)

    # Start Ingestion Agent
    logger.info("Starting Ingestion Agent for event %s...", event_id)
    spool = Spool(cfg.event_spool)
    lock = SpoolLock(cfg.event_spool)
    try:
        lock.acquire()
    except Exception as exc:
        logger.warning("Spool note: %s", exc)

    source = build_source(cfg, spool)
    uploader = Uploader(cfg, spool)
    agent = Agent(cfg, source, uploader, spool)

    try:
        agent.run()
    except KeyboardInterrupt:
        print("\n\nStopping agent and FTP receiver cleanly...")
    except Exception as e:
        logger.error("Unexpected error in agent: %s", e, exc_info=True)
        input("\nAn error occurred. Press Enter to exit...")
    finally:
        try:
            ftp_server.close_all()
        except Exception:
            pass
        try:
            lock.release()
        except Exception:
            pass
        print("Agent stopped. Goodbye!")
        time.sleep(1)


if __name__ == "__main__":
    main()

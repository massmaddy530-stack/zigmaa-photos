"""Combined FTP server + Ingestion Agent for Sony FX3 / Wi-Fi camera tethering.

Receives photos directly from Sony FX3 (or Canon/Nikon FTP) over Wi-Fi into WATCH_FOLDER,
and immediately uploads and indexes them in Zigmaa Photos.
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

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

from zigmaa_agent.agent import Agent
from zigmaa_agent.config import load_config

logger = logging.getLogger("zigmaa_agent.ftp_sync")


def resolve_event_id(raw_input: str, api_base: str) -> str:
    """Extract UUID from raw input or resolve from guest slug."""
    raw = raw_input.strip()
    # 1. Direct UUID match (36 chars)
    uuid_match = re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", raw, re.I)
    if uuid_match:
        return uuid_match.group(0)

    # 2. Guest URL or slug
    slug_match = re.search(r"/e/([A-Za-z0-9_-]+)", raw)
    slug = slug_match.group(1) if slug_match else raw.strip("/").split("/")[-1]
    if "dashboard" in raw:
        return raw

    # Try resolving via public events resolve API
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


def get_local_ip() -> str:
    """Detect the local Wi-Fi / LAN IP address of this computer."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "192.168.1.29"


def run_ftp_server(watch_dir: Path, port: int = 21) -> tuple[FTPServer, int]:
    """Start pyftpdlib server in a daemon thread."""
    watch_dir.mkdir(parents=True, exist_ok=True)
    authorizer = DummyAuthorizer()
    # Full read/write/create permissions for uploads
    authorizer.add_anonymous(str(watch_dir), perm="elradfmwMT")
    authorizer.add_user("sony", "sony", str(watch_dir), perm="elradfmwMT")
    authorizer.add_user("camera", "camera", str(watch_dir), perm="elradfmwMT")

    handler = FTPHandler
    handler.authorizer = authorizer
    handler.banner = "Zigmaa Photos Sony FX3 Receiver Ready"
    handler.passive_ports = range(60000, 60050)

    chosen_port = port
    server: FTPServer | None = None
    try:
        server = FTPServer(("0.0.0.0", chosen_port), handler)
    except Exception as e:
        logger.warning("Port %d busy or restricted (%s), using 2121 instead", chosen_port, e)
        chosen_port = 2121
        server = FTPServer(("0.0.0.0", chosen_port), handler)

    local_ip = get_local_ip()
    print("\n" + "=" * 65)
    print("       SONY FX3 WI-FI FTP RECEIVER - ACTIVE")
    print("=" * 65)
    print(f"  Target Folder : {watch_dir}")
    print(f"  Laptop IP     : {local_ip}")
    print(f"  Port          : {chosen_port}")
    print(f"  User / Pass   : sony / sony  (or anonymous / no password)")
    print("=" * 65)
    print("  ON YOUR SONY FX3:")
    print("  1. Connect FX3 to same Wi-Fi network.")
    print("  2. Menu -> Network (Globe) -> FTP Transfer -> FTP Trans. Func. -> ON")
    print("  3. Auto FTP Transfer -> ON")
    print(f"  4. Server Setting 1 -> Host: {local_ip}")
    print(f"     Port: {chosen_port} | User: sony | Pass: sony | Secure: OFF")
    print("=" * 65 + "\n")

    server.max_cons = 15
    server.max_cons_per_ip = 10

    t = threading.Thread(target=server.serve_forever, daemon=True, name="FTPServerThread")
    t.start()
    return server, chosen_port


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    api_url = os.environ.get("API_BASE_URL", "https://zigmaa-photos.vercel.app")
    raw_ev = os.environ.get("EVENT_ID", "")
    if raw_ev:
        resolved_ev = resolve_event_id(raw_ev, api_url)
        os.environ["EVENT_ID"] = resolved_ev

    try:
        cfg = load_config()
    except Exception as e:
        logger.error("Configuration error: %s", e)
        if "/e/" in raw_ev or (raw_ev and len(raw_ev) < 25):
            print("\n" + "!" * 65)
            print("  [HINT] You entered the GUEST QR link (/e/...)")
            print("  Please enter the DASHBOARD event link instead:")
            print("  1. Go to: https://zigmaa-photos.vercel.app/dashboard/events")
            print("  2. Click on your event")
            print("  3. Copy the URL from your browser address bar:")
            print("     https://zigmaa-photos.vercel.app/dashboard/events/<UUID>")
            print("!" * 65 + "\n")
        sys.exit(1)

    watch_folder = cfg.watch_folder or Path("C:/EventPhotos")
    logger.info("Starting Wi-Fi FTP server for %s...", watch_folder)

    # Start FTP server in background thread
    server, port = run_ftp_server(watch_folder, port=21)

    # Start Ingestion Agent in main thread
    logger.info("Starting Ingestion Agent for event %s...", cfg.event_id)
    agent = Agent(cfg)
    try:
        agent.run()
    except KeyboardInterrupt:
        logger.info("Stopping agent and FTP receiver...")
        server.close_all()


if __name__ == "__main__":
    main()


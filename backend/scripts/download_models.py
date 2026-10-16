"""Download the InsightFace buffalo_l detector + recogniser ONNX files.

LICENCE: InsightFace states its pretrained models are "available for non-commercial research purposes
only" (https://github.com/deepinsight/insightface#license). Commercial use requires a licence from
InsightFace (recognition-oss-pack@insightface.ai). This script refuses to run unless you acknowledge that.

    python -m scripts.download_models --accept-noncommercial-license
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402

URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
WANTED = ("det_10g.onnx", "w600k_r50.onnx")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--accept-noncommercial-license", action="store_true",
                        help="Confirm you have read InsightFace's licence and your use is permitted")
    parser.add_argument("--dest", type=Path, default=None, help="Target directory (default: FACE_MODEL_DIR)")
    parser.add_argument("--url", default=URL)
    args = parser.parse_args()

    if not args.accept_noncommercial_license:
        print(__doc__)
        print("Refusing to download without --accept-noncommercial-license.", file=sys.stderr)
        return 2

    dest = (args.dest or get_settings().face_model_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    if all((dest / f).is_file() for f in WANTED):
        print(f"Models already present in {dest}")
        return 0

    with tempfile.TemporaryDirectory() as tmp:
        zpath = Path(tmp) / "buffalo_l.zip"
        print(f"Downloading {args.url} ...")
        sha = hashlib.sha256()
        with urllib.request.urlopen(args.url, timeout=60) as resp, open(zpath, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            while chunk := resp.read(1024 * 1024):
                out.write(chunk)
                sha.update(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done / 1e6:.0f}/{total / 1e6:.0f} MB", end="", flush=True)
        print(f"\nSHA-256 of archive: {sha.hexdigest()}")
        with zipfile.ZipFile(zpath) as zf:
            for name in zf.namelist():
                base = Path(name).name
                if base in WANTED:
                    with zf.open(name) as src, open(dest / base, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    print(f"  extracted {base}")
    missing = [f for f in WANTED if not (dest / f).is_file()]
    if missing:
        print(f"Archive did not contain: {missing}", file=sys.stderr)
        return 1
    print(f"Done. Models in {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

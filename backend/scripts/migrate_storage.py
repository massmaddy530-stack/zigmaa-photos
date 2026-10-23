"""Copy photos from local disk storage to the cloud bucket (Supabase Storage or Cloudflare R2).

    python -m scripts.migrate_storage --to supabase                  # dry run: report only, writes nothing
    python -m scripts.migrate_storage --to supabase --apply          # copy
    python -m scripts.migrate_storage --to r2 --event <EVENT_ID>     # one event only

Safe by design:
* Dry run unless --apply. Never deletes or modifies the local files, and never writes to the database.
* Resumable and idempotent: objects already in the bucket with the same size are skipped, so re-run after an
  interruption. Originals are verified against the photo's recorded SHA-256 before copying.
* Keys are unchanged, so after a complete copy set STORAGE_BACKEND to the provider. Setting it back to "local"
  is a full rollback.
* Reports originals that are missing locally (e.g. lost from an ephemeral disk). Those can only be recovered by
  re-uploading the same file, which restores it in place.

Reads DATABASE_URL, LOCAL_STORAGE_DIR and the provider's settings from the environment/.env, like the API.
Credentials are never printed. Exit code: 0 = no errors, 1 = some objects failed (re-run), 2 = bad arguments.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from app.services.storage import LocalStorage, R2Storage, SupabaseStorage  # noqa: E402
from app.services.storage_migration import collect_items, copy_objects  # noqa: E402


async def run(target: str, event_id: uuid.UUID | None, source_dir: Path | None, apply: bool, verbose: bool) -> int:
    s = get_settings()
    try:
        dest = SupabaseStorage(s) if target == "supabase" else R2Storage(s)
    except RuntimeError as exc:  # lists missing setting names only
        print(f"Cannot use {target}: {exc}", file=sys.stderr)
        return 2
    root = source_dir or s.local_storage_dir
    if not Path(root).is_dir():
        print(f"Local storage directory not found: {root}", file=sys.stderr)
        return 2
    source = LocalStorage(root, s.public_base_url, s.signing_secret.get_secret_value(), s.signed_url_ttl_s)

    try:
        async with get_sessionmaker()() as session:
            items = await collect_items(session, event_id)
    finally:
        await dispose_engine()

    print(f"{'Copying' if apply else 'Dry run:'} {len(items)} objects from {root} to {target}"
          f"{f' (event {event_id})' if event_id else ''}")

    def progress(item, outcome):
        if verbose or outcome not in ("already_copied", "would_copy", "copied"):
            print(f"  {outcome:18} {item.kind:9} {item.key}")

    report = await asyncio.to_thread(copy_objects, items, source, dest, apply=apply, progress=progress)
    print("Summary: " + ", ".join(f"{k}={v}" for k, v in sorted(report.outcomes.items())) if items else "Nothing to copy.")
    if report.missing_originals:
        print(f"{len(report.missing_originals)} original(s) are missing locally and cannot be copied. "
              "Re-upload the same files to restore them. Photo ids:")
        for pid in report.missing_originals:
            print(f"  {pid}")
    if not apply and report.outcomes.get("would_copy"):
        print("Nothing was written. Re-run with --apply to copy.")
    return 0 if report.ok else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--to", choices=["supabase", "r2"], required=True, help="destination provider")
    p.add_argument("--event", type=uuid.UUID, help="only this event id")
    p.add_argument("--source-dir", type=Path, help="local storage directory (default: LOCAL_STORAGE_DIR)")
    p.add_argument("--apply", action="store_true", help="actually copy (default: dry run)")
    p.add_argument("-v", "--verbose", action="store_true", help="print every object")
    a = p.parse_args()
    sys.exit(asyncio.run(run(a.to, a.event, a.source_dir, a.apply, a.verbose)))


if __name__ == "__main__":
    main()

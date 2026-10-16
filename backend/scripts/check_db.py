"""Read-only pre-migration check: connection, server version, pgvector availability/version, privileges.

    python -m scripts.check_db            # checks DATABASE_URL
    python -m scripts.check_db --test     # checks TEST_DATABASE_URL

Never prints passwords.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import dotenv_values  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import build_engine  # noqa: E402


async def check(url: str) -> int:
    safe = make_url(url).render_as_string(hide_password=True)
    print(f"URL        : {safe}")
    engine = build_engine(url, null_pool=True)
    ok = True
    try:
        async with engine.connect() as conn:
            row = (await conn.execute(text(
                "SELECT current_user, current_database(), current_setting('server_version')"))).one()
            print(f"Connected  : user={row[0]} db={row[1]} server={row[2]}")
            avail = (await conn.execute(text(
                "SELECT default_version FROM pg_available_extensions WHERE name='vector'"))).scalar()
            installed = (await conn.execute(text(
                "SELECT extversion FROM pg_extension WHERE extname='vector'"))).scalar()
            print(f"pgvector   : available={avail or 'NO'} enabled_in_db={installed or 'NO'}")
            if not avail:
                print("  -> pgvector is not installed on the server (run scripts\\install_pgvector.ps1 as admin).")
                ok = False
            elif not installed:
                print("  -> extension not enabled in this database; a superuser must run CREATE EXTENSION vector.")
                ok = False
            else:
                v = (await conn.execute(text("SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector"))).scalar()
                print(f"Vector op  : cosine distance test = {v:.6f}")
            can_create = (await conn.execute(text(
                "SELECT has_schema_privilege(current_user, 'public', 'CREATE')"))).scalar()
            print(f"CREATE on public schema: {can_create}")
            ok = ok and bool(can_create)
    except Exception as exc:  # noqa: BLE001
        print(f"FAILED     : {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
        ok = False
    finally:
        await engine.dispose()
    print("RESULT     :", "OK" if ok else "NOT READY")
    return 0 if ok else 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--test", action="store_true", help="check TEST_DATABASE_URL instead of DATABASE_URL")
    a = p.parse_args()
    if a.test:
        url = dotenv_values(Path(__file__).resolve().parents[1] / ".env").get("TEST_DATABASE_URL")
        if not url:
            print("TEST_DATABASE_URL is not set in backend/.env")
            return 1
    else:
        url = get_settings().database_url
    return asyncio.run(check(url))


if __name__ == "__main__":
    raise SystemExit(main())

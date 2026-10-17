"""DATABASE_URL normalisation: hosted PostgreSQL URLs (e.g. Render) must use asyncpg for the app and Alembic."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.core.config import Settings, async_database_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
SECRET = "s3cr3t-P@ss#word"  # contains characters that must stay URL-encoded
ENCODED = "s3cr3t-P%40ss%23word"


@pytest.mark.parametrize("scheme", ["postgresql", "postgres"])
def test_plain_postgres_url_uses_asyncpg_and_keeps_credentials(scheme):
    out = async_database_url(f"{scheme}://render_user:{ENCODED}@dpg-abc.oregon-postgres.render.com:5432/zigmaa")
    u = make_url(out)
    assert u.drivername == "postgresql+asyncpg"
    assert (u.username, u.password, u.host, u.port, u.database) == (
        "render_user", SECRET, "dpg-abc.oregon-postgres.render.com", 5432, "zigmaa")


def test_sslmode_translated_and_other_query_params_kept():
    u = make_url(async_database_url(f"postgresql://u:{ENCODED}@h/db?sslmode=require&application_name=zigmaa"))
    assert u.drivername == "postgresql+asyncpg"
    assert dict(u.query) == {"ssl": "require", "application_name": "zigmaa"}
    u = make_url(async_database_url("postgresql+asyncpg://u:p@h/db?sslmode=verify-full"))
    assert dict(u.query) == {"ssl": "verify-full"}


@pytest.mark.parametrize("url", [
    f"postgresql+asyncpg://u:{ENCODED}@localhost:5432/eventphoto_test",
    "postgresql+asyncpg://u:p@h/db?ssl=require",
    "sqlite+aiosqlite:///C:/tmp/test.db",
])
def test_already_configured_urls_unchanged(url):
    assert async_database_url(url) == url


def test_settings_normalise_database_url():
    s = Settings(database_url=f"postgresql://u:{ENCODED}@h:5432/db")
    assert s.database_url.startswith("postgresql+asyncpg://")
    assert make_url(s.database_url).password == SECRET


def test_invalid_url_error_does_not_reveal_it():
    with pytest.raises(ValidationError) as e:
        Settings(database_url=f"postgresql://u:{ENCODED}@h:notaport/db")
    assert SECRET not in str(e.value) and ENCODED not in str(e.value)
    assert "DATABASE_URL is not a valid database URL" in str(e.value)


def test_production_validation_error_does_not_reveal_database_url():
    with pytest.raises(ValidationError) as e:
        Settings(environment="production", admin_api_key=None,
                 database_url=f"postgresql://u:{ENCODED}@h/db")
    assert "ADMIN_API_KEY" in str(e.value)
    assert SECRET not in str(e.value) and ENCODED not in str(e.value)


def test_alembic_uses_asyncpg_for_plain_postgres_url():
    """Run Alembic as Render does, against a closed port: it must fail to *connect* via asyncpg, not on psycopg2."""
    env = {**os.environ, "DATABASE_URL": f"postgresql://render_user:{ENCODED}@127.0.0.1:1/zigmaa"}
    out = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND_DIR, env=env,
                         capture_output=True, text=True, timeout=120)
    output = out.stdout + out.stderr
    assert out.returncode != 0
    assert "psycopg2" not in output and "async driver" not in output
    assert "asyncpg" in output  # the connection attempt went through asyncpg
    assert SECRET not in output and ENCODED not in output

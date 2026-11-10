"""Entrypoint module for uvicorn (e.g. uvicorn main:app --host 0.0.0.0 --port 10000)."""

from app.main import app

__all__ = ["app"]


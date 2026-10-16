"""Structured logging with secret redaction."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

_REDACT_PATTERNS = [
    re.compile(r"(?i)(authorization|x-api-key|api[_-]?key|password|secret|token|sig)([\"']?\s*[:=]\s*[\"']?)([^\s\"'&,]+)"),
    re.compile(r"(?i)(bearer\s+)([A-Za-z0-9._\-]+)"),
    re.compile(r"(postgres(?:ql)?(?:\+\w+)?://[^:/\s]+:)([^@\s]+)(@)"),
]


def redact(text: str) -> str:
    text = _REDACT_PATTERNS[1].sub(lambda m: f"{m.group(1)}***", text)
    text = _REDACT_PATTERNS[0].sub(lambda m: f"{m.group(1)}{m.group(2)}***", text)
    text = _REDACT_PATTERNS[2].sub(lambda m: f"{m.group(1)}***{m.group(3)}", text)
    return text


_STD_ATTRS = set(vars(logging.makeLogRecord({})).keys()) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _STD_ATTRS and not key.startswith("_"):
                payload[key] = value if isinstance(value, (int, float, bool)) or value is None else redact(str(value))
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter() if json_logs else RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # Access logs include query strings (signed URL signatures); keep them redacted via our handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery"):
        lg = logging.getLogger(name)
        lg.handlers[:] = []
        lg.propagate = True

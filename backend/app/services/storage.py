"""Object storage abstraction: Cloudflare R2 or Supabase Storage (S3 API via boto3), or local disk for development.

All methods are synchronous (boto3 is blocking); call them via a thread pool from async code.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import shutil
import time
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote, urlencode

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Raised when the storage backend fails (treated as transient / retryable)."""


class Storage(ABC):
    @abstractmethod
    def put_file(self, key: str, fileobj: BinaryIO, content_type: str) -> None: ...

    @abstractmethod
    def download_to(self, key: str, dest: Path) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def signed_url(self, key: str, expires_in: int | None = None) -> str: ...

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        import io

        self.put_file(key, io.BytesIO(data), content_type)


def _validate_key(key: str) -> str:
    if not key or key.startswith("/") or "\\" in key or any(part in ("", ".", "..") for part in key.split("/")):
        raise ValueError("Invalid storage key")
    return key


# --------------------------------------------------------------------------- local


def sign_media(key: str, expires: int, secret: str) -> str:
    msg = f"{key}:{expires}".encode()
    digest = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def verify_media_signature(key: str, expires: int, sig: str, secret: str) -> bool:
    if expires < int(time.time()):
        return False
    return hmac.compare_digest(sign_media(key, expires, secret), sig)


class LocalStorage(Storage):
    """Stores objects on local disk; URLs are HMAC-signed and served by the API's /media route."""

    def __init__(self, root: Path, base_url: str, secret: str, ttl: int) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.base_url = base_url.rstrip("/")
        self.secret = secret
        self.ttl = ttl

    def path_for(self, key: str) -> Path:
        path = (self.root / _validate_key(key)).resolve()
        if self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    def put_file(self, key: str, fileobj: BinaryIO, content_type: str) -> None:
        path = self.path_for(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".part")
            with open(tmp, "wb") as out:
                shutil.copyfileobj(fileobj, out, length=1024 * 1024)
            os.replace(tmp, path)
        except OSError as exc:
            raise StorageError(f"Local storage write failed: {exc.strerror}") from exc

    def download_to(self, key: str, dest: Path) -> None:
        try:
            shutil.copyfile(self.path_for(key), dest)
        except OSError as exc:
            raise StorageError(f"Local storage read failed: {exc.strerror}") from exc

    def delete(self, key: str) -> None:
        try:
            self.path_for(key).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageError(f"Local storage delete failed: {exc.strerror}") from exc

    def exists(self, key: str) -> bool:
        return self.path_for(key).is_file()

    def signed_url(self, key: str, expires_in: int | None = None) -> str:
        expires = int(time.time()) + (expires_in or self.ttl)
        # Round expiry up to the minute so URLs are cache-friendly within a window.
        expires = expires - (expires % 60) + 60
        query = urlencode({"exp": expires, "sig": sign_media(key, expires, self.secret)})
        return f"{self.base_url}/media/{quote(key)}?{query}"


# --------------------------------------------------------------------------- S3-compatible (R2, Supabase)


class S3CompatibleStorage(Storage):
    """Objects in an S3-compatible bucket; URLs are presigned (SigV4) GET links straight to the provider.

    Error messages carry only the provider's error code, never credentials or URLs."""

    label = "S3"

    def __init__(self, *, endpoint: str, region: str, access_key_id: str, secret_access_key: str, bucket: str,
                 ttl: int, addressing_style: str | None = None, **config_options) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.ttl = ttl
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region,
            config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "standard"},
                          connect_timeout=10, read_timeout=60,
                          s3={"addressing_style": addressing_style} if addressing_style else None,
                          **config_options),
        )

    def _wrap(self, op: str, fn, *args, **kwargs):
        from boto3.exceptions import Boto3Error
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            return fn(*args, **kwargs)
        # Boto3Error covers the transfer manager's own failures, e.g. RetriesExceededError from download_file.
        except (BotoCoreError, ClientError, Boto3Error) as exc:
            # Some botocore errors (e.g. ReadTimeoutError) carry response=None.
            code = (getattr(exc, "response", None) or {}).get("Error", {}).get("Code", type(exc).__name__)
            raise StorageError(f"{self.label} {op} failed: {code}") from exc

    def put_file(self, key: str, fileobj: BinaryIO, content_type: str) -> None:
        self._wrap("upload", self.client.upload_fileobj, fileobj, self.bucket, _validate_key(key),
                   ExtraArgs={"ContentType": content_type})

    def download_to(self, key: str, dest: Path) -> None:
        self._wrap("download", self.client.download_file, self.bucket, _validate_key(key), str(dest))

    def delete(self, key: str) -> None:
        self._wrap("delete", self.client.delete_object, Bucket=self.bucket, Key=_validate_key(key))

    def exists(self, key: str) -> bool:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=_validate_key(key))
            return True
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise StorageError(f"{self.label} head failed") from exc
        except BotoCoreError as exc:  # transport failures (connection, timeouts)
            raise StorageError(f"{self.label} head failed: {type(exc).__name__}") from exc

    def signed_url(self, key: str, expires_in: int | None = None) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": _validate_key(key)},
            ExpiresIn=expires_in or self.ttl,
        )


class R2Storage(S3CompatibleStorage):
    label = "R2"

    def __init__(self, settings: Settings) -> None:
        missing = [n for n, v in {
            "R2_ACCESS_KEY_ID": settings.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": settings.r2_secret_access_key,
            "R2_BUCKET": settings.r2_bucket,
            "R2_ACCOUNT_ID or R2_ENDPOINT_URL": settings.r2_endpoint,
        }.items() if not v]
        if missing:
            raise RuntimeError(f"R2 storage selected but missing settings: {', '.join(missing)}")
        super().__init__(
            endpoint=settings.r2_endpoint, region="auto",
            access_key_id=settings.r2_access_key_id.get_secret_value(),
            secret_access_key=settings.r2_secret_access_key.get_secret_value(),
            bucket=settings.r2_bucket, ttl=settings.signed_url_ttl_s,
        )


class SupabaseStorage(S3CompatibleStorage):
    """Supabase Storage through its S3-compatible endpoint (path-style addressing, SigV4). Use a private bucket."""

    label = "Supabase"

    def __init__(self, settings: Settings) -> None:
        missing = settings.supabase_missing_settings
        if missing:
            raise RuntimeError(f"Supabase storage selected but missing settings: {', '.join(missing)}")
        super().__init__(
            endpoint=settings.supabase_endpoint, region=settings.supabase_s3_region,
            access_key_id=settings.supabase_s3_access_key_id.get_secret_value(),
            secret_access_key=settings.supabase_s3_secret_access_key.get_secret_value(),
            bucket=settings.supabase_storage_bucket, ttl=settings.signed_url_ttl_s,
            addressing_style="path",
            # Only send/validate the newer default CRC checksums when an operation requires them: not every
            # S3-compatible service accepts boto3's default (>=1.36) checksum headers.
            request_checksum_calculation="when_required", response_checksum_validation="when_required",
        )


_override: Storage | None = None


def set_storage(storage: Storage | None) -> None:
    """Override the storage backend (tests)."""
    global _override
    _override = storage
    _build.cache_clear()


@lru_cache
def _build() -> Storage:
    s = get_settings()
    if s.storage_backend == "r2":
        return R2Storage(s)
    if s.storage_backend == "supabase":
        return SupabaseStorage(s)
    return LocalStorage(s.local_storage_dir, s.public_base_url, s.signing_secret.get_secret_value(),
                        s.signed_url_ttl_s)


def get_storage() -> Storage:
    return _override or _build()

"""Supabase Storage (S3-compatible API) backend. Network-free: boto3 presigns locally and Stubber fakes S3 responses."""

import io
from urllib.parse import parse_qs, urlsplit

import pytest
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.services.storage import (LocalStorage, R2Storage, StorageError, SupabaseStorage, get_storage,
                                  set_storage)

REF = "abcdefghijklmnopqrst"
BUCKET = "zigmaa-photos"
KEY_ID = "test-supabase-key-id"
SECRET = "test-supabase-secret-DO-NOT-LEAK"  # fake; must never appear in URLs, errors or reprs
KEY = "events/e1/previews/p1.webp"
SUPABASE = {
    "storage_backend": "supabase", "supabase_project_ref": REF, "supabase_s3_region": "ap-south-1",
    "supabase_s3_access_key_id": KEY_ID, "supabase_s3_secret_access_key": SECRET,
    "supabase_storage_bucket": BUCKET,
}


@pytest.fixture(autouse=True)
def _no_ambient_supabase_env(monkeypatch):
    for name in ("SUPABASE_PROJECT_REF", "SUPABASE_S3_ENDPOINT", "SUPABASE_S3_REGION", "SUPABASE_S3_ACCESS_KEY_ID",
                 "SUPABASE_S3_SECRET_ACCESS_KEY", "SUPABASE_STORAGE_BUCKET"):
        monkeypatch.delenv(name, raising=False)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**SUPABASE, **overrides})


@pytest.fixture
def st():
    return SupabaseStorage(_settings())


@pytest.fixture
def stub(st):
    with Stubber(st.client) as s:
        yield s
        s.assert_no_pending_responses()


def _body(data: bytes) -> StreamingBody:
    return StreamingBody(io.BytesIO(data), len(data))


# --------------------------------------------------------------------------- client configuration


def test_client_configuration(st):
    assert st.client.meta.endpoint_url == f"https://{REF}.storage.supabase.co/storage/v1/s3"
    assert st.client.meta.region_name == "ap-south-1"
    cfg = st.client.meta.config
    assert cfg.signature_version == "s3v4"
    assert cfg.s3 == {"addressing_style": "path"}
    assert cfg.request_checksum_calculation == "when_required"
    assert st.bucket == BUCKET and st.ttl == 900


def test_explicit_endpoint_overrides_project_ref():
    st = SupabaseStorage(_settings(supabase_project_ref=None,
                                   supabase_s3_endpoint="https://other.storage.supabase.co/storage/v1/s3/"))
    assert st.client.meta.endpoint_url == "https://other.storage.supabase.co/storage/v1/s3"


def test_settings_repr_hides_credentials():
    s = _settings()
    assert SECRET not in repr(s) and SECRET not in str(s.model_dump())


# --------------------------------------------------------------------------- presigned URLs


def test_presigned_url_is_path_style_sigv4_without_secret(st):
    url = st.signed_url(KEY)
    parts = urlsplit(url)
    q = parse_qs(parts.query)
    assert parts.scheme == "https" and parts.netloc == f"{REF}.storage.supabase.co"
    assert parts.path == f"/storage/v1/s3/{BUCKET}/{KEY}"
    assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert q["X-Amz-Expires"] == ["900"]
    assert q["X-Amz-Credential"][0].startswith(f"{KEY_ID}/") and "/ap-south-1/s3/aws4_request" in q["X-Amz-Credential"][0]
    assert "X-Amz-Signature" in q
    assert SECRET not in url


def test_presigned_url_custom_expiry(st):
    assert parse_qs(urlsplit(st.signed_url(KEY, expires_in=60)).query)["X-Amz-Expires"] == ["60"]


# --------------------------------------------------------------------------- object operations


def test_upload(st, stub):
    stub.add_response("put_object", {}, {"Bucket": BUCKET, "Key": "events/e1/originals/p1.jpg", "Body": ANY,
                                         "ContentType": "image/jpeg"})
    st.put_file("events/e1/originals/p1.jpg", io.BytesIO(b"jpeg-bytes"), "image/jpeg")


def test_put_bytes(st, stub):
    stub.add_response("put_object", {}, {"Bucket": BUCKET, "Key": KEY, "Body": ANY, "ContentType": "image/webp"})
    st.put_bytes(KEY, b"webp-bytes", "image/webp")


def test_download(st, stub, tmp_path):
    data = b"original-image-bytes"
    # boto3's download_file issues a single GetObject for small objects (extra params such as Range vary by version).
    stub.add_response("get_object", {"Body": _body(data), "ContentLength": len(data), "ETag": '"etag"'})
    dest = tmp_path / "out.bin"
    st.download_to(KEY, dest)
    assert dest.read_bytes() == data


def test_delete(st, stub):
    stub.add_response("delete_object", {}, {"Bucket": BUCKET, "Key": KEY})
    st.delete(KEY)


def test_exists(st, stub):
    stub.add_response("head_object", {"ContentLength": 3}, {"Bucket": BUCKET, "Key": KEY})
    assert st.exists(KEY) is True


def test_exists_missing_object(st, stub):
    stub.add_client_error("head_object", service_error_code="404", http_status_code=404)
    assert st.exists(KEY) is False


def test_download_missing_object(st, stub, tmp_path):
    stub.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)
    with pytest.raises(StorageError) as e:
        st.download_to(KEY, tmp_path / "out.bin")
    assert str(e.value) == "Supabase download failed: NoSuchKey"
    assert not (tmp_path / "out.bin").exists()


# --------------------------------------------------------------------------- safe error handling


@pytest.mark.parametrize("method,call,expected", [
    ("put_object", lambda st: st.put_bytes(KEY, b"x", "image/webp"), "Supabase upload failed: AccessDenied"),
    ("delete_object", lambda st: st.delete(KEY), "Supabase delete failed: AccessDenied"),
    ("head_object", lambda st: st.exists(KEY), "Supabase head failed"),
])
def test_errors_are_storage_errors_without_secrets(st, stub, method, call, expected):
    stub.add_client_error(method, service_error_code="AccessDenied", service_message=f"bad key {KEY_ID}",
                          http_status_code=403)
    with pytest.raises(StorageError) as e:
        call(st)
    assert str(e.value) == expected
    assert SECRET not in str(e.value) and KEY_ID not in str(e.value)


@pytest.mark.parametrize("bad", ["", "/abs/key.jpg", "../escape.jpg", "events/../x.jpg", "events//x.jpg",
                                 "events\\x.jpg", "events/./x.jpg"])
def test_invalid_keys_rejected_before_any_request(st, stub, bad, tmp_path):
    # No responses are stubbed: any request reaching the client would fail the test.
    for call in (lambda: st.put_bytes(bad, b"x", "image/webp"), lambda: st.download_to(bad, tmp_path / "o"),
                 lambda: st.delete(bad), lambda: st.exists(bad), lambda: st.signed_url(bad)):
        with pytest.raises(ValueError, match="Invalid storage key"):
            call()


# --------------------------------------------------------------------------- missing configuration


def test_missing_configuration_names_settings_only():
    s = Settings(_env_file=None, storage_backend="supabase", supabase_s3_secret_access_key=SECRET)
    with pytest.raises(RuntimeError) as e:
        SupabaseStorage(s)
    msg = str(e.value)
    for name in ("SUPABASE_S3_ENDPOINT or SUPABASE_PROJECT_REF", "SUPABASE_S3_REGION", "SUPABASE_S3_ACCESS_KEY_ID",
                 "SUPABASE_STORAGE_BUCKET"):
        assert name in msg
    assert "SUPABASE_S3_SECRET_ACCESS_KEY" not in msg  # it is set
    assert SECRET not in msg


def test_empty_values_count_as_missing():
    s = _settings(supabase_s3_secret_access_key="", supabase_storage_bucket="")
    assert s.supabase_missing_settings == ["SUPABASE_S3_SECRET_ACCESS_KEY", "SUPABASE_STORAGE_BUCKET"]


def test_production_rejects_incomplete_supabase_config_without_secrets():
    prod = {"environment": "production", "admin_api_key": "a" * 32, "signing_secret": "s" * 40}
    with pytest.raises(ValidationError) as e:
        _settings(**prod, supabase_storage_bucket=None)
    assert "SUPABASE_STORAGE_BUCKET" in str(e.value)
    assert SECRET not in str(e.value) and KEY_ID not in str(e.value)
    assert _settings(**prod).storage_backend == "supabase"  # complete config is accepted


# --------------------------------------------------------------------------- backend selection


def _select(settings, **values):
    for k, v in values.items():
        object.__setattr__(settings, k, v)
    set_storage(None)
    return get_storage()


def test_backend_selection(settings, tmp_path):
    try:
        assert isinstance(_select(settings, storage_backend="local", local_storage_dir=tmp_path), LocalStorage)

        st = _select(settings, **_settings().model_dump(include=set(SUPABASE)))
        assert isinstance(st, SupabaseStorage) and st.bucket == BUCKET

        r2 = _select(settings, storage_backend="r2", r2_account_id="acct", r2_access_key_id=SecretStr("r2-id"),
                     r2_secret_access_key=SecretStr("r2-secret"), r2_bucket="r2-bucket")
        assert isinstance(r2, R2Storage) and not isinstance(r2, SupabaseStorage)
        # R2 behaviour unchanged: same endpoint, region "auto", default addressing style, SigV4.
        assert r2.client.meta.endpoint_url == "https://acct.r2.cloudflarestorage.com"
        assert r2.client.meta.region_name == "auto" and r2.client.meta.config.s3 is None
        assert r2.client.meta.config.signature_version == "s3v4"
    finally:
        set_storage(None)

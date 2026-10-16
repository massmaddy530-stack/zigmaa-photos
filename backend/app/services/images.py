"""Image validation and derivative generation (Pillow)."""

from __future__ import annotations

import hashlib
import io
import re
import unicodedata
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import Settings

FORMAT_CONTENT_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
FORMAT_EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
# Camera "multi-picture" JPEGs (e.g. Sony/Fujifilm .JPG files) start with an ordinary baseline JPEG - the primary
# image - followed by extra frames. Pillow reports them as "MPO"; they are validated, stored and served as JPEG
# (original bytes untouched) and only the primary frame (frame 0, Pillow's default) is ever decoded.
FORMAT_ALIASES = {"MPO": "JPEG"}
JPEG_FAMILY = ("JPEG", "MPO")


class InvalidImageError(Exception):
    """The uploaded file is not an acceptable image (permanent failure, never retried)."""

    def __init__(self, message: str, code: str = "invalid_image") -> None:
        super().__init__(message)
        self.code = code


class FileTooLargeError(InvalidImageError):
    def __init__(self, limit: int) -> None:
        super().__init__(f"File exceeds the {limit // (1024 * 1024)} MB limit", code="file_too_large")


@dataclass(frozen=True)
class ImageInfo:
    format: str
    width: int
    height: int

    @property
    def content_type(self) -> str:
        return FORMAT_CONTENT_TYPES[self.format]

    @property
    def extension(self) -> str:
        return FORMAT_EXTENSIONS[self.format]


def sanitize_filename(name: str | None, max_len: int = 200) -> str:
    """Return a display-safe filename. Never used to build storage paths."""
    name = unicodedata.normalize("NFKC", name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f<>:\"|?*]", "", name).strip(" .")
    return (name or "upload")[:max_len]


def copy_with_limit(src: BinaryIO, dst: BinaryIO, limit: int, chunk_size: int = 1024 * 1024) -> tuple[int, str]:
    """Stream ``src`` into ``dst`` while hashing; abort once ``limit`` bytes are exceeded."""
    sha = hashlib.sha256()
    total = 0
    while True:
        chunk = src.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise FileTooLargeError(limit)
        sha.update(chunk)
        dst.write(chunk)
    if total == 0:
        raise InvalidImageError("File is empty", code="empty_file")
    return total, sha.hexdigest()


def _open(source: Path | BinaryIO, settings: Settings) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            return Image.open(source)
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        if isinstance(exc, UnidentifiedImageError):
            raise InvalidImageError("File is not a recognised image", code="unsupported_format") from exc
        raise InvalidImageError("Image dimensions are too large", code="image_too_large") from exc


def inspect_image(source: Path | BinaryIO, settings: Settings) -> ImageInfo:
    """Validate type and integrity without decoding the full pixel data."""
    try:
        img = _open(source, settings)
        with img:
            fmt = (img.format or "").upper()
            fmt = FORMAT_ALIASES.get(fmt, fmt)
            if fmt not in settings.allowed_image_formats or fmt not in FORMAT_CONTENT_TYPES:
                raise InvalidImageError(f"Unsupported image format: {fmt or 'unknown'}", code="unsupported_format")
            width, height = img.size
            img.verify()
        if hasattr(source, "seek"):
            source.seek(0)
        # verify() does not catch truncated JPEGs; a reduced-scale (draft) decode does, cheaply.
        with _open(source, settings) as img:
            if fmt == "JPEG":
                img.draft("RGB", (max(1, width // 8), max(1, height // 8)))
            img.load()
    except InvalidImageError:
        raise
    except Exception as exc:  # truncated/corrupt files raise assorted errors
        raise InvalidImageError("Image file is corrupt or truncated", code="corrupt_image") from exc
    if width < 16 or height < 16:
        raise InvalidImageError("Image is too small", code="image_too_small")
    return ImageInfo(fmt, width, height)


def load_rgb(source: Path | BinaryIO, settings: Settings, max_side: int | None = None) -> Image.Image:
    """Decode to an EXIF-oriented RGB image, optionally bounded to ``max_side`` (never enlarged)."""
    img = _open(source, settings)
    try:
        if max_side and img.format in JPEG_FAMILY:
            img.draft("RGB", (max_side, max_side))  # cheap DCT down-scaling for big JPEGs
        img.load()
    except Exception as exc:
        img.close()
        raise InvalidImageError("Image could not be decoded", code="corrupt_image") from exc
    out = ImageOps.exif_transpose(img)
    if out.mode != "RGB":
        if out.mode in ("RGBA", "LA", "P"):
            out = out.convert("RGBA")
            background = Image.new("RGB", out.size, (255, 255, 255))
            background.paste(out, mask=out.getchannel("A"))
            out = background
        else:
            out = out.convert("RGB")
    if max_side and max(out.size) > max_side:
        out.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return out


def fit_within(img: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """Downscale preserving aspect ratio; never upscale."""
    if img.width <= max_w and img.height <= max_h:
        return img.copy()
    out = img.copy()
    out.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    return out


def to_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


@dataclass
class Derivatives:
    thumbnail: bytes
    preview: bytes
    analysis: Image.Image  # RGB image used for face analysis (bounded size)
    width: int
    height: int


def build_derivatives(path: Path, settings: Settings) -> Derivatives:
    with Image.open(path) as probe:
        oriented_w, oriented_h = probe.size
        if probe.getexif().get(0x0112, 1) in (5, 6, 7, 8):  # EXIF orientations that rotate 90 degrees
            oriented_w, oriented_h = oriented_h, oriented_w
    bound = max(settings.preview_max_width, settings.preview_max_height, settings.face_analysis_max_side)
    base = load_rgb(path, settings, max_side=bound)
    preview = fit_within(base, settings.preview_max_width, settings.preview_max_height)
    thumb = fit_within(preview, settings.thumbnail_max_px, settings.thumbnail_max_px)
    analysis = fit_within(base, settings.face_analysis_max_side, settings.face_analysis_max_side)
    return Derivatives(
        thumbnail=to_webp(thumb, settings.thumbnail_quality),
        preview=to_webp(preview, settings.preview_quality),
        analysis=analysis,
        width=oriented_w,
        height=oriented_h,
    )

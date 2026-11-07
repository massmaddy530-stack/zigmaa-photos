"""Face detection + embedding using InsightFace ``buffalo_l`` ONNX models on ONNX Runtime.

This mirrors ``insightface.app.FaceAnalysis`` (SCRFD ``det_10g.onnx`` detector and ArcFace
``w600k_r50.onnx`` recogniser with 5-point similarity alignment) but avoids the ``insightface``
pip package, which needs a C++ compiler to install on Windows.

LICENSE NOTE: InsightFace's pretrained model weights are published for non-commercial research
only. Obtain a commercial licence from InsightFace before using them in production.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

DETECTOR_FILE = "det_10g.onnx"
RECOGNIZER_FILE = "w600k_r50.onnx"

_MODEL_HASHES: dict[str, str] = {
    DETECTOR_FILE:   "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
    RECOGNIZER_FILE: "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
}
_MODEL_SIZES: dict[str, int] = {
    DETECTOR_FILE:   16_923_827,
    RECOGNIZER_FILE: 174_383_860,
}
_MODEL_VERSION_TAG: str = _MODEL_HASHES[DETECTOR_FILE][:8]  # "5838f7fe"

# ArcFace canonical 5-point template for a 112x112 crop.
ARCFACE_DST = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float32,
)


class FaceModelUnavailableError(RuntimeError):
    """Model weights are missing or failed to load."""


@dataclass
class DetectedFace:
    bbox: np.ndarray  # [x1, y1, x2, y2] in pixel coordinates of the analysed image
    kps: np.ndarray  # (5, 2) landmarks
    det_score: float
    embedding: np.ndarray  # (512,) float32, L2-normalised


class FaceAnalyzer(Protocol):
    model_name: str

    def analyze(self, image: Image.Image) -> list[DetectedFace]: ...


# --------------------------------------------------------------------------- helpers


def l2_normalize(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(v))
    if norm == 0.0 or not np.isfinite(norm):
        raise ValueError("Cannot normalise a zero/invalid embedding")
    return v / norm


def _distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    x1 = points[:, 0] - distance[:, 0]
    y1 = points[:, 1] - distance[:, 1]
    x2 = points[:, 0] + distance[:, 2]
    y2 = points[:, 1] + distance[:, 3]
    return np.stack([x1, y1, x2, y2], axis=-1)


def _distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    preds = []
    for i in range(0, distance.shape[1], 2):
        preds.append(points[:, i % 2] + distance[:, i])
        preds.append(points[:, i % 2 + 1] + distance[:, i + 1])
    return np.stack(preds, axis=-1)


def _nms(dets: np.ndarray, thresh: float) -> list[int]:
    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        ovr = (w * h) / (areas[i] + areas[order[1:]] - w * h)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


def umeyama_similarity(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Least-squares similarity transform (rotation, uniform scale, translation) src -> dst. Returns 2x3."""
    src = src.astype(np.float64)
    dst = dst.astype(np.float64)
    num = src.shape[0]
    src_mean, dst_mean = src.mean(axis=0), dst.mean(axis=0)
    src_d, dst_d = src - src_mean, dst - dst_mean
    cov = dst_d.T @ src_d / num
    d = np.ones(2)
    if np.linalg.det(cov) < 0:
        d[1] = -1
    u, s, vt = np.linalg.svd(cov)
    rot = u @ np.diag(d) @ vt
    scale = (s * d).sum() / src_d.var(axis=0).sum()
    t = dst_mean - scale * rot @ src_mean
    m = np.zeros((2, 3))
    m[:, :2] = scale * rot
    m[:, 2] = t
    return m


def align_face(image: Image.Image, kps: np.ndarray, size: int = 112) -> Image.Image:
    """Warp the face to the ArcFace template (equivalent to insightface.utils.face_align.norm_crop)."""
    m = umeyama_similarity(kps, ARCFACE_DST * (size / 112.0))
    # PIL's affine transform maps output -> input, so invert the forward matrix.
    full = np.vstack([m, [0, 0, 1]])
    inv = np.linalg.inv(full)
    coeffs = (inv[0, 0], inv[0, 1], inv[0, 2], inv[1, 0], inv[1, 1], inv[1, 2])
    return image.transform((size, size), Image.Transform.AFFINE, coeffs, resample=Image.Resampling.BILINEAR)


# --------------------------------------------------------------------------- ONNX analyzer


class BuffaloLAnalyzer:
    model_name = "buffalo_l"

    def __init__(self, model_dir: Path, settings: Settings) -> None:
        try:
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover
            raise FaceModelUnavailableError("onnxruntime is not installed") from exc

        resolved_dir = Path(model_dir).resolve()
        det_path, rec_path = resolved_dir / DETECTOR_FILE, resolved_dir / RECOGNIZER_FILE
        missing = [p.name for p in (det_path, rec_path) if not p.is_file()]
        if missing:
            raise FaceModelUnavailableError(
                f"Face model files missing in {model_dir}: {', '.join(missing)}. "
                "See README section 'Face model setup'."
            )
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = settings.onnx_intra_op_threads
        opts.inter_op_num_threads = 1
        providers = ["CPUExecutionProvider"]
        self.det = ort.InferenceSession(str(det_path), sess_options=opts, providers=providers)
        self.rec = ort.InferenceSession(str(rec_path), sess_options=opts, providers=providers)
        self.det_input = self.det.get_inputs()[0].name
        self.det_outputs = [o.name for o in self.det.get_outputs()]
        self.rec_input = self.rec.get_inputs()[0].name
        n_out = len(self.det_outputs)
        if n_out not in (6, 9, 10, 15):
            raise FaceModelUnavailableError(f"Unexpected detector output count: {n_out}")
        self.fmc = 3 if n_out in (6, 9) else 5
        self.strides = [8, 16, 32] if self.fmc == 3 else [8, 16, 32, 64, 128]
        self.use_kps = n_out in (9, 15)
        if not self.use_kps:
            raise FaceModelUnavailableError("Detector does not output keypoints; alignment impossible")
        self.num_anchors = 2
        self.det_size = settings.face_det_size
        self.det_thresh = settings.face_det_threshold
        self.min_size = settings.face_min_size_px
        self.nms_thresh = 0.4
        self._lock = threading.Lock()
        self._anchor_cache: dict[tuple[int, int, int], np.ndarray] = {}

    # -- detection ------------------------------------------------------------
    def _detect(self, img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """img: HxWx3 uint8 RGB. Returns (dets[N,5], kps[N,5,2]) in img coordinates."""
        size = self.det_size
        h, w = img.shape[:2]
        if h / w > 1.0:
            new_h, new_w = size, max(1, int(size * w / h))
        else:
            new_w, new_h = size, max(1, int(size * h / w))
        scale = new_h / h
        resized = np.asarray(Image.fromarray(img).resize((new_w, new_h), Image.Resampling.BILINEAR))
        canvas = np.zeros((size, size, 3), dtype=np.uint8)
        canvas[:new_h, :new_w] = resized
        blob = ((canvas.astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]
        outs = self.det.run(self.det_outputs, {self.det_input: blob})

        scores_l, boxes_l, kps_l = [], [], []
        for idx, stride in enumerate(self.strides):
            scores = outs[idx]
            box_pred = outs[idx + self.fmc]
            kps_pred = outs[idx + self.fmc * 2]
            if scores.ndim == 3:  # batched export
                scores, box_pred, kps_pred = scores[0], box_pred[0], kps_pred[0]
            box_pred = box_pred * stride
            kps_pred = kps_pred * stride
            fh, fw = size // stride, size // stride
            key = (fh, fw, stride)
            centers = self._anchor_cache.get(key)
            if centers is None:
                centers = np.stack(np.mgrid[:fh, :fw][::-1], axis=-1).astype(np.float32)
                centers = (centers * stride).reshape(-1, 2)
                centers = np.stack([centers] * self.num_anchors, axis=1).reshape(-1, 2)
                self._anchor_cache[key] = centers
            pos = np.where(scores.reshape(-1) >= self.det_thresh)[0]
            if pos.size == 0:
                continue
            scores_l.append(scores.reshape(-1, 1)[pos])
            boxes_l.append(_distance2bbox(centers, box_pred)[pos])
            kps_l.append(_distance2kps(centers, kps_pred).reshape(-1, 5, 2)[pos])

        if not scores_l:
            return np.zeros((0, 5), np.float32), np.zeros((0, 5, 2), np.float32)
        scores = np.vstack(scores_l).reshape(-1)
        order = scores.argsort()[::-1]
        boxes = np.vstack(boxes_l)[order] / scale
        kps = np.vstack(kps_l)[order] / scale
        dets = np.hstack([boxes, scores[order, None]]).astype(np.float32)
        keep = _nms(dets, self.nms_thresh)
        dets, kps = dets[keep], kps[keep]
        dets[:, [0, 2]] = dets[:, [0, 2]].clip(0, w)
        dets[:, [1, 3]] = dets[:, [1, 3]].clip(0, h)
        return dets, kps

    # -- recognition ----------------------------------------------------------
    def _embed(self, crops: list[Image.Image]) -> np.ndarray:
        batch = np.stack([np.asarray(c, dtype=np.float32) for c in crops])  # N,112,112,3 RGB
        blob = ((batch - 127.5) / 127.5).transpose(0, 3, 1, 2)
        feats = self.rec.run(None, {self.rec_input: blob})[0]
        norms = np.linalg.norm(feats, axis=1, keepdims=True)
        return (feats / np.maximum(norms, 1e-12)).astype(np.float32)

    def analyze(self, image: Image.Image) -> list[DetectedFace]:
        img = np.asarray(image.convert("RGB"))
        with self._lock:  # ORT sessions are thread-safe, but this bounds CPU use per process
            dets, kps = self._detect(img)
            faces = []
            for det, kp in zip(dets, kps):
                bw, bh = det[2] - det[0], det[3] - det[1]
                if min(bw, bh) < self.min_size:
                    continue
                faces.append((det, kp))
            if not faces:
                return []
            crops = [align_face(image, kp) for _, kp in faces]
            embs = []
            for i in range(0, len(crops), 16):
                embs.append(self._embed(crops[i:i + 16]))
            emb = np.vstack(embs)
        return [
            DetectedFace(bbox=det[:4].copy(), kps=kp.copy(), det_score=float(det[4]), embedding=emb[i])
            for i, (det, kp) in enumerate(faces)
        ]


class BuffaloSCAnalyzer:
    model_name = "buffalo_sc"

    def __init__(self, model_dir: Path, settings: Settings) -> None:
        import gc
        try:
            from insightface.app import FaceAnalysis
        except ImportError as exc:
            raise FaceModelUnavailableError("insightface is not installed") from exc

        resolved_dir = Path(model_dir).resolve()
        # insightface expects root directory containing 'models/<model_name>'
        root = str(resolved_dir.parent.parent) if resolved_dir.name in ("buffalo_sc", "buffalo_l") else str(resolved_dir)

        self.app = FaceAnalysis(name="buffalo_sc", root=root, providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=0, det_size=(settings.face_det_size, settings.face_det_size))
        self.min_size = settings.face_min_size_px
        self.max_side = settings.face_analysis_max_side
        self._lock = threading.Lock()
        gc.collect()

    def analyze(self, image: Image.Image) -> list[DetectedFace]:
        import gc
        orig_w, orig_h = image.size
        scale = 1.0
        if max(orig_w, orig_h) > self.max_side:
            scale = self.max_side / max(orig_w, orig_h)
            new_w, new_h = max(1, int(orig_w * scale)), max(1, int(orig_h * scale))
            proc_img = image.resize((new_w, new_h), Image.Resampling.BILINEAR)
        else:
            proc_img = image

        img_np = np.asarray(proc_img.convert("RGB"))[:, :, ::-1]

        with self._lock:
            raw_faces = self.app.get(img_np)

        results: list[DetectedFace] = []
        for face in raw_faces:
            bbox = face.bbox.copy()
            kps = face.kps.copy() if hasattr(face, "kps") and face.kps is not None else np.zeros((5, 2), dtype=np.float32)

            if scale != 1.0:
                bbox /= scale
                kps /= scale

            bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
            if min(bw, bh) < self.min_size:
                continue

            emb = l2_normalize(face.embedding)
            det_score = float(face.det_score) if hasattr(face, "det_score") else 1.0
            results.append(DetectedFace(bbox=bbox, kps=kps, det_score=det_score, embedding=emb))

        del img_np
        if proc_img is not image:
            proc_img.close()
        gc.collect()
        return results


# --------------------------------------------------------------------------- singleton

_analyzer: FaceAnalyzer | None = None
_analyzer_lock = threading.Lock()
_download_lock = threading.Lock()


def set_analyzer(analyzer: FaceAnalyzer | None) -> None:
    """Override the analyzer (tests / alternative engines)."""
    global _analyzer
    _analyzer = analyzer


def get_analyzer() -> FaceAnalyzer:
    global _analyzer
    if not get_settings().face_analysis_enabled:
        raise FaceModelUnavailableError("Face analysis is disabled (FACE_ANALYSIS_ENABLED=false)")
    if _analyzer is None:
        with _analyzer_lock:
            if _analyzer is None:
                settings = get_settings()
                logger.info("Loading face models from %s", settings.face_model_dir)
                sc_dir = settings.face_model_dir
                if (sc_dir / "det_500m.onnx").is_file() and (sc_dir / "w600k_mbf.onnx").is_file():
                    _analyzer = BuffaloSCAnalyzer(sc_dir, settings)
                else:
                    _analyzer = BuffaloLAnalyzer(settings.face_model_dir, settings)
    return _analyzer


def analyzer_available() -> bool:
    if not get_settings().face_analysis_enabled:
        return False
    if _analyzer is not None:
        return True
    d = get_settings().face_model_dir
    sc_ready = (d / "det_500m.onnx").is_file() and (d / "w600k_mbf.onnx").is_file()
    l_ready = (d / DETECTOR_FILE).is_file() and (d / RECOGNIZER_FILE).is_file()
    return sc_ready or l_ready


# ---------------------------------------------------------------------------
# Model download — versioned-directory + atomic symlink pointer strategy
# ---------------------------------------------------------------------------


def _sha256_file(path: Path) -> str:
    """Return lowercase hex SHA256 of *path*, streaming in 1 MB chunks."""
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _models_verified(model_dir: Path) -> bool:
    """Return True only when both ONNX files exist with the correct size and SHA256."""
    for filename in (DETECTOR_FILE, RECOGNIZER_FILE):
        path = model_dir / filename
        try:
            if not path.is_file():
                return False
            if path.stat().st_size != _MODEL_SIZES[filename]:
                return False
            if _sha256_file(path) != _MODEL_HASHES[filename]:
                return False
        except OSError:
            return False
    return True


def _fetch_to_file(url: str, dest: Path, headers: dict[str, str]) -> None:
    """Stream *url* to *dest* following HTTP redirects; never loads the body into RAM.

    HF LFS objects redirect (302) to a presigned CDN URL; follow_redirects handles this.
    Raises httpx.HTTPStatusError with "HTTP <status_code>" text only (no URL, no token).
    """
    import httpx

    timeout = httpx.Timeout(300.0, connect=30.0)
    with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=timeout) as resp:
        if resp.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {resp.status_code}", request=resp.request, response=resp
            )
        with dest.open("wb") as fh:
            for chunk in resp.iter_bytes(chunk_size=1 << 20):
                fh.write(chunk)


def _atomic_symlink_swap(versioned_dir: Path, model_dir: Path) -> None:
    """Point *model_dir* at *versioned_dir* via a single atomic rename(2) on Linux.

    Both paths must share the same parent directory.
    model_dir absent or a symlink: atomic single-syscall swap.
    model_dir a real (non-symlink) directory: raises OSError — remove it manually first.
    """
    pending = model_dir.parent / f".{model_dir.name}_pending"

    if pending.is_symlink() or pending.exists():
        try:
            pending.unlink()
        except OSError:
            pass

    pending.symlink_to(versioned_dir.name)

    try:
        if model_dir.is_symlink() or not model_dir.exists():
            pending.rename(model_dir)
        else:
            pending.unlink(missing_ok=True)
            raise OSError(
                f"{model_dir} is a real directory (not a symlink); "
                "remove or rename it manually before activating downloaded models"
            )
    except OSError:
        if pending.is_symlink() or pending.exists():
            try:
                pending.unlink()
            except OSError:
                pass
        raise


def download_face_models(settings: Settings) -> bool:
    """Download ONNX models from Hugging Face and activate atomically via symlink swap.

    Fast path: returns True immediately if both files are already verified.
    HF_MODEL_TOKEN is never logged or included in any exception message.
    Returns False on any failure; existing verified models are preserved.
    """
    import httpx

    model_dir: Path = settings.face_model_dir

    if settings.face_model_name == "buffalo_sc":
        if (model_dir / "det_500m.onnx").is_file() and (model_dir / "w600k_mbf.onnx").is_file():
            return True
        try:
            from insightface.app import FaceAnalysis
            root = str(model_dir.parent.parent) if model_dir.name in ("buffalo_sc", "buffalo_l") else str(model_dir)
            fa = FaceAnalysis(name="buffalo_sc", root=root, providers=["CPUExecutionProvider"])
            fa.prepare(ctx_id=0, det_size=(settings.face_det_size, settings.face_det_size))
            return True
        except Exception as exc:
            logger.warning("Could not download buffalo_sc via insightface: %s", exc)

    if _models_verified(model_dir):
        logger.info("Face models already verified in %s", model_dir)
        return True

    repo: str | None = settings.hf_model_repo
    token = settings.hf_model_token

    if not repo or not token:
        logger.warning(
            "Face models missing or unverified and HF_MODEL_REPO / HF_MODEL_TOKEN "
            "are not set — face analysis will be unavailable"
        )
        return False

    with _download_lock:
        if _models_verified(model_dir):
            logger.info("Face models verified by concurrent thread; skipping download")
            return True

        revision: str = settings.hf_model_revision
        base_url = f"https://huggingface.co/{repo}/resolve/{revision}"
        auth_headers: dict[str, str] = {"Authorization": f"Bearer {token.get_secret_value()}"}

        try:
            model_dir.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.error("Cannot create face model parent directory: %s", type(exc).__name__)
            return False

        versioned_dir = model_dir.parent / f"{model_dir.name}_v{_MODEL_VERSION_TAG}"

        if versioned_dir.exists():
            is_live = (
                model_dir.is_symlink()
                and model_dir.resolve() == versioned_dir.resolve()
            )
            if is_live:
                logger.error(
                    "Active model directory %s failed re-verification; restart required",
                    versioned_dir.name,
                )
                return False
            if _models_verified(versioned_dir):
                logger.info("Reusing existing verified versioned directory %s", versioned_dir.name)
                try:
                    _atomic_symlink_swap(versioned_dir, model_dir)
                except OSError as exc:
                    logger.error("Face model activation failed: %s", type(exc).__name__)
                    return False
                result = _models_verified(model_dir)
                if not result:
                    logger.error(
                        "Face models failed final verification after activation in %s", model_dir
                    )
                return result
            logger.warning(
                "Versioned model directory %s exists but is incomplete or invalid; "
                "remove it manually to retry",
                versioned_dir.name,
            )
            return False

        try:
            versioned_dir.mkdir(parents=False, exist_ok=False)
        except OSError as exc:
            logger.error("Cannot create versioned model directory: %s", type(exc).__name__)
            return False

        activation_complete = False
        try:
            for filename in (DETECTOR_FILE, RECOGNIZER_FILE):
                dest = versioned_dir / filename
                url = f"{base_url}/{filename}"
                logger.info("Downloading face model %s ...", filename)
                try:
                    _fetch_to_file(url, dest, auth_headers)
                except httpx.HTTPStatusError as exc:
                    logger.error("Failed to download face model %s: %s", filename, str(exc))
                    return False
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "Failed to download face model %s: %s", filename, type(exc).__name__
                    )
                    return False

            for filename in (DETECTOR_FILE, RECOGNIZER_FILE):
                staged = versioned_dir / filename
                expected_size = _MODEL_SIZES[filename]
                expected_hash = _MODEL_HASHES[filename]
                try:
                    actual_size = staged.stat().st_size
                except OSError as exc:
                    logger.error("Cannot stat staged model %s: %s", filename, type(exc).__name__)
                    return False
                if actual_size != expected_size:
                    logger.error(
                        "Face model %s size mismatch: expected %d bytes, got %d",
                        filename, expected_size, actual_size,
                    )
                    return False
                actual_hash = _sha256_file(staged)
                if actual_hash != expected_hash:
                    logger.error("Face model %s SHA256 mismatch", filename)
                    return False
                logger.info("Face model %s verified (%d bytes)", filename, actual_size)

            try:
                _atomic_symlink_swap(versioned_dir, model_dir)
                activation_complete = True
            except OSError as exc:
                logger.error("Face model activation failed: %s", type(exc).__name__)
                return False

            logger.info("Face models activated: %s -> %s", model_dir, versioned_dir.name)

        finally:
            if not activation_complete:
                try:
                    if versioned_dir.exists():
                        shutil.rmtree(versioned_dir, ignore_errors=True)
                except Exception:  # noqa: BLE001
                    pass

        result = _models_verified(model_dir)
        if not result:
            logger.error(
                "Face models failed final verification after activation in %s", model_dir
            )
        return result

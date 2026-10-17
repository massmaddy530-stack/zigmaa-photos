"""Face detection + embedding using InsightFace ``buffalo_l`` ONNX models on ONNX Runtime.

This mirrors ``insightface.app.FaceAnalysis`` (SCRFD ``det_10g.onnx`` detector and ArcFace
``w600k_r50.onnx`` recogniser with 5-point similarity alignment) but avoids the ``insightface``
pip package, which needs a C++ compiler to install on Windows.

LICENSE NOTE: InsightFace's pretrained model weights are published for non-commercial research
only. Obtain a commercial licence from InsightFace before using them in production.
"""

from __future__ import annotations

import logging
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

        det_path, rec_path = Path(model_dir) / DETECTOR_FILE, Path(model_dir) / RECOGNIZER_FILE
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


# --------------------------------------------------------------------------- singleton

_analyzer: FaceAnalyzer | None = None
_analyzer_lock = threading.Lock()


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
                _analyzer = BuffaloLAnalyzer(settings.face_model_dir, settings)
    return _analyzer


def analyzer_available() -> bool:
    if not get_settings().face_analysis_enabled:
        return False
    if _analyzer is not None:
        return True
    d = get_settings().face_model_dir
    return (d / DETECTOR_FILE).is_file() and (d / RECOGNIZER_FILE).is_file()

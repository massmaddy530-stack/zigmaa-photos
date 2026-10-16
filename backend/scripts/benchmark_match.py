"""Measure selfie-matching latency per stage against the configured database and face model.

    python -m scripts.benchmark_match --selfie path\\to\\selfie.jpg --event-id <uuid> [--runs 20]
    python -m scripts.benchmark_match --selfie selfie.jpg --synthetic-faces 50000   # temp event, removed after

Stages are timed separately: validation/decoding, detection+embedding, vector search, serialization.
Reports hardware, dataset size and p50/p95. The 300 ms figure is a target to measure, not a guarantee.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import platform
import statistics
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from sqlalchemy import delete, func, insert, select  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from app.models import Event, FaceEmbedding, Photo, PhotoStatus  # noqa: E402
from app.services.matching import Timings, search_selfie_faces, selfie_embeddings, serialize_matches  # noqa: E402
from app.services.storage import get_storage  # noqa: E402


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


async def seed_synthetic(n: int) -> uuid.UUID:
    sm = get_sessionmaker()
    rng = np.random.default_rng(1)
    async with sm() as s:
        ev = Event(slug=f"bench{uuid.uuid4().hex[:10]}", name="benchmark (synthetic)")
        s.add(ev)
        await s.flush()
        batch = 2000
        for start in range(0, n, batch):
            photos, faces = [], []
            for _ in range(min(batch, n - start)):
                pid = uuid.uuid4()
                photos.append(dict(id=pid, event_id=ev.id, original_filename="synthetic", content_hash=uuid.uuid4().hex * 2,
                                   content_type="image/jpeg", size_bytes=1, original_key=f"bench/{pid}",
                                   thumbnail_key=f"bench/{pid}.t", preview_key=f"bench/{pid}.p",
                                   status=PhotoStatus.indexed, face_count=1))
                v = rng.standard_normal(512).astype(np.float32)
                faces.append(dict(id=uuid.uuid4(), event_id=ev.id, photo_id=pid, face_index=0, bbox_x1=0, bbox_y1=0,
                                  bbox_x2=1, bbox_y2=1, det_score=0.9, embedding=v / np.linalg.norm(v)))
            await s.execute(insert(Photo), photos)
            await s.execute(insert(FaceEmbedding), faces)
            await s.commit()
            print(f"  seeded {start + len(photos)}/{n}", end="\r")
        print()
        return ev.id


async def run(args) -> None:
    settings = get_settings()
    data = Path(args.selfie).read_bytes()
    event_id = uuid.UUID(args.event_id) if args.event_id else await seed_synthetic(args.synthetic_faces)
    storage = get_storage()
    sm = get_sessionmaker()
    try:
        async with sm() as s:
            n_faces = (await s.execute(select(func.count()).select_from(FaceEmbedding)
                                       .where(FaceEmbedding.event_id == event_id))).scalar_one()
        rows: list[Timings] = []
        matches = 0
        for i in range(args.runs + 1):
            t = Timings()
            embs = await asyncio.to_thread(selfie_embeddings, data, settings, t)
            async with sm() as s:
                t0 = time.perf_counter()
                res = await search_selfie_faces(s, event_id, embs, settings)
                await s.commit()
                t.vector_search_ms = (time.perf_counter() - t0) * 1000
                t1 = time.perf_counter()
                await serialize_matches(s, event_id, res[:48], storage)
                t.serialization_ms = (time.perf_counter() - t1) * 1000
            matches = len(res)
            if i > 0:  # first run is warm-up (model load)
                rows.append(t)

        print("\n=== Match latency benchmark ===")
        print(f"Hardware : {platform.processor() or platform.machine()} | {os.cpu_count()} logical CPUs | "
              f"{platform.system()} {platform.release()}")
        print(f"Database : {'PostgreSQL+pgvector' if settings.is_postgres else 'SQLite (exact numpy search)'}")
        print(f"Dataset  : {n_faces} face embeddings in event | matches returned: {matches}")
        print(f"Runs     : {len(rows)} (after 1 warm-up) | ONNX threads: {settings.onnx_intra_op_threads}")
        for field in ("validation_ms", "detection_embedding_ms", "vector_search_ms", "serialization_ms"):
            vals = [getattr(r, field) for r in rows]
            print(f"  {field:<24} p50 {statistics.median(vals):8.1f} ms   p95 {pct(vals, 95):8.1f} ms")
        totals = [r.total_ms for r in rows]
        print(f"  {'total':<24} p50 {statistics.median(totals):8.1f} ms   p95 {pct(totals, 95):8.1f} ms")
    finally:
        if not args.event_id:
            async with sm() as s:
                await s.execute(delete(Event).where(Event.id == event_id))
                await s.commit()
            print("Synthetic benchmark event removed.")
        await dispose_engine()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--selfie", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--event-id")
    g.add_argument("--synthetic-faces", type=int)
    p.add_argument("--runs", type=int, default=20)
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()

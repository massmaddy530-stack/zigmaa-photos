"""Retention policy enforcement: purge biometric face embeddings for old events.

    python -m scripts.retention --face-days 30            # dry run: shows what would be purged
    python -m scripts.retention --face-days 30 --apply    # deletes embeddings (photos are kept)

An event's age is measured from its event_date (or created_at when no date is set). Schedule this daily
(Windows Task Scheduler or cron). Photos themselves are deleted only via the dashboard/API.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete, func, select, update  # noqa: E402

from app.db.session import dispose_engine, get_sessionmaker  # noqa: E402
from app.models import Event, FaceEmbedding, Photo  # noqa: E402


async def run(days: int, apply: bool) -> None:
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_d: date = cutoff_dt.date()
    sm = get_sessionmaker()
    try:
        async with sm() as s:
            events = (await s.execute(select(Event).where(
                ((Event.event_date.is_not(None)) & (Event.event_date < cutoff_d))
                | ((Event.event_date.is_(None)) & (Event.created_at < cutoff_dt))
            ))).scalars().all()
            total = 0
            for ev in events:
                n = (await s.execute(select(func.count()).select_from(FaceEmbedding)
                                     .where(FaceEmbedding.event_id == ev.id))).scalar_one()
                if not n:
                    continue
                total += n
                print(f"{'Purging' if apply else 'Would purge'} {n} face embeddings from '{ev.name}' ({ev.id})")
                if apply:
                    await s.execute(delete(FaceEmbedding).where(FaceEmbedding.event_id == ev.id))
                    await s.execute(update(Photo).where(Photo.event_id == ev.id).values(face_count=0))
            if apply:
                await s.commit()
            print(f"{'Purged' if apply else 'Dry run:'} {total} embeddings across {len(events)} events older than "
                  f"{days} days.")
    finally:
        await dispose_engine()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--face-days", type=int, required=True)
    p.add_argument("--apply", action="store_true")
    a = p.parse_args()
    asyncio.run(run(a.face_days, a.apply))


if __name__ == "__main__":
    main()

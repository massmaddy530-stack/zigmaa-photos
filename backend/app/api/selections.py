"""Client photo selection (album proofing) endpoints — admin & private client link."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from app.api.deps import SessionDep, StorageDep
from app.core.security import require_admin
from app.models import ClientSelection, ClientSelectionItem, Event, Photo, PhotoStatus
from app.schemas import PublicEventOut, PublicPhotoItem, PublicPhotosPage
from app.services.events import get_owned_event_or_404
from app.services.storage import Storage

admin_router = APIRouter(
    prefix="/api/v1/events",
    tags=["selections"],
    dependencies=[Depends(require_admin)],
)
public_router = APIRouter(prefix="/api/v1/public/select", tags=["public-selections"])


class SelectionSubmitRequest(BaseModel):
    client_name: str = Field(min_length=1, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    photo_ids: list[uuid.UUID] = Field(min_length=1, max_length=5000)
    selection_id: uuid.UUID | None = None


class ClientSelectionOut(BaseModel):
    id: uuid.UUID
    client_name: str
    note: str | None = None
    status: str
    photo_count: int
    created_at: datetime
    updated_at: datetime
    photos: list[PublicPhotoItem]


class EventSelectionsResponse(BaseModel):
    selection_token: str
    selection_url_path: str
    selections: list[ClientSelectionOut]


class PublicSelectionInfo(BaseModel):
    event: PublicEventOut
    total_photos: int


class SelectionSubmitResponse(BaseModel):
    id: uuid.UUID
    client_name: str
    note: str | None = None
    photo_count: int
    updated_at: datetime


def _photo_to_public_item(p: Photo, storage: Storage) -> PublicPhotoItem:
    thumb = getattr(p, "r2_thumbnail_url", None)
    if thumb and "localhost" in thumb:
        thumb = None
    if not thumb and p.thumbnail_key:
        thumb = storage.signed_url(p.thumbnail_key)

    prev = getattr(p, "r2_preview_url", None)
    if prev and "localhost" in prev:
        prev = None
    if not prev and p.preview_key:
        prev = storage.signed_url(p.preview_key)

    orig = getattr(p, "r2_original_url", None)
    if orig and "localhost" in orig:
        orig = None
    if not orig and p.original_key:
        orig = storage.signed_url(p.original_key)

    clean_fn = p.original_filename.replace("\\", "/")
    fld = clean_fn.split("/")[0] if "/" in clean_fn else None

    return PublicPhotoItem(
        photo_id=p.id,
        original_filename=clean_fn.split("/")[-1] if "/" in clean_fn else p.original_filename,
        width=p.width,
        height=p.height,
        thumbnail_url=thumb,
        preview_url=prev,
        download_url=orig or prev,
        folder=fld,
    )


async def _ensure_selection_token(session: SessionDep, event: Event) -> str:
    if not event.selection_token:
        event.selection_token = secrets.token_urlsafe(12)
        await session.commit()
        await session.refresh(event)
    return event.selection_token


async def _get_event_by_token(session: SessionDep, slug: str, token: str | None) -> Event:
    ev = (await session.execute(select(Event).where(Event.slug == slug))).scalar_one_or_none()
    if ev is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if not token or not ev.selection_token or not secrets.compare_digest(token.strip(), ev.selection_token):
        raise HTTPException(status_code=403, detail="Invalid or expired selection link")
    return ev


@admin_router.get("/{event_id}/selections", response_model=EventSelectionsResponse)
async def list_event_selections(
    event_id: uuid.UUID,
    session: SessionDep,
    storage: StorageDep,
    x_user_email: Annotated[str | None, Header(alias="X-User-Email")] = None,
) -> EventSelectionsResponse:
    event = await get_owned_event_or_404(session, event_id, x_user_email)
    token = await _ensure_selection_token(session, event)

    stmt = (
        select(ClientSelection)
        .where(ClientSelection.event_id == event.id)
        .options(selectinload(ClientSelection.items).selectinload(ClientSelectionItem.photo))
        .order_by(ClientSelection.updated_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()

    out: list[ClientSelectionOut] = []
    for sel in rows:
        photos = [_photo_to_public_item(it.photo, storage) for it in sel.items if it.photo is not None]
        out.append(
            ClientSelectionOut(
                id=sel.id,
                client_name=sel.client_name,
                note=sel.note,
                status=sel.status,
                photo_count=len(photos),
                created_at=sel.created_at,
                updated_at=sel.updated_at,
                photos=photos,
            )
        )

    return EventSelectionsResponse(
        selection_token=token,
        selection_url_path=f"/select/{event.slug}?t={token}",
        selections=out,
    )


@admin_router.post("/{event_id}/selections/regenerate-link")
async def regenerate_selection_link(
    event_id: uuid.UUID,
    session: SessionDep,
    x_user_email: Annotated[str | None, Header(alias="X-User-Email")] = None,
) -> dict[str, str]:
    event = await get_owned_event_or_404(session, event_id, x_user_email)
    event.selection_token = secrets.token_urlsafe(12)
    await session.commit()
    return {
        "selection_token": event.selection_token,
        "selection_url_path": f"/select/{event.slug}?t={event.selection_token}",
    }


@admin_router.delete("/{event_id}/selections/{selection_id}", status_code=204)
async def delete_event_selection(
    event_id: uuid.UUID,
    selection_id: uuid.UUID,
    session: SessionDep,
    x_user_email: Annotated[str | None, Header(alias="X-User-Email")] = None,
) -> None:
    event = await get_owned_event_or_404(session, event_id, x_user_email)
    res = await session.execute(
        delete(ClientSelection).where(
            ClientSelection.id == selection_id,
            ClientSelection.event_id == event.id,
        )
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Selection not found")
    await session.commit()


@public_router.get("/{slug}", response_model=PublicSelectionInfo)
async def get_public_selection_event(
    slug: str,
    session: SessionDep,
    storage: StorageDep,
    t: str | None = Query(default=None),
) -> PublicSelectionInfo:
    ev = await _get_event_by_token(session, slug, t)
    total = (
        await session.execute(
            select(func.count(Photo.id)).where(
                Photo.event_id == ev.id,
                Photo.status == PhotoStatus.indexed,
            )
        )
    ).scalar_one()

    cover_url = storage.signed_url(ev.cover_key) if ev.cover_key else None
    return PublicSelectionInfo(
        event=PublicEventOut(
            slug=ev.slug,
            name=ev.name,
            event_date=ev.event_date,
            venue=ev.venue,
            description=ev.description,
            cover_url=cover_url,
            photo_count=total,
            matching_available=False,
        ),
        total_photos=total,
    )


@public_router.get("/{slug}/photos", response_model=PublicPhotosPage)
async def get_public_selection_photos(
    slug: str,
    session: SessionDep,
    storage: StorageDep,
    t: str | None = Query(default=None),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=60, ge=1, le=200),
    q: str | None = Query(default=None, max_length=100),
) -> PublicPhotosPage:
    ev = await _get_event_by_token(session, slug, t)

    base = [Photo.event_id == ev.id, Photo.status == PhotoStatus.indexed]
    if q and q.strip():
        base.append(Photo.original_filename.ilike(f"%{q.strip()}%"))

    total = (await session.execute(select(func.count(Photo.id)).where(*base))).scalar_one()
    rows = (
        await session.execute(
            select(Photo).where(*base).order_by(Photo.created_at.desc(), Photo.id.desc()).offset(cursor).limit(limit)
        )
    ).scalars().all()

    items = [_photo_to_public_item(p, storage) for p in rows]
    nxt = cursor + limit
    return PublicPhotosPage(
        total=total,
        items=items,
        next_cursor=nxt if nxt < total else None,
    )


@public_router.post("/{slug}", response_model=SelectionSubmitResponse)
async def submit_public_selection(
    slug: str,
    body: SelectionSubmitRequest,
    session: SessionDep,
    t: str | None = Query(default=None),
) -> SelectionSubmitResponse:
    ev = await _get_event_by_token(session, slug, t)

    unique_ids = list(dict.fromkeys(body.photo_ids))
    valid_ids = set(
        (
            await session.execute(
                select(Photo.id).where(Photo.event_id == ev.id, Photo.id.in_(unique_ids))
            )
        )
        .scalars()
        .all()
    )
    if not valid_ids:
        raise HTTPException(status_code=400, detail="No valid photos selected for this event")

    sel: ClientSelection | None = None
    if body.selection_id:
        sel = (
            await session.execute(
                select(ClientSelection).where(
                    ClientSelection.id == body.selection_id,
                    ClientSelection.event_id == ev.id,
                )
            )
        ).scalar_one_or_none()

    if sel is None:
        sel = ClientSelection(
            event_id=ev.id,
            client_name=body.client_name.strip(),
            note=body.note.strip() if body.note else None,
            status="submitted",
        )
        session.add(sel)
        await session.flush()
    else:
        sel.client_name = body.client_name.strip()
        sel.note = body.note.strip() if body.note else None
        sel.status = "submitted"
        await session.execute(
            delete(ClientSelectionItem).where(ClientSelectionItem.selection_id == sel.id)
        )

    for pid in unique_ids:
        if pid in valid_ids:
            session.add(ClientSelectionItem(selection_id=sel.id, photo_id=pid))

    await session.commit()
    await session.refresh(sel)

    return SelectionSubmitResponse(
        id=sel.id,
        client_name=sel.client_name,
        note=sel.note,
        photo_count=len(valid_ids),
        updated_at=sel.updated_at,
    )

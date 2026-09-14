from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Translation, TranslationHistory
from app.schemas import (
    BulkLockRequest,
    TranslationHistoryOut,
    TranslationOut,
    TranslationUpdate,
)

router = APIRouter(prefix="/api/translations", tags=["translations"])


@router.get("", response_model=list[TranslationOut])
def list_translations(db: Session = Depends(get_db)):
    """Return the full translation set in one response.

    The dashboard fetches this once and does all searching/filtering/paging
    client-side (dataset is small: hundreds-to-low-thousands of terms across
    a handful of languages), so no query params are needed here.
    """
    stmt = select(Translation).order_by(Translation.key, Translation.language)
    items = db.execute(stmt).scalars().all()
    return items


@router.patch("/bulk-lock", response_model=list[TranslationOut])
def bulk_lock_translations(payload: BulkLockRequest, db: Session = Depends(get_db)):
    """Lock/unlock a whole batch at once -- e.g. everything currently visible
    under the Translations page's filters, after proofreading it. Locked rows
    are skipped by the translation pipeline (app/inngest_app/functions.py
    `_load_needed_terms`), so this is how a proofread batch is frozen ahead of
    a release without spending tokens re-translating it on the next run.
    """
    db.execute(update(Translation).where(Translation.id.in_(payload.ids)).values(locked=payload.locked))
    db.commit()

    stmt = select(Translation).where(Translation.id.in_(payload.ids))
    return db.execute(stmt).scalars().all()


@router.get("/{translation_id}", response_model=TranslationOut)
def get_translation(translation_id: int, db: Session = Depends(get_db)):
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")
    return translation


@router.patch("/{translation_id}", response_model=TranslationOut)
def update_translation(translation_id: int, payload: TranslationUpdate, db: Session = Depends(get_db)):
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")

    if payload.locked is not None:
        translation.locked = payload.locked

    if payload.translated_text is not None:
        if payload.translated_text != translation.translated_text:
            translation.translated_text = payload.translated_text
            translation.version += 1
            translation.updated_at = datetime.now(timezone.utc)

            history_row = TranslationHistory(
                translation_id=translation.id,
                version=translation.version,
                translated_text=translation.translated_text,
                source_hash=translation.source_hash,
                change_type="manual",
            )
            db.add(history_row)
        else:
            # Saved with no actual change -- record that it was touched
            # without bumping the version or adding a no-op history entry.
            translation.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(translation)
    return translation


@router.get("/{translation_id}/history", response_model=list[TranslationHistoryOut])
def get_translation_history(translation_id: int, db: Session = Depends(get_db)):
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")

    stmt = (
        select(TranslationHistory)
        .where(TranslationHistory.translation_id == translation_id)
        .order_by(TranslationHistory.changed_at.desc(), TranslationHistory.id.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return rows


@router.delete("/{translation_id}/history/{history_id}", status_code=204)
def delete_translation_history_entry(translation_id: int, history_id: int, db: Session = Depends(get_db)):
    """Delete one past version from a translation's audit trail (v1, v2, ...).

    Purely a cleanup action on the history log -- it never touches the
    translation's current `translated_text`/`version`, which live on the
    `translations` row itself.
    """
    row = db.get(TranslationHistory, history_id)
    if row is None or row.translation_id != translation_id:
        raise HTTPException(status_code=404, detail="History entry not found")
    db.delete(row)
    db.commit()


@router.delete("/{translation_id}/history", status_code=204)
def clear_translation_history(translation_id: int, db: Session = Depends(get_db)):
    """Delete every past version for a translation in one click."""
    translation = db.get(Translation, translation_id)
    if translation is None:
        raise HTTPException(status_code=404, detail="Translation not found")
    db.execute(delete(TranslationHistory).where(TranslationHistory.translation_id == translation_id))
    db.commit()

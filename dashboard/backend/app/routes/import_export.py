import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Language, Translation, TranslationHistory
from app.schemas import ImportSummary

router = APIRouter(tags=["import-export"])


def _flatten(obj: Any, prefix: str = "") -> dict[str, str]:
    """Flatten an arbitrarily nested object of strings into dot-path keys.

    e.g. {"settings": {"title": "Settings"}} -> {"settings.title": "Settings"}
    """
    flat: dict[str, str] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            flat.update(_flatten(value, path))
    else:
        if not isinstance(obj, str):
            raise HTTPException(
                status_code=400,
                detail=f"Leaf value at '{prefix}' must be a string, got {type(obj).__name__}",
            )
        flat[prefix] = obj
    return flat


def _unflatten(flat: dict[str, str]) -> dict[str, Any]:
    """Reverse of _flatten: rebuild a nested object from dot-path keys."""
    nested: dict[str, Any] = {}
    for dotted_key, value in flat.items():
        parts = dotted_key.split(".")
        cursor = nested
        for part in parts[:-1]:
            cursor = cursor.setdefault(part, {})
        cursor[parts[-1]] = value
    return nested


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _get_source_language(db: Session) -> Language:
    stmt = select(Language).where(Language.is_source.is_(True))
    source = db.execute(stmt).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=500, detail="No source language configured in /api/languages")
    return source


@router.post("/api/import", response_model=ImportSummary)
async def import_terms(file: UploadFile, db: Session = Depends(get_db)):
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}") from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Top-level JSON must be an object")

    source_language = _get_source_language(db)
    flat = _flatten(data)

    imported = 0
    updated = 0
    unchanged = 0

    existing_rows = {
        row.key: row
        for row in db.execute(
            select(Translation).where(Translation.language == source_language.code)
        ).scalars()
    }

    now = datetime.now(timezone.utc)

    for key, text in flat.items():
        source_hash = _sha256(text)
        existing = existing_rows.get(key)

        if existing is None:
            translation = Translation(
                key=key,
                language=source_language.code,
                source_text=text,
                source_hash=source_hash,
                translated_text=text,
                locked=False,
                version=1,
                updated_at=now,
            )
            db.add(translation)
            db.flush()
            db.add(
                TranslationHistory(
                    translation_id=translation.id,
                    version=1,
                    translated_text=text,
                    source_hash=source_hash,
                    change_type="import",
                )
            )
            imported += 1
        elif existing.source_hash != source_hash:
            existing.source_text = text
            existing.translated_text = text
            existing.source_hash = source_hash
            existing.version += 1
            existing.updated_at = now
            db.add(
                TranslationHistory(
                    translation_id=existing.id,
                    version=existing.version,
                    translated_text=text,
                    source_hash=source_hash,
                    change_type="import",
                )
            )
            updated += 1
        else:
            unchanged += 1

    db.commit()

    return ImportSummary(imported=imported, updated=updated, unchanged=unchanged)


@router.get("/api/export/{language}")
def export_terms(language: str, db: Session = Depends(get_db)):
    lang_row = db.get(Language, language)
    if lang_row is None:
        raise HTTPException(status_code=400, detail="language must be a code from /api/languages")

    stmt = select(Translation).where(Translation.language == language)
    rows = db.execute(stmt).scalars().all()

    flat = {row.key: row.translated_text for row in rows}
    nested = _unflatten(flat)

    content = json.dumps(nested, ensure_ascii=False, indent=2)

    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=terms.{language}.json"},
    )

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Language, PromptTemplate, Translation
from app.schemas import LanguageCreate, LanguageOut, LanguageUpdate

router = APIRouter(prefix="/api/languages", tags=["languages"])


@router.get("", response_model=list[LanguageOut])
def list_languages(db: Session = Depends(get_db)):
    stmt = select(Language).order_by(Language.sort_order, Language.code)
    return db.execute(stmt).scalars().all()


@router.post("", response_model=LanguageOut, status_code=201)
def create_language(payload: LanguageCreate, db: Session = Depends(get_db)):
    code = payload.code.strip().lower()
    existing = db.get(Language, code)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Language '{code}' already exists")

    language = Language(
        code=code,
        label=payload.label,
        is_source=False,
        active=True,
        sort_order=payload.sort_order,
    )
    db.add(language)

    if payload.template_text:
        db.add(PromptTemplate(language=code, template_text=payload.template_text))

    db.commit()
    db.refresh(language)
    return language


@router.patch("/{code}", response_model=LanguageOut)
def update_language(code: str, payload: LanguageUpdate, db: Session = Depends(get_db)):
    language = db.get(Language, code)
    if language is None:
        raise HTTPException(status_code=404, detail="Language not found")

    if payload.label is not None:
        language.label = payload.label
    if payload.active is not None:
        if language.is_source and not payload.active:
            raise HTTPException(status_code=400, detail="The source language cannot be deactivated")
        language.active = payload.active
    if payload.sort_order is not None:
        language.sort_order = payload.sort_order

    language.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(language)
    return language


@router.delete("/{code}", status_code=204)
def delete_language(code: str, db: Session = Depends(get_db)):
    language = db.get(Language, code)
    if language is None:
        raise HTTPException(status_code=404, detail="Language not found")
    if language.is_source:
        raise HTTPException(status_code=400, detail="The source language cannot be deleted")

    count_stmt = select(func.count()).select_from(Translation).where(Translation.language == code)
    in_use = db.execute(count_stmt).scalar_one()
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Language '{code}' has {in_use} translation rows; deactivate it instead of deleting",
        )

    template = db.execute(select(PromptTemplate).where(PromptTemplate.language == code)).scalar_one_or_none()
    if template is not None:
        db.delete(template)

    db.delete(language)
    db.commit()

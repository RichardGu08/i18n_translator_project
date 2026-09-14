from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Language, PromptTemplate
from app.schemas import PromptTemplateOut, PromptTemplateUpdate

router = APIRouter(prefix="/api/prompt-templates", tags=["prompt-templates"])


@router.get("", response_model=list[PromptTemplateOut])
def list_prompt_templates(db: Session = Depends(get_db)):
    stmt = select(PromptTemplate).order_by(PromptTemplate.language)
    return db.execute(stmt).scalars().all()


@router.get("/{language}", response_model=PromptTemplateOut)
def get_prompt_template(language: str, db: Session = Depends(get_db)):
    stmt = select(PromptTemplate).where(PromptTemplate.language == language)
    template = db.execute(stmt).scalar_one_or_none()
    if template is None:
        raise HTTPException(status_code=404, detail="Prompt template not found")
    return template


@router.put("/{language}", response_model=PromptTemplateOut)
def upsert_prompt_template(language: str, payload: PromptTemplateUpdate, db: Session = Depends(get_db)):
    lang_row = db.get(Language, language)
    if lang_row is None or lang_row.is_source:
        raise HTTPException(
            status_code=400,
            detail="language must be an active, non-source language from /api/languages",
        )

    stmt = select(PromptTemplate).where(PromptTemplate.language == language)
    template = db.execute(stmt).scalar_one_or_none()

    if template is None:
        template = PromptTemplate(
            language=language,
            template_text=payload.template_text,
            version=1,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(template)
    else:
        template.template_text = payload.template_text
        template.version += 1
        template.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(template)
    return template

import inngest
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.inngest_app.client import inngest_client
from app.models import Language, TranslationRun
from app.schemas import TranslationRunOut, TranslationRunRequest, TranslationRunTrigger

router = APIRouter(prefix="/api/translation-runs", tags=["translation-runs"])


@router.get("", response_model=list[TranslationRunOut])
def list_translation_runs(db: Session = Depends(get_db)):
    """Recent runs, newest first -- powers both the live "active runs" bar and
    the Import/Export page's run history."""
    stmt = select(TranslationRun).order_by(TranslationRun.started_at.desc()).limit(50)
    return db.execute(stmt).scalars().all()


@router.post("", response_model=TranslationRunTrigger, status_code=202)
async def trigger_translation_run(payload: TranslationRunRequest | None = None, db: Session = Depends(get_db)):
    """Fire-and-forget: sends the event `run_translation` (app/inngest_app/functions.py)
    listens for. Progress can be watched on the dashboard (live bar / run history)
    or in the Inngest dev server UI (http://localhost:8288 by default)."""
    requested = payload.languages if payload else None

    active_targets = {
        code
        for code in db.execute(
            select(Language.code).where(Language.active.is_(True), Language.is_source.is_(False))
        ).scalars()
    }

    if requested:
        languages = [code for code in requested if code in active_targets]
        if not languages:
            raise HTTPException(status_code=400, detail="None of the requested languages are active target languages")
    else:
        languages = sorted(active_targets)

    ids = await inngest_client.send(
        inngest.Event(name="translation/run.requested", data={"languages": languages})
    )
    return TranslationRunTrigger(event_id=ids[0], languages=languages)

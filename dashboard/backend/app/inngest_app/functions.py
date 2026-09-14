"""Inngest functions implementing the translation pipeline.

Replaces the old n8n workflows (main-translation-run.json +
translate-chunk-{fr,es}.subworkflow.json). Compared to n8n's "Execute
Workflow" (each) mode, this gets real retry + concurrency control:

- `translate_language`'s `concurrency` config caps chunk translation at 5
  concurrent OpenAI calls *system-wide*, across every language's run, using
  a static concurrency key rather than one derived from event data.
- Each chunk (`_translate_chunk`) retries the OpenAI call itself, with
  backoff, on transient failures (429/5xx/network) -- handled *inside* the
  step rather than relying on Inngest's own step-level retry. Reason: the
  Python SDK's step.run() re-delivers an already-terminally-failed step's
  error on every subsequent replay of a `step.parallel`/`group.parallel`
  group until every step in the group resolves in the same pass (this is
  how the SDK's request-reply execution model reconciles a group of
  concurrent steps that fail at different times) -- so any side effect
  (like our per-chunk progress counter or error log) triggered from
  catching that error would double/triple count. Making `_translate_chunk`
  itself never raise (always returning an {"ok": ...} dict, retrying
  internally first) sidesteps that entirely: the step succeeds exactly
  once from Inngest's point of view, so it's memoized normally with no
  replay ambiguity, while a chunk that still can't succeed after its own
  retries just reports `ok: False` without taking down its siblings or
  other languages' runs.

Languages are entirely data-driven (see `app/models.Language` /
`app/routes/languages.py`) -- adding a language never touches this file.
"""
import asyncio
import functools
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import inngest
from sqlalchemy import select, update

from app.db import SessionLocal
from app.inngest_app.client import inngest_client
from app.models import Language, PromptTemplate, Translation, TranslationHistory, TranslationRun

logger = logging.getLogger("uvicorn")

CHUNK_SIZE = 40
OPENAI_MODEL = "gpt-4o-mini"


def _export_output_dir() -> Path:
    return Path(os.environ.get("EXPORT_OUTPUT_DIR", "/data/output"))


def _load_active_target_languages(requested: list[str] | None = None) -> list[str]:
    with SessionLocal() as db:
        stmt = select(Language.code).where(Language.active.is_(True), Language.is_source.is_(False))
        active = set(db.execute(stmt).scalars().all())
    if requested:
        return [code for code in requested if code in active]
    return sorted(active)


def _start_run_tracking(language: str, total_terms: int) -> int:
    with SessionLocal() as db:
        run = TranslationRun(language=language, status="running", total_terms=total_terms)
        db.add(run)
        db.commit()
        db.refresh(run)
        return run.id


def _finish_run_tracking(
    run_id: int, translated_count: int, failed_chunks: int, status: str, error: str | None
) -> None:
    with SessionLocal() as db:
        run = db.get(TranslationRun, run_id)
        if run is None:
            return
        run.translated_count = translated_count
        run.failed_chunks = failed_chunks
        run.status = status
        run.error = error
        run.finished_at = datetime.now(timezone.utc)
        db.commit()


def _increment_run_progress(run_id: int, translated_delta: int, failed_delta: int) -> None:
    """Live progress for the dashboard's active-runs bar -- an approximate,
    best-effort counter (see `_finish_run_tracking` for the authoritative
    final tally computed from `results` once the language's run completes)."""
    with SessionLocal() as db:
        db.execute(
            update(TranslationRun)
            .where(TranslationRun.id == run_id)
            .values(
                translated_count=TranslationRun.translated_count + translated_delta,
                failed_chunks=TranslationRun.failed_chunks + failed_delta,
            )
        )
        db.commit()


def _load_needed_terms(language: str) -> list[dict[str, str]]:
    """Diff source rows against this language's existing rows: every term
    that isn't locked gets (re)translated on every run -- locking is the only
    thing that freezes a term (and the only way to keep a rerun's token cost
    down), rather than also skipping terms whose English text merely hasn't
    changed since it was last translated."""
    with SessionLocal() as db:
        source_code = db.execute(select(Language.code).where(Language.is_source.is_(True))).scalar_one()

        source_rows = db.execute(select(Translation).where(Translation.language == source_code)).scalars().all()
        existing_by_key = {
            row.key: row
            for row in db.execute(select(Translation).where(Translation.language == language)).scalars()
        }

        needed = []
        for row in source_rows:
            existing = existing_by_key.get(row.key)
            if existing is not None and existing.locked:
                continue
            needed.append({"key": row.key, "source_text": row.source_text, "source_hash": row.source_hash})
        return needed


def _chunk(items: list[dict[str, str]]) -> list[list[dict[str, str]]]:
    return [items[i : i + CHUNK_SIZE] for i in range(0, len(items), CHUNK_SIZE)]


def _load_prompt_template(language: str) -> str:
    with SessionLocal() as db:
        template = db.execute(
            select(PromptTemplate).where(PromptTemplate.language == language)
        ).scalar_one_or_none()
        if template is None:
            raise inngest.NonRetriableError(f"No prompt template configured for language '{language}'")
        return template.template_text


OPENAI_MAX_ATTEMPTS = 4  # 1 initial attempt + 3 retries
OPENAI_RETRYABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}


class _NonRetriableChunkError(Exception):
    """Raised for a chunk failure that a retry can't fix (bad/missing API key,
    rejected auth, unparseable model output) -- fails the chunk immediately
    instead of burning through backoff attempts."""


async def _call_openai_once(prompt: str) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise _NonRetriableChunkError("OPENAI_API_KEY is not set")

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": OPENAI_MODEL,
                "temperature": 0.2,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        if response.status_code in OPENAI_RETRYABLE_STATUS:
            response.raise_for_status()  # retryable -- let the caller's retry loop handle it
        if response.is_error:
            raise _NonRetriableChunkError(
                f"OpenAI request failed: {response.status_code} {response.text[:300]}"
            )
        return response.json()["choices"][0]["message"]["content"]


async def _call_openai_with_retry(prompt: str) -> str:
    """Retries transient failures (429/5xx/network) with backoff, *inside*
    this one step -- see the module docstring for why this can't be Inngest's
    own step-level retry for a step that's part of a parallel group."""
    last_exc: Exception | None = None
    for attempt in range(OPENAI_MAX_ATTEMPTS):
        try:
            return await _call_openai_once(prompt)
        except _NonRetriableChunkError:
            raise
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_exc = exc
            if attempt < OPENAI_MAX_ATTEMPTS - 1:
                await asyncio.sleep(2**attempt)
    raise last_exc  # type: ignore[misc]  -- loop always sets last_exc before exhausting attempts


def _parse_translations(content: str, chunk: list[dict[str, str]]) -> list[dict[str, str]]:
    match = re.search(r"\[[\s\S]*\]", content)
    try:
        parsed = json.loads(match.group(0) if match else content)
        by_key = {item["key"]: item["translatedText"] for item in parsed}
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise _NonRetriableChunkError(f"OpenAI response was not a valid translation array: {exc}") from exc

    return [{**term, "translated_text": by_key[term["key"]]} for term in chunk if term["key"] in by_key]


def _upsert_translations(language: str, translated: list[dict[str, str]]) -> int:
    written = 0
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        existing_by_key = {
            row.key: row
            for row in db.execute(select(Translation).where(Translation.language == language)).scalars()
        }

        for term in translated:
            existing = existing_by_key.get(term["key"])
            # Defense in depth: `_load_needed_terms` already filtered out locked rows,
            # but re-check right before writing in case a row was locked mid-run.
            if existing is not None and existing.locked:
                continue

            if existing is None:
                translation = Translation(
                    key=term["key"],
                    language=language,
                    source_text=term["source_text"],
                    source_hash=term["source_hash"],
                    translated_text=term["translated_text"],
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
                        translated_text=term["translated_text"],
                        source_hash=term["source_hash"],
                        change_type="ai",
                    )
                )
            elif existing.translated_text == term["translated_text"]:
                # Retranslating reproduced the same text (common now that every
                # unlocked term is resent on every run) -- refresh the source
                # tracking + timestamp only. No version bump, no history row:
                # nothing actually changed, so there's nothing new to version.
                existing.source_text = term["source_text"]
                existing.source_hash = term["source_hash"]
                existing.updated_at = now
            else:
                existing.source_text = term["source_text"]
                existing.source_hash = term["source_hash"]
                existing.translated_text = term["translated_text"]
                existing.version += 1
                existing.updated_at = now
                db.flush()
                db.add(
                    TranslationHistory(
                        translation_id=existing.id,
                        version=existing.version,
                        translated_text=term["translated_text"],
                        source_hash=term["source_hash"],
                        change_type="ai",
                    )
                )
            written += 1

        db.commit()
    return written


async def _translate_chunk(
    chunk: list[dict[str, str]], language: str, template_text: str, run_id: int, step_label: str
) -> dict[str, Any]:
    """Never raises -- always resolves to an {"ok": ...} dict so this step
    succeeds exactly once from Inngest's point of view (see module docstring
    for why that matters for a step that's part of `ctx.group.parallel`).
    Retries transient OpenAI failures internally; a chunk that still can't
    succeed reports `ok: False` without affecting its sibling chunks.
    """
    try:
        terms_json = json.dumps([{"key": t["key"], "text": t["source_text"]} for t in chunk], indent=2)
        prompt = template_text.replace("{{terms}}", terms_json)
        content = await _call_openai_with_retry(prompt)
        translated = _parse_translations(content, chunk)
        written = await asyncio.to_thread(_upsert_translations, language, translated)
        await asyncio.to_thread(_increment_run_progress, run_id, written, 0)
        return {"ok": True, "written": written}
    except Exception as exc:  # noqa: BLE001 -- isolate one bad chunk from its siblings/other languages
        logger.error("%s (language=%s) failed: %s", step_label, language, exc)
        await asyncio.to_thread(_increment_run_progress, run_id, 0, 1)
        return {"ok": False, "error": str(exc)}


def _reconstruct_and_export(language: str) -> str:
    with SessionLocal() as db:
        rows = db.execute(select(Translation).where(Translation.language == language)).scalars().all()

    nested: dict[str, Any] = {}
    for row in rows:
        parts = row.key.split(".")
        cursor = nested
        for part in parts[:-1]:
            cursor = cursor.setdefault(part, {})
        cursor[parts[-1]] = row.translated_text

    output_dir = _export_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"terms.{language}.json"
    output_path.write_text(json.dumps(nested, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(output_path)


@inngest_client.create_function(
    fn_id="run-translation",
    trigger=inngest.TriggerEvent(event="translation/run.requested"),
    retries=1,
)
async def run_translation(ctx: inngest.Context) -> dict[str, Any]:
    """Fans out one `translation/language.requested` event per target language
    -- generic replacement for n8n's hardcoded FR/ES branches. `ctx.event.data
    ["languages"]` lets the caller (POST /api/translation-runs) restrict this
    to a subset (e.g. just German) instead of always running every active
    target language."""
    requested = ctx.event.data.get("languages") or None
    languages = await ctx.step.run("load-target-languages", _load_active_target_languages, requested)

    if languages:
        await ctx.step.send_event(
            "dispatch-languages",
            [inngest.Event(name="translation/language.requested", data={"language": code}) for code in languages],
        )

    return {"languages": languages}


@inngest_client.create_function(
    fn_id="translate-language",
    trigger=inngest.TriggerEvent(event="translation/language.requested"),
    retries=3,
    concurrency=[
        # A *static* key (not derived from event data) shares this limit across every
        # language's run, capping total concurrent OpenAI calls app-wide at 5.
        inngest.Concurrency(limit=5, key='"openai-translate"'),
    ],
)
async def translate_language(ctx: inngest.Context) -> dict[str, Any]:
    language = ctx.event.data["language"]

    needed = await ctx.step.run("diff-needed", _load_needed_terms, language)
    if not needed:
        await ctx.step.run("export", _reconstruct_and_export, language)
        return {"language": language, "translated": 0, "chunks": 0}

    # Tracked in `translation_runs` so the dashboard can show a live "what's
    # translating right now" indicator (GET /api/translation-runs) instead of
    # only being visible in the Inngest dev server UI.
    run_id = await ctx.step.run("start-run-tracking", _start_run_tracking, language, len(needed))

    translated = 0
    failed_chunks = 0
    status = "succeeded"
    error: str | None = None
    chunks: list[list[dict[str, str]]] = []

    try:
        template_text = await ctx.step.run("load-prompt-template", _load_prompt_template, language)
        chunks = await ctx.step.run("chunk", _chunk, needed)

        parallel_steps = tuple(
            functools.partial(
                ctx.step.run,
                f"translate-chunk-{i}",
                _translate_chunk,
                chunk,
                language,
                template_text,
                run_id,
                f"translate-chunk-{i}",
            )
            for i, chunk in enumerate(chunks)
        )
        results = list(await ctx.group.parallel(parallel_steps))

        translated = sum(r["written"] for r in results if r.get("ok"))
        failed_chunks = sum(1 for r in results if not r.get("ok"))
        status = "succeeded" if failed_chunks == 0 else "partial"
    except Exception as exc:  # noqa: BLE001 -- record it on the run row, then still export/re-raise
        status = "failed"
        error = str(exc)

    await ctx.step.run("finish-run-tracking", _finish_run_tracking, run_id, translated, failed_chunks, status, error)
    await ctx.step.run("export", _reconstruct_and_export, language)

    if status == "failed":
        raise Exception(error)  # noqa: TRY002 -- surfaces the failure in the Inngest UI too

    return {
        "language": language,
        "chunks": len(chunks),
        "translated": translated,
        "failed_chunks": failed_chunks,
    }


ALL_FUNCTIONS = [run_translation, translate_language]

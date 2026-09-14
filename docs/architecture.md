# Architecture

## Components

- **MySQL** — the single source of truth. Four tables: `languages`, `translations`, `translation_history`, `prompt_templates` (see `db/schema.sql`). The Inngest pipeline and the dashboard never talk to each other directly — only through this database.
- **`languages` table** — the list of source/target languages is data, not code. Each row is `{code, label, is_source, active, sort_order}`; exactly one row has `is_source=true` (English by default). The translation pipeline, the prompt-template routes, and the dashboard's language dropdowns all read this table instead of hardcoding language codes — adding a language is an insert (via the dashboard's **Languages** page) plus a prompt template, never a code change.
- **Inngest** (self-hosted dev server, Docker) — runs the translation pipeline as durable functions (`dashboard/backend/app/inngest_app/functions.py`), replacing the old n8n workflows:
  - `run_translation` (triggered by `POST /api/translation-runs`): loads active target languages from `languages` and fans out one `translation/language.requested` event per language.
  - `translate_language`: diffs the source language's rows against this language's existing rows, skipping only `locked` rows -- every unlocked term is (re)translated on every run, whether it's new or its English text is unchanged, so locking is the sole way to freeze a term and keep a rerun's token cost down. Chunks the remaining terms (~40/chunk) and translates chunks **concurrently** via `step.parallel`, each chunk calling the OpenAI Chat Completions API directly over HTTP (`OPENAI_API_KEY` from the container environment) and upserting results (the upsert re-checks `locked` at write time as a second line of defense). Then reconstructs and writes `/data/output/terms.<lang>.json`.
  - **Retries**: the function is configured with `retries=3` — Inngest retries only the failed step (e.g. one bad chunk's OpenAI call), not the whole run; already-succeeded chunks are never redone (step results are memoized). A chunk that still fails after retries are exhausted is caught so it can't take down its sibling chunks or other languages' runs.
  - **Concurrency**: a function-level concurrency limit (`Concurrency(limit=5, key='"openai-translate"')`) caps total concurrent OpenAI calls at 5 **system-wide**, across every language's run at once — a static key shared across all invocations, not one derived from event data.
  - Progress, retries, and concurrency are all visible in the Inngest dev server's own UI at `localhost:8288` (the same role n8n's UI used to play).
- **Dashboard backend** (FastAPI, `dashboard/backend/`) — the only way a human touches the data: fetch the full translation set (filtered/searched client-side), lock/unlock, manually edit a translated value (versioned), view history, manage languages and their prompt templates, import an English JSON file directly through the UI, trigger a translation run, and download the current translated JSON per language.
- **Dashboard frontend** (React + Vite, `dashboard/frontend/`) — Translations table/search/lock UI, Languages page (add/deactivate/delete languages + edit their prompt templates), Import/Export page.

## Data flow

```
terms.en.json --(dashboard "Import")--> MySQL (source-language rows)
                                                 |
                          POST /api/translation-runs --> Inngest event `translation/run.requested`
                                                 v
                              run_translation: load active languages from `languages`
                                                 v
                     fan out `translation/language.requested` per language (parallel across languages)
                                                 v
                translate_language: diff vs existing rows (skip locked only) --> chunk (~40 terms)
                                                 v
                    chunks translate concurrently (step.parallel, retries=3, concurrency limit=5)
                                                 v
                              OpenAI chat completion (prompt from prompt_templates)
                                                 v
                          upsert translations (version++, history row, change_type='ai')
                                                 v
                                    MySQL <-----> Dashboard (search/lock/edit/history/languages)
                                                 v
                        Inngest export step --> /data/output/terms.<lang>.json
                        (dashboard "Export" page can also produce this on demand)
```

## Why these choices (decided with the user)

- **MySQL, self-hosted via Docker Compose, no AWS**: internal tool, 500–5,000 terms, regular reruns; matches the user's stronger MySQL skill set. Locking/versioning are trivial as columns/rows, and there's no existing AWS footprint to justify RDS/Aurora overhead.
- **Inngest over n8n**: n8n's `executeWorkflow` "each" mode has no built-in retry/backoff or concurrency cap — a bad OpenAI call just fails the run, and nothing bounds how many chunks hit OpenAI at once. Inngest's Python SDK runs in-process with the existing FastAPI backend (no new runtime/language) and gives durable per-step retries plus a real concurrency limit for free.
- **Languages as data**: a hardcoded per-language workflow/branch (the old n8n sub-workflow-per-language, or a `fr`/`es` tuple in code) means every new language is a code change. The `languages` table + dashboard UI make it a data change instead.
- **In-memory client-side filtering**: the dataset is small (hundreds-to-low-thousands of terms × a handful of languages), so the dashboard fetches the full translation set once and filters/paginates entirely in the browser — instant, zero-latency search with no per-keystroke network round-trip. `GET /api/translations` has no pagination/search query params; it just returns everything.
- **Separate `languages`/`prompt_templates` per target language** rather than one generic multi-language prompt: each language gets its own editable prompt template and can be tuned/retried independently; a bad chunk for one language never blocks another.
- **Locking is the only rerun-cost control**: every unlocked term is resent to the API on every run, regardless of whether its English text changed -- this is deliberate (proofread once, lock it, and it's excluded from every future run's token cost) rather than also silently skipping "unchanged" unlocked terms, which would make it unobvious why a term wasn't retranslated. `source_hash` (sha256 of the source text) is still recorded on each row for reference, but no longer gates whether a term gets translated.
- **No QA/review pass in v1**: the dashboard's lock feature is the quality gate — a human reviews and locks good translations. A second LLM review pass can be added later as a fast-follow if quality issues show up in practice.
- **No auth in v1**: single shared internal tool. Add a real auth layer before exposing this beyond a trusted internal network.

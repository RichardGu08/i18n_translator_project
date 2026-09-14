# Runbook — Local / Self-Hosted Setup

## Prerequisites
- Docker + Docker Compose
- An OpenAI API key

## 1. Configure environment
```
cp .env.example .env
# then edit .env: set OPENAI_API_KEY, and change MYSQL_ROOT_PASSWORD / MYSQL_PASSWORD from the defaults
```

## 2. Start everything
```
docker compose up -d
```
This starts:
- **MySQL** on `localhost:3306`, auto-initialized from `db/schema.sql` (including `en`/`fr`/`es` in the `languages` table and their default prompt templates) the first time the volume is created.
- **Inngest dev server** on `http://localhost:8288` — watch the translation pipeline's runs, retries, and concurrency here. It auto-discovers the functions registered by the dashboard backend at `/api/inngest`; no manual linking/import step is needed (unlike the old n8n setup).
- **Dashboard backend** (FastAPI) on `http://localhost:8000` (docs at `/docs`)
- **Dashboard frontend** (React) on `http://localhost:5173`

## 3. Run a translation
1. Drop your English terms file at `data/input/terms.en.json` (nested JSON of strings, any depth — it gets flattened to dot-path keys, e.g. `settings.title`).
2. In the dashboard, open **Import / Export** and upload that file (or `POST /api/import` directly) — this upserts the source-language rows.
3. Click **Run Translation** (or `POST /api/translation-runs`). This sends an event to Inngest, which fans out one run per active target language, diffs/chunks/translates each independently (skipping anything locked or already up to date), and writes `data/output/terms.<lang>.json` per language.
4. Watch progress, retries, and concurrency at `http://localhost:8288`.

## 4. Managing languages
Open the dashboard's **Languages** page:
- Add a target language (code + label + an initial prompt template, or add the template later).
- Deactivate a language to exclude it from future translation runs without deleting its data.
- Delete a language only removes it if it has zero translation rows — otherwise deactivate it instead.
- Edit any target language's prompt template inline (`{{terms}}` is replaced with the chunk's key/text pairs — don't remove that placeholder).

## 5. Using the dashboard
Open `http://localhost:5173`:
- **Translations**: the full translation set is fetched once and filtered/searched entirely client-side (instant, no per-keystroke network call) — search by key or text, filter by language/locked, toggle the lock checkbox to protect a translation from future translation runs, expand a row to hand-edit a translation or view its version history. Use **Refresh** to re-pull the dataset after an import or once a translation run has finished.
- **Languages**: see §4 above.
- **Import/Export**: upload an English JSON file, trigger a translation run, or download the current translated JSON per language.

## Troubleshooting
- **A translation didn't update on rerun**: check its `locked` flag in the dashboard -- locking is the only thing that excludes a term from a run; every unlocked term is retranslated on every run regardless of whether its English text changed.
- **A translation run fails or a chunk keeps erroring**: open `http://localhost:8288` to see which step failed and why (e.g. missing `OPENAI_API_KEY`, malformed model output, rate limiting) — failed chunks are isolated and retried independently per the function's `retries=3` config.
- **Chunks seem to translate slower than expected**: the pipeline caps concurrent OpenAI calls at 5 system-wide (see `docs/architecture.md`) to avoid rate-limit storms; this is intentional, not a bug.

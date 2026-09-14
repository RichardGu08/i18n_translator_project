# i18n Translator

Takes an English UI-terms JSON file and produces translations into any number of configured target languages via the OpenAI API, orchestrated by Inngest (self-hosted), with a dashboard for managing languages/prompts, locking translations, searching, and viewing history.

- **Architecture / design decisions**: [docs/architecture.md](docs/architecture.md)
- **Setup & usage**: [docs/runbook.md](docs/runbook.md)

## Layout
- `dashboard/backend/` — FastAPI API over the shared MySQL DB, and the Inngest translation pipeline (`app/inngest_app/`)
- `dashboard/frontend/` — React dashboard UI (Translations, Languages, Import/Export)
- `db/schema.sql` — MySQL schema (`languages`, `translations`, `translation_history`, `prompt_templates`)
- `docker-compose.yml` — MySQL + self-hosted Inngest dev server + dashboard, self-hosted

Quick start: `cp .env.example .env`, fill in `OPENAI_API_KEY`, then `docker compose up -d`. See the runbook for details.

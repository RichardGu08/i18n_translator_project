import inngest.fast_api
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.inngest_app.client import inngest_client
from app.inngest_app.functions import ALL_FUNCTIONS
from app.routes import import_export, languages, prompts, translation_runs, translations

app = FastAPI(title="i18n Translation Dashboard API", version="1.0.0")

# Permissive CORS for this internal v1 tool -- no auth, single deployment,
# frontend origin may vary (dev server, docker-compose service, etc).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(translations.router)
app.include_router(languages.router)
app.include_router(prompts.router)
app.include_router(import_export.router)
app.include_router(translation_runs.router)

inngest.fast_api.serve(app, inngest_client, ALL_FUNCTIONS)


@app.get("/health")
def health():
    return {"status": "ok"}

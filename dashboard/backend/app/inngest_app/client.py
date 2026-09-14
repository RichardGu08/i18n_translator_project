"""Shared Inngest client.

Runs against the self-hosted Inngest dev server (docker-compose service
`inngest`) -- no signing/event keys needed, controlled entirely by the
INNGEST_DEV env var (see docker-compose.yml).
"""
import logging

import inngest

inngest_client = inngest.Inngest(
    app_id="i18n-translator",
    is_production=False,
    logger=logging.getLogger("uvicorn"),
)

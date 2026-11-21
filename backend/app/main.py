"""FastAPI application factory (`backend/app/main.py` in ARCHITECTURE.md).

Run it with ``uvicorn app.main:app`` from ``backend/``. The factory exists so tests and
the CLI can build an app against a temporary database: :func:`create_app` reads the
*current* :mod:`app.core.config` settings and every session binds itself to the engine
for those settings (see :mod:`app.core.db`), so pointing ``MYOS_DATABASE_URL`` at a
scratch file is enough - nothing has to be re-imported.

Startup does two things:

1. ``bootstrap`` (default: ``MYOS_AUTO_CREATE=1``) creates any missing table so a fresh
   checkout answers requests immediately. Alembic stays the documented production path:
   ``python -m alembic upgrade head`` with ``MYOS_AUTO_CREATE=0``.
2. The workspace behind ``MYOS_WORKSPACE`` is resolved (and created when absent), so
   ``GET /health`` answers on a completely empty database.

There is deliberately no CORS middleware: the browser only ever talks to the Next.js
proxy, which is server-side (ARCHITECTURE.md §1).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from app.api.v1 import api_router
from app.core.config import APP_VERSION, get_settings
from app.core.db import init_db, session_scope
from app.core.errors import register_exception_handlers
from app.core.json import ZJSONResponse
from app.services import context


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if app.state.bootstrap:
        init_db()
        with session_scope() as session:
            context.resolve_workspace(session)
    yield


def create_app(
    *,
    bootstrap: bool | None = None,
    api_prefix: str | None = None,
    docs: bool = True,
) -> FastAPI:
    """Build the MyOS API; ``bootstrap`` defaults to ``MYOS_AUTO_CREATE``."""
    settings = get_settings()
    app = FastAPI(
        title="MyOS API",
        version=APP_VERSION,
        description="Phase 1 backend for MyOS. The contract is docs/MYOS/API.md.",
        default_response_class=ZJSONResponse,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.bootstrap = settings.auto_create if bootstrap is None else bootstrap

    register_exception_handlers(app)

    prefix = settings.api_prefix if api_prefix is None else api_prefix
    app.include_router(api_router, prefix=prefix)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, Any]:
        """A pointer to the API, handy when a browser lands on port 8000."""
        return {
            "name": "MyOS API",
            "version": APP_VERSION,
            "workspace": settings.workspace,
            "database": settings.database_family,
            "api": prefix,
            "health": f"{prefix}/health",
            "docs": "/docs" if docs else None,
        }

    return app


#: the object uvicorn imports: ``uvicorn app.main:app``
app = create_app()

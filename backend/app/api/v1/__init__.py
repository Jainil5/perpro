"""``app.api.v1`` - the routers of the v1 surface, assembled into one APIRouter.

Order matters only for docs; every router owns a distinct path prefix. `main.py` mounts
the result under ``settings.api_prefix`` (``/api/v1``).
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    catalogue,
    finance,
    ledger,
    milestones,
    notes,
    people,
    projects,
    results,
    scenarios,
    signals,
    system,
    tasks,
)

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
api_router.include_router(milestones.router, prefix="/milestones", tags=["milestones"])
api_router.include_router(notes.router)
api_router.include_router(people.router)
api_router.include_router(results.router)
api_router.include_router(signals.router)
# Phase 3 (PHASE3_FINANCE.md §4): the finance surface owns its paths, so no prefixes
api_router.include_router(finance.router)
api_router.include_router(catalogue.router)
api_router.include_router(ledger.router)
api_router.include_router(scenarios.router)

__all__ = ["api_router"]

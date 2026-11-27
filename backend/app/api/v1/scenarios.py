"""Cost scenarios: ``/cost-scenarios``, their items, the projection and the compare.

A scenario stores a name, a first month and a horizon; the curve is rebuilt from the items
on every call (PHASE3_FINANCE.md §4: "totals are **never** stored"). `duplicate` and
`activate` are the two writes that touch more than one row, so they are explicit POST
actions with their own activity entries rather than side effects of a PATCH.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import (
    CurrencyQuery,
    DirQuery,
    DbSession,
    Today,
    WorkspaceScope,
    enum_param,
    sort_param,
)
from app.schemas.finance import (
    ActivateOut,
    CompareOut,
    DuplicateOut,
    ItemCreate,
    ItemUpdate,
    ProjectionOut,
    ScenarioCreate,
    ScenarioItemOut,
    ScenarioItemWriteOut,
    ScenarioListOut,
    ScenarioOut,
    ScenarioUpdate,
)
from app.services import scenarios

router = APIRouter(tags=["scenarios"])

ScenarioStatusQuery = Annotated[str | None, enum_param("scenario.status", "status")]
ScenarioKindQuery = Annotated[str | None, enum_param("scenario.kind", "kind")]
ScenarioSortQuery = Annotated[
    str, sort_param("name", "start", "created", "updated", default="updated")
]


@router.get(
    "/cost-scenarios", response_model=ScenarioListOut, summary="Every plan, newest first"
)
def list_scenarios(
    session: DbSession,
    scope: WorkspaceScope,
    status_filter: ScenarioStatusQuery,
    kind: ScenarioKindQuery,
    sort: ScenarioSortQuery,
    direction: DirQuery,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    items, total = scenarios.list_scenarios(
        session, scope, status=status_filter, kind=kind, query=q, sort=sort, direction=direction
    )
    return {"items": items, "total": total}


@router.post(
    "/cost-scenarios",
    response_model=ScenarioOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a plan (no items yet)",
)
def create_scenario(
    session: DbSession, scope: WorkspaceScope, payload: ScenarioCreate
) -> dict:
    return scenarios.create_scenario(session, scope, payload.model_dump(exclude_unset=True))


@router.get(
    "/cost-scenarios/compare",
    response_model=CompareOut,
    summary="Two curves on one month axis, plus the delta",
)
def compare_scenarios(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    a: Annotated[str, Query(description="first scenario id")],
    b: Annotated[str, Query(description="second scenario id")],
    currency: CurrencyQuery = None,
) -> dict:
    return scenarios.compare(session, scope, a_id=a, b_id=b, currency=currency, today=today)


@router.get(
    "/cost-scenarios/{scenario_id}",
    response_model=ScenarioOut,
    summary="One scenario with its items nested",
)
def get_scenario(session: DbSession, scope: WorkspaceScope, scenario_id: str) -> dict:
    return scenarios.get_scenario(session, scope, scenario_id)


@router.patch(
    "/cost-scenarios/{scenario_id}", response_model=ScenarioOut, summary="Update a scenario"
)
def update_scenario(
    session: DbSession,
    scope: WorkspaceScope,
    scenario_id: str,
    payload: ScenarioUpdate,
) -> dict:
    return scenarios.update_scenario(
        session, scope, scenario_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/cost-scenarios/{scenario_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a scenario (items cascade)",
)
def delete_scenario(session: DbSession, scope: WorkspaceScope, scenario_id: str) -> Response:
    scenarios.delete_scenario(session, scope, scenario_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/cost-scenarios/{scenario_id}/duplicate",
    response_model=DuplicateOut,
    summary="Copy a plan and its items as a draft",
)
def duplicate_scenario(session: DbSession, scope: WorkspaceScope, scenario_id: str) -> dict:
    return scenarios.duplicate(session, scope, scenario_id)


@router.post(
    "/cost-scenarios/{scenario_id}/activate",
    response_model=ActivateOut,
    summary="Make this the active plan; the previous one is archived",
)
def activate_scenario(session: DbSession, scope: WorkspaceScope, scenario_id: str) -> dict:
    return scenarios.activate(session, scope, scenario_id)


@router.get(
    "/cost-scenarios/{scenario_id}/projection",
    response_model=ProjectionOut,
    summary="The monthly curve, break-even and runway",
)
def projection(
    session: DbSession,
    scope: WorkspaceScope,
    scenario_id: str,
    today: Today,
    horizon_months: Annotated[int | None, Query(ge=1, le=120)] = None,
    currency: CurrencyQuery = None,
) -> dict:
    return scenarios.projection(
        session,
        scope,
        scenario_id,
        today=today,
        horizon_months=horizon_months,
        currency=currency,
    )


@router.get(
    "/cost-scenarios/{scenario_id}/items",
    response_model=ScenarioItemWriteOut,
    summary="The items of one scenario",
)
def list_items(session: DbSession, scope: WorkspaceScope, scenario_id: str) -> dict:
    items, total = scenarios.list_items(session, scope, scenario_id)
    return {"items": items, "total": total}


@router.post(
    "/cost-scenarios/{scenario_id}/items",
    response_model=ScenarioItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a line to the curve",
)
def create_item(
    session: DbSession,
    scope: WorkspaceScope,
    scenario_id: str,
    payload: ItemCreate,
) -> dict:
    return scenarios.create_item(
        session, scope, scenario_id, payload.model_dump(exclude_unset=True)
    )


@router.patch(
    "/cost-scenario-items/{item_id}",
    response_model=ScenarioItemOut,
    summary="Update an item",
)
def update_item(
    session: DbSession, scope: WorkspaceScope, item_id: str, payload: ItemUpdate
) -> dict:
    return scenarios.update_item(
        session, scope, item_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/cost-scenario-items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an item",
)
def delete_item(session: DbSession, scope: WorkspaceScope, item_id: str) -> Response:
    scenarios.delete_item(session, scope, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]

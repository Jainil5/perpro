"""What you sell and what you pay monthly: ``/services``, ``/service-plans``, ``/subscriptions``.

The catalogue stores prices; the API is the only place that turns them into a *monthly*
figure, a per-unit rate, or a revenue total, so editing a plan cannot leave a stale sum
behind (DATA_MODEL.md §7). Subscriptions keep the same rule: `monthly_cost`,
`renews_in_days` and `is_running` are derived per call in
:mod:`app.services.subscriptions`.
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
    value_param,
)
from app.schemas.finance import (
    PlanCreate,
    PlanUpdate,
    ServiceCreate,
    ServiceDetailOut,
    ServiceListOut,
    ServiceOut,
    ServicePlanListOut,
    ServicePlanOut,
    ServiceUpdate,
    SubscriptionCreate,
    SubscriptionListOut,
    SubscriptionUpdate,
    SubscriptionWriteOut,
)
from app.services import catalogue, serializers, subscriptions

router = APIRouter(tags=["catalogue"])

RENEWAL_WINDOWS = ("month", "week", "past")

ServiceSortQuery = Annotated[str, sort_param("updated", "name", "price", default="updated")]
PlanSortQuery = Annotated[str, sort_param("price", "name", "created", default="price")]
SubscriptionSortQuery = Annotated[
    str, sort_param("renews", "price", "created", "cost", default="renews")
]
UnitQuery = Annotated[str | None, enum_param("service.unit", "unit")]
IntervalQuery = Annotated[str | None, enum_param("plan.interval", "interval")]
SubscriptionStatusQuery = Annotated[
    str | None, enum_param("subscription.status", "status")
]
RenewsQuery = Annotated[
    str | None, value_param(RENEWAL_WINDOWS, "renews", unit="renewal window")
]
LimitQuery = Annotated[int, Query(ge=1, le=1000)]
OffsetQuery = Annotated[int, Query(ge=0)]


# ------------------------------------------------------------------------ services
@router.get(
    "/services", response_model=ServiceListOut, summary="The service catalogue"
)
def list_services(
    session: DbSession,
    scope: WorkspaceScope,
    sort: ServiceSortQuery,
    direction: DirQuery,
    unit: UnitQuery,
    active: Annotated[bool | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = catalogue.list_services(
        session,
        scope,
        query=q,
        active=active,
        unit=unit,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/services",
    response_model=ServiceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a service",
)
def create_service(session: DbSession, scope: WorkspaceScope, payload: ServiceCreate) -> dict:
    return catalogue.create_service(session, scope, payload.model_dump())


@router.get(
    "/services/{service_id}",
    response_model=ServiceDetailOut,
    summary="A service with its plans and its revenue",
)
def get_service(
    session: DbSession, scope: WorkspaceScope, service_id: str, today: Today
) -> dict:
    return catalogue.service_detail(session, scope, service_id, today=today)


@router.patch(
    "/services/{service_id}", response_model=ServiceOut, summary="Update a service"
)
def update_service(
    session: DbSession, scope: WorkspaceScope, service_id: str, payload: ServiceUpdate
) -> dict:
    return catalogue.update_service(
        session, scope, service_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/services/{service_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a service (plans cascade)",
)
def delete_service(session: DbSession, scope: WorkspaceScope, service_id: str) -> Response:
    catalogue.delete_service(session, scope, service_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------- service plans
@router.get(
    "/service-plans",
    response_model=ServicePlanListOut,
    summary="Every plan, with monthly price and subscriber count",
)
def list_plans(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    sort: PlanSortQuery,
    direction: DirQuery,
    interval: IntervalQuery,
    service_id: Annotated[str | None, Query()] = None,
    active: Annotated[bool | None, Query()] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = catalogue.list_plans(
        session,
        scope,
        today=today,
        service_id=service_id,
        interval=interval,
        active=active,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/service-plans",
    response_model=ServicePlanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a plan to a service",
)
def create_plan(session: DbSession, scope: WorkspaceScope, payload: PlanCreate) -> dict:
    return catalogue.create_plan(session, scope, payload.model_dump())


@router.get(
    "/service-plans/{plan_id}", response_model=ServicePlanOut, summary="One plan"
)
def get_plan(session: DbSession, scope: WorkspaceScope, plan_id: str, today: Today) -> dict:
    return catalogue.get_plan(session, scope, plan_id, today=today)


@router.patch(
    "/service-plans/{plan_id}", response_model=ServicePlanOut, summary="Update a plan"
)
def update_plan(
    session: DbSession,
    scope: WorkspaceScope,
    plan_id: str,
    payload: PlanUpdate,
    today: Today,
) -> dict:
    return catalogue.update_plan(
        session, scope, plan_id, payload.model_dump(exclude_unset=True), today=today
    )


@router.delete(
    "/service-plans/{plan_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a plan (subscriptions lose the link)",
)
def delete_plan(session: DbSession, scope: WorkspaceScope, plan_id: str) -> Response:
    catalogue.delete_plan(session, scope, plan_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ subscriptions
@router.get(
    "/subscriptions",
    response_model=SubscriptionListOut,
    summary="Recurring commitments with their renewal maths",
)
def list_subscriptions(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: SubscriptionStatusQuery,
    renews: RenewsQuery,
    sort: SubscriptionSortQuery,
    direction: DirQuery,
    currency: CurrencyQuery,
    q: Annotated[str | None, Query()] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = subscriptions.list_subscriptions(
        session,
        scope,
        status=status_filter,
        renews=renews,
        query=q,
        currency=currency,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/subscriptions",
    response_model=SubscriptionWriteOut,
    status_code=status.HTTP_201_CREATED,
    summary="Start a commitment; a past renewal date is flagged, not refused",
)
def create_subscription(
    session: DbSession,
    scope: WorkspaceScope,
    payload: SubscriptionCreate,
    today: Today,
) -> dict:
    return subscriptions.create_subscription(
        session, scope, payload.model_dump(exclude_unset=True), today=today
    )


@router.get(
    "/subscriptions/{subscription_id}",
    response_model=SubscriptionWriteOut,
    summary="One subscription, derived block included",
)
def get_subscription(
    session: DbSession,
    scope: WorkspaceScope,
    subscription_id: str,
    today: Today,
) -> dict:
    return subscriptions.get_subscription(session, scope, subscription_id, today=today)


@router.patch(
    "/subscriptions/{subscription_id}",
    response_model=SubscriptionWriteOut,
    summary="Update a subscription",
)
def update_subscription(
    session: DbSession,
    scope: WorkspaceScope,
    subscription_id: str,
    payload: SubscriptionUpdate,
    today: Today,
) -> dict:
    return subscriptions.update_subscription(
        session,
        scope,
        subscription_id,
        payload.model_dump(exclude_unset=True),
        today=today,
    )


@router.delete(
    "/subscriptions/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a subscription",
)
def delete_subscription(
    session: DbSession, scope: WorkspaceScope, subscription_id: str
) -> Response:
    subscriptions.delete_subscription(session, scope, subscription_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/subscriptions/{subscription_id}/pause",
    response_model=SubscriptionWriteOut,
    summary="Pause a commitment",
)
def pause_subscription(
    session: DbSession, scope: WorkspaceScope, subscription_id: str, today: Today
) -> dict:
    return subscriptions.pause(session, scope, subscription_id, today=today)


@router.post(
    "/subscriptions/{subscription_id}/resume",
    response_model=SubscriptionWriteOut,
    summary="Resume a paused or cancelled commitment",
)
def resume_subscription(
    session: DbSession, scope: WorkspaceScope, subscription_id: str, today: Today
) -> dict:
    return subscriptions.resume(session, scope, subscription_id, today=today)


@router.post(
    "/subscriptions/{subscription_id}/cancel",
    response_model=SubscriptionWriteOut,
    summary="Cancel a commitment from today",
)
def cancel_subscription(
    session: DbSession, scope: WorkspaceScope, subscription_id: str, today: Today
) -> dict:
    return subscriptions.cancel(session, scope, subscription_id, today=today)


__all__ = ["router"]

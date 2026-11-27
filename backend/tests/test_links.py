"""The deep-link contract: one helper, canonical routes, never a literal ``None``.

``app/services.links.href_for`` is the only place that turns an entity into an href; these
tests pin the mapping it produces, sweep every endpoint that hands hrefs to the UI, and
reject both the retired prefixed routes and any id that failed to resolve.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services import activity, dashboard, links, milestones, notifications, search
from tests.helpers import (
    make_company,
    make_contact,
    make_goal,
    make_milestone,
    make_note,
    make_project,
    make_reminder,
    make_task,
)

V1 = "/api/v1"
DAY = dt.date(2026, 11, 21)

#: every target the backend may emit: a canonical page, or a page plus one selecting parameter
LIST_PAGES = (
    "/tasks",
    "/projects",
    "/notes",
    "/contacts",
    "/goals",
    "/notifications",
    "/activity",
    "/search",
    "/settings",
    # Phase 3 (PHASE3_FINANCE.md §7): the finance screens, root first
    "/finance",
    "/finance/currency",
    "/finance/expenses",
    "/finance/income",
    "/finance/scenarios",
    "/finance/services",
    "/finance/subscriptions",
    "/",
)
ALLOWED_HREF = re.compile(
    r"^("
    + "|".join(re.escape(page) for page in LIST_PAGES if page != "/")
    + r"|"
    + r"/"
    + r")"
    r"("
    r"/[0-9a-fA-F-]{8,}"  # only projects take an id in the path
    r"|\?(task|note|contact|q|filter|expense|category|income|sub|service|scenario|pair)=[^?&#]+"
    r")?$"
)


def assert_valid_href(href: str | None, where: str) -> None:
    """``None`` means "no link" (allowed); a string must be a real canonical route."""
    if href is None:
        return
    assert "None" not in href, f"{where}: literal None leaked into {href!r}"
    assert not href.startswith("/os"), f"{where}: {href!r} still uses the retired /os prefix"
    assert ALLOWED_HREF.match(href), f"{where}: {href!r} is not a route the UI has"


# --------------------------------------------------------------------- the helper


def test_every_entity_links_to_the_canonical_route() -> None:
    assert links.href_for("task", "t-1") == "/tasks?task=t-1"
    assert links.href_for("note", "n-1") == "/notes?note=n-1"
    assert links.href_for("contact", "c-1") == "/contacts?contact=c-1"
    assert links.href_for("project", "p-1") == "/projects/p-1"
    assert links.href_for("milestone", "m-1", project_id="p-1") == "/projects/p-1"
    assert links.href_for("goal", "g-1") == "/goals"
    assert links.href_for("reminder", "r-1") == "/notifications"
    assert links.href_for("notification", "x-1") == "/notifications"
    assert links.href_for("company", "co-1") == "/contacts"
    assert links.href_for("workspace", "w-1") == "/settings"
    assert links.href_for("activity", "a-1") == "/activity"


def test_a_milestone_without_a_project_opens_the_project_list() -> None:
    # the old template produced "<prefix>/projects/None"; the guard lives in href_for
    assert links.href_for("milestone", "m-1") == "/projects"
    assert links.href_for("milestone", "m-1", project_id=None) == "/projects"
    assert links.href_for("milestone", "m-1", project_id="None") == "/projects"
    assert links.href_for("milestone", None, project_id="") == "/projects"


def test_a_missing_id_falls_back_to_the_list_page() -> None:
    for kind, page in (
        ("task", "/tasks"),
        ("note", "/notes"),
        ("contact", "/contacts"),
        ("project", "/projects"),
        ("goal", "/goals"),
        ("reminder", "/notifications"),
        ("company", "/contacts"),
        ("workspace", "/settings"),
    ):
        assert links.href_for(kind) == page
        assert links.href_for(kind, None) == page
        assert links.href_for(kind, "None") == page


def test_plurals_and_unknown_types() -> None:
    assert links.href_for("tasks", "t-1") == "/tasks?task=t-1"
    assert links.href_for("COMPANIES", "c-1") == "/contacts"
    assert links.href_for("widget", "x-1") is None
    assert links.href_for(None) is None
    assert links.href_for("") is None


def test_route_constants_are_canonical() -> None:
    """The whole surface of the module, so a stray prefix shows up here first."""
    pages = [
        links.ACTIVITY,
        links.CONTACTS,
        links.GOALS,
        links.NOTES,
        links.NOTIFICATIONS,
        links.PROJECTS,
        links.SEARCH,
        links.SETTINGS,
        links.TASKS,
        links.TASKS_OVERDUE,
        links.TASKS_DUE_TODAY,
        links.TASKS_DUE_WEEK,
    ]
    assert pages == [
        "/activity",
        "/contacts",
        "/goals",
        "/notes",
        "/notifications",
        "/projects",
        "/search",
        "/settings",
        "/tasks",
        "/tasks?filter=overdue",
        "/tasks?filter=today",
        "/tasks?filter=week",
    ]
    for page in pages:
        assert not page.startswith("/os")


def test_finance_entities_link_to_their_own_screens() -> None:
    """§7: each finance entity type opens the screen that lists it, with the row selected."""
    assert links.href_for("expense", "e-1") == "/finance/expenses?expense=e-1"
    assert links.href_for("expense_category", "c-1") == "/finance/expenses?category=c-1"
    assert links.href_for("income", "i-1") == "/finance/income?income=i-1"
    assert links.href_for("income_transactions", "i-1") == "/finance/income?income=i-1"
    assert links.href_for("income_profile", "p-1") == "/finance/income"
    assert links.href_for("subscription", "s-1") == "/finance/subscriptions?sub=s-1"
    assert links.href_for("subscriptions", "s-1") == "/finance/subscriptions?sub=s-1"
    assert links.href_for("service", "sv-1") == "/finance/services?service=sv-1"
    assert links.href_for("service_plan", "sp-1") == "/finance/services"
    assert links.href_for("scenario", "sc-1") == "/finance/scenarios?scenario=sc-1"
    assert links.href_for("cost_scenario", "sc-1") == "/finance/scenarios?scenario=sc-1"
    assert links.href_for("scenario_item", "si-1") == "/finance/scenarios"
    # a rate row is not a record the currency screen can select, so it opens the tab
    assert links.href_for("exchange_rate", "r-1") == "/finance/currency"
    for kind in (
        "expense",
        "expense_category",
        "income",
        "income_profile",
        "subscription",
        "service",
        "service_plan",
        "scenario",
        "scenario_item",
        "exchange_rate",
    ):
        assert_valid_href(links.href_for(kind, "x-1"), f"finance {kind}")
        assert_valid_href(links.href_for(kind), f"finance {kind} without an id")


def test_a_stale_rate_links_to_the_converter_opened_on_that_pair() -> None:
    """§6 rule 4: the rate notification deep-links to the pair, upper-cased and quoted."""
    assert links.currency_pair_href("usd", "inr") == "/finance/currency?pair=USDINR"
    assert links.currency_pair_href("GBP", None) == "/finance/currency?pair=GBP"
    assert links.currency_pair_href(None, None) == "/finance/currency"
    assert_valid_href(links.currency_pair_href("INR", "USD"), "currency pair")


def test_search_group_href_quotes_the_term() -> None:
    assert links.search_href("tasks", "order") == "/tasks?q=order"
    assert links.search_href("notes", "rust & iron") == "/notes?q=rust%20%26%20iron"
    # milestones and companies have no page: both groups open the page that lists them
    assert links.search_href("milestones", "v1") == "/projects?q=v1"
    assert links.search_href("companies", "north") == "/contacts?q=north"
    assert links.search_href("projects", "a b") == "/projects?q=a%20b"
    for group in ("tasks", "projects", "notes", "milestones", "contacts", "companies"):
        assert_valid_href(links.search_href(group, "order"), f"search group {group}")


# ------------------------------------------------------------------- the emitters


def test_activity_rows_carry_the_same_links_the_ui_opens(
    session: Session, workspace_id: str
) -> None:
    project = make_project(session, workspace_id, "Atlas")
    task = make_task(session, workspace_id, "Draw the map", project_id=project["id"])
    note = make_note(session, workspace_id, "Field notes")
    contact = make_contact(session, workspace_id, "Ada")
    company = make_company(session, workspace_id, "Northwind")
    make_goal(session, workspace_id, "Ship it", project_id=project["id"])
    milestone = make_milestone(session, workspace_id, project["id"], "v1", date=DAY)
    make_reminder(session, workspace_id, "Call Ada", dt.datetime(2026, 11, 21, 8, 0))
    milestones.delete_milestone(session, workspace_id, milestone["id"])
    session.commit()

    rows, _total = activity.list_activity(session, workspace_id, days=0, limit=200)
    by_entity: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_entity.setdefault(row["entity_type"], []).append(row)
        assert_valid_href(row["href"], f"activity {row['verb']} {row['entity_type']}")

    assert by_entity["task"][0]["href"] == f"/tasks?task={task['id']}"
    assert by_entity["note"][0]["href"] == f"/notes?note={note['id']}"
    assert by_entity["contact"][0]["href"] == f"/contacts?contact={contact['id']}"
    assert by_entity["company"][0]["href"] == "/contacts"
    assert by_entity["goal"][0]["href"] == "/goals"
    assert by_entity["reminder"][0]["href"] == "/notifications"
    # a milestone opens its project while it has one...
    created = next(row for row in by_entity["milestone"] if row["verb"] == "created")
    assert created["href"] == f"/projects/{project['id']}"
    # ...and the project list once it is gone, never ".../projects/None"
    deleted = next(row for row in by_entity["milestone"] if row["verb"] == "deleted")
    assert deleted["href"] == "/projects"
    assert deleted["entity_id"] == milestone["id"]


def test_notification_hrefs_follow_the_contract(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Atlas", status="in_progress")
    make_task(
        session, workspace_id, "Late", project_id=project["id"], due_date=DAY - dt.timedelta(days=2)
    )
    make_task(session, workspace_id, "Today", project_id=project["id"], due_date=DAY)
    make_task(
        session,
        workspace_id,
        "Tomorrow",
        project_id=project["id"],
        due_date=DAY + dt.timedelta(days=1),
    )
    make_milestone(session, workspace_id, project["id"], "v1", date=DAY + dt.timedelta(days=1))
    make_reminder(session, workspace_id, "Call Ada", dt.datetime(2026, 11, 21, 8, 0))

    hrefs_by_kind: dict[str, list[str | None]] = {}
    for rule in notifications.derive_rules(session, workspace_id, today=DAY):
        hrefs_by_kind.setdefault(rule.kind, []).append(rule.href)
    assert hrefs_by_kind["task_overdue"] == ["/tasks?filter=overdue"]
    # "due today" and "due tomorrow" are the same kind with two saved views
    due_views = sorted(["/tasks?filter=today", links.TASKS_DUE_WEEK])
    assert sorted(hrefs_by_kind["task_due"]) == due_views
    assert hrefs_by_kind["milestone"] == [f"/projects/{project['id']}"]
    assert hrefs_by_kind["reminder"] == ["/notifications"]
    for hrefs in hrefs_by_kind.values():
        for href in hrefs:
            assert_valid_href(href, "notification rule")

    notifications.refresh(session, workspace_id, today=DAY)
    session.commit()
    stored = notifications.list_notifications(session, workspace_id, limit=200)["items"]
    assert stored, "the refresh produced nothing to check"
    for row in stored:
        assert_valid_href(row["href"], f"notification {row['kind']}")


def test_dashboard_insight_hrefs_are_routes(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Atlas", status="in_progress")
    make_task(
        session, workspace_id, "Late", project_id=project["id"], due_date=DAY - dt.timedelta(days=2)
    )
    make_goal(session, workspace_id, "Ship it", target_date=DAY - dt.timedelta(days=3), progress=10)
    make_note(session, workspace_id, "Orphan")
    make_milestone(session, workspace_id, project["id"], "v1", date=DAY)
    session.commit()

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    kinds = {row["kind"]: row for row in payload["insights"]}
    assert kinds["overdue"]["href"] == "/tasks?filter=overdue"
    assert kinds["goal_past_due"]["href"] == "/goals"
    assert kinds["unlinked_note"]["href"] == f"/notes?note={kinds['unlinked_note']['entity_id']}"
    assert kinds["milestone"]["href"] == f"/projects/{project['id']}"
    for row in payload["insights"]:
        assert_valid_href(row["href"], f"insight {row['kind']}")


def test_search_results_link_where_the_items_live(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Hreftest atlas")
    task = make_task(session, workspace_id, "Hreftest task", project_id=project["id"])
    note = make_note(session, workspace_id, "Hreftest note")
    contact = make_contact(session, workspace_id, "Hreftest contact")
    company = make_company(session, workspace_id, "Hreftest company")
    milestone = make_milestone(
        session, workspace_id, project["id"], "Hreftest milestone", date=DAY
    )
    session.commit()

    payload = search.search(session, workspace_id, query="hreftest", today=DAY)
    groups = {group["type"]: group for group in payload["groups"]}
    assert set(groups) == {"tasks", "projects", "notes", "milestones", "contacts", "companies"}
    hrefs = {group["type"]: group["items"][0]["href"] for group in payload["groups"]}
    assert hrefs["tasks"] == f"/tasks?task={task['id']}"
    assert hrefs["projects"] == f"/projects/{project['id']}"
    assert hrefs["notes"] == f"/notes?note={note['id']}"
    assert hrefs["milestones"] == f"/projects/{project['id']}"
    assert hrefs["contacts"] == f"/contacts?contact={contact['id']}"
    # companies have no page of their own; the people page shows them
    assert hrefs["companies"] == "/contacts"
    assert milestone["id"] not in hrefs["milestones"]

    for group in payload["groups"]:
        assert_valid_href(group["href"], f"search group {group['type']}")
        assert group["href"] == links.search_href(group["type"], "hreftest")
        for item in group["items"]:
            assert_valid_href(item["href"], f"search item {group['type']}")


def test_demo_data_hrefs_are_all_valid(client: TestClient) -> None:
    """The seeder writes activity rows directly, so it goes through the same helper."""
    assert client.post(f"{V1}/demo/seed", params={"today": "2026-11-21"}).status_code == 200
    seen = 0
    for path, extract in (
        (f"{V1}/activity?limit=500&days=0", lambda body: [row["href"] for row in body["items"]]),
        (f"{V1}/notifications?limit=200", lambda body: [row["href"] for row in body["items"]]),
        (f"{V1}/dashboard", lambda body: [row["href"] for row in body["insights"]]),
    ):
        for href in extract(client.get(path).json()):
            assert_valid_href(href, f"demo {path}")
            seen += 1
    assert seen > 20, f"only {seen} demo hrefs checked"

    for term in ("atlas", "order", "postgres", "aisha", "northwind", "v1", "rent", "kite", "retainer"):
        body = client.get(f"{V1}/search", params={"q": term}).json()
        for group in body["groups"]:
            assert_valid_href(group["href"], f"demo search group {group['type']}")
            for item in group["items"]:
                assert_valid_href(item["href"], f"demo search item {group['type']}")


def test_the_goals_screen_is_neither_settings_nor_prefixed(client: TestClient) -> None:
    """Regression: goals used to deep-link to the settings tab of the prefixed surface."""
    goal = client.post(f"{V1}/goals", json={"title": "Learn Rust"}).json()
    activity_row = client.get(f"{V1}/activity", params={"limit": 5, "days": 0}).json()["items"][0]
    assert activity_row["entity_type"] == "goal" and activity_row["entity_id"] == goal["id"]
    assert activity_row["href"] == "/goals"
    assert "settings" not in activity_row["href"]


def test_no_endpoint_emits_a_prefixed_href(client: TestClient) -> None:
    """Whatever the routes were called before, the API now speaks only canonical paths."""
    client.post(f"{V1}/demo/seed", params={"today": "2026-11-21"})
    bodies = [
        client.get(f"{V1}/dashboard").json(),
        client.get(f"{V1}/activity", params={"limit": 500, "days": 0}).json(),
        client.get(f"{V1}/notifications", params={"limit": 200}).json(),
    ] + [client.get(f"{V1}/search", params={"q": term}).json() for term in ("a", "order", "v1")]
    dumped = [value for body in bodies for value in _iter_strings(body)]
    prefixed = [value for value in dumped if value.startswith("/os")]
    assert not prefixed, f"{len(prefixed)} hrefs still carry the retired prefix: {prefixed[:3]}"
    assert not [value for value in dumped if "None" in value and value.startswith("/")]


def _iter_strings(node: Any) -> list[str]:
    """Every string in a JSON body, so the sweep cannot miss a field it did not expect."""
    if isinstance(node, dict):
        return [item for value in node.values() for item in _iter_strings(value)]
    if isinstance(node, list):
        return [item for value in node for item in _iter_strings(value)]
    return [node] if isinstance(node, str) and node.startswith("/") else []

"""The deep-link contract: one helper, one target set, and never a literal ``None``.

``app/services.links.href_for`` is the only place that turns an entity into an href;
these tests pin the mapping it produces, then sweep every endpoint that hands hrefs to
the UI and reject anything outside the routes ``app/(os)/`` actually has.
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

#: every target the backend may emit: a page, or a page plus one selecting parameter
LIST_PAGES = (
    "/os",
    "/os/tasks",
    "/os/projects",
    "/os/notes",
    "/os/contacts",
    "/os/goals",
    "/os/notifications",
    "/os/activity",
    "/os/search",
    "/os/settings",
)
ALLOWED_HREF = re.compile(
    r"^("
    + "|".join(re.escape(page) for page in LIST_PAGES)
    + r")"
    r"("
    r"/[0-9a-fA-F-]{8,}"  # only projects take an id in the path
    r"|\?(task|note|contact|q|filter)=[^?&#]+"
    r")?$"
)


def assert_valid_href(href: str | None, where: str) -> None:
    """``None`` means "no link" (allowed); a string must be a real route."""
    if href is None:
        return
    assert "None" not in href, f"{where}: literal None leaked into {href!r}"
    assert ALLOWED_HREF.match(href), f"{where}: {href!r} is not a route the UI has"


# --------------------------------------------------------------------- the helper


def test_every_entity_links_to_the_route_that_exists() -> None:
    assert links.href_for("task", "t-1") == "/os/tasks?task=t-1"
    assert links.href_for("note", "n-1") == "/os/notes?note=n-1"
    assert links.href_for("contact", "c-1") == "/os/contacts?contact=c-1"
    assert links.href_for("project", "p-1") == "/os/projects/p-1"
    assert links.href_for("milestone", "m-1", project_id="p-1") == "/os/projects/p-1"
    assert links.href_for("goal", "g-1") == "/os/goals"
    assert links.href_for("reminder", "r-1") == "/os/notifications"
    assert links.href_for("notification", "x-1") == "/os/notifications"
    assert links.href_for("company", "co-1") == "/os/contacts"
    assert links.href_for("workspace", "w-1") == "/os/settings"
    assert links.href_for("activity", "a-1") == "/os/activity"


def test_a_milestone_without_a_project_opens_the_project_list() -> None:
    # the old template produced "/os/projects/None"; the guard lives in href_for
    assert links.href_for("milestone", "m-1") == "/os/projects"
    assert links.href_for("milestone", "m-1", project_id=None) == "/os/projects"
    assert links.href_for("milestone", "m-1", project_id="None") == "/os/projects"
    assert links.href_for("milestone", None, project_id="") == "/os/projects"


def test_a_missing_id_falls_back_to_the_list_page() -> None:
    for kind, page in (
        ("task", "/os/tasks"),
        ("note", "/os/notes"),
        ("contact", "/os/contacts"),
        ("project", "/os/projects"),
        ("goal", "/os/goals"),
        ("reminder", "/os/notifications"),
        ("company", "/os/contacts"),
        ("workspace", "/os/settings"),
    ):
        assert links.href_for(kind) == page
        assert links.href_for(kind, None) == page
        assert links.href_for(kind, "None") == page


def test_plurals_and_unknown_types() -> None:
    assert links.href_for("tasks", "t-1") == "/os/tasks?task=t-1"
    assert links.href_for("COMPANIES", "c-1") == "/os/contacts"
    assert links.href_for("widget", "x-1") is None
    assert links.href_for(None) is None
    assert links.href_for("") is None


def test_search_group_href_quotes_the_term() -> None:
    assert links.search_href("/os/tasks", "order") == "/os/tasks?q=order"
    assert links.search_href("/os/notes", "rust & iron") == "/os/notes?q=rust%20%26%20iron"
    assert_valid_href(links.search_href("/os/projects", "a b"), "search group")


# ------------------------------------------------------------------- the emitters


def test_activity_rows_carry_the_same_links_the_ui_opens(
    session: Session, workspace_id: str
) -> None:
    project = make_project(session, workspace_id, "Atlas")
    task = make_task(session, workspace_id, "Draw the map", project_id=project["id"])
    note = make_note(session, workspace_id, "Field notes")
    contact = make_contact(session, workspace_id, "Ada")
    company = make_company(session, workspace_id, "Northwind")
    goal = make_goal(session, workspace_id, "Ship it", project_id=project["id"])
    milestone = make_milestone(session, workspace_id, project["id"], "v1", date=DAY)
    make_reminder(session, workspace_id, "Call Ada", dt.datetime(2026, 11, 21, 8, 0))
    milestones.delete_milestone(session, workspace_id, milestone["id"])
    session.commit()

    rows, _total = activity.list_activity(session, workspace_id, days=0, limit=200)
    by_entity: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_entity.setdefault(row["entity_type"], []).append(row)
        assert_valid_href(row["href"], f"activity {row['verb']} {row['entity_type']}")

    assert by_entity["task"][0]["href"] == f"/os/tasks?task={task['id']}"
    assert by_entity["note"][0]["href"] == f"/os/notes?note={note['id']}"
    assert by_entity["contact"][0]["href"] == f"/os/contacts?contact={contact['id']}"
    assert by_entity["company"][0]["href"] == "/os/contacts"
    assert by_entity["goal"][0]["href"] == "/os/goals"
    assert by_entity["reminder"][0]["href"] == "/os/notifications"
    # a milestone opens its project while it has one...
    created = next(row for row in by_entity["milestone"] if row["verb"] == "created")
    assert created["href"] == f"/os/projects/{project['id']}"
    # ...and the project list once it is gone, never "/os/projects/None"
    deleted = next(row for row in by_entity["milestone"] if row["verb"] == "deleted")
    assert deleted["href"] == "/os/projects"
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
    assert hrefs_by_kind["task_overdue"] == ["/os/tasks?filter=overdue"]
    # "due today" and "due tomorrow" are the same kind with two saved views
    due_views = sorted(["/os/tasks?filter=today", links.TASKS_DUE_WEEK])
    assert sorted(hrefs_by_kind["task_due"]) == due_views
    assert hrefs_by_kind["milestone"] == [f"/os/projects/{project['id']}"]
    assert hrefs_by_kind["reminder"] == ["/os/notifications"]
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
    assert kinds["overdue"]["href"] == "/os/tasks?filter=overdue"
    assert kinds["goal_past_due"]["href"] == "/os/goals"
    assert kinds["unlinked_note"]["href"] == f"/os/notes?note={kinds['unlinked_note']['entity_id']}"
    assert kinds["milestone"]["href"] == f"/os/projects/{project['id']}"
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
    assert hrefs["tasks"] == f"/os/tasks?task={task['id']}"
    assert hrefs["projects"] == f"/os/projects/{project['id']}"
    assert hrefs["notes"] == f"/os/notes?note={note['id']}"
    assert hrefs["milestones"] == f"/os/projects/{project['id']}"
    assert hrefs["contacts"] == f"/os/contacts?contact={contact['id']}"
    # companies have no page of their own; the people page shows them
    assert hrefs["companies"] == "/os/contacts"
    assert milestone["id"] not in hrefs["milestones"]

    for group in payload["groups"]:
        assert_valid_href(group["href"], f"search group {group['type']}")
        assert group["href"] == f"{group['href'].split('?')[0]}?q=hreftest"
        for item in group["items"]:
            assert_valid_href(item["href"], f"search item {group['type']}")


def test_demo_data_hrefs_are_all_valid(client: TestClient) -> None:
    """The seeder writes activity rows directly, so it goes through the same helper."""
    assert client.post(f"{V1}/demo/seed", params={"today": "2026-11-21"}).status_code == 200
    seen = 0
    for path, extract in (
        (f"{V1}/activity?limit=500&days=0", lambda body: [row["href"] for row in body["items"]]),
        (f"{V1}/notifications?limit=200", lambda body: [row["href"] for row in body["items"]]),
        (
            f"{V1}/dashboard",
            lambda body: [row["href"] for row in body["insights"]],
        ),
    ):
        for href in extract(client.get(path).json()):
            assert_valid_href(href, f"demo {path}")
            seen += 1
    assert seen > 20, f"only {seen} demo hrefs checked"

    for term in ("atlas", "order", "postgres", "aisha", "northwind", "v1"):
        body = client.get(f"{V1}/search", params={"q": term}).json()
        for group in body["groups"]:
            assert_valid_href(group["href"], f"demo search group {group['type']}")
            for item in group["items"]:
                assert_valid_href(item["href"], f"demo search item {group['type']}")


def test_the_goals_screen_is_not_the_settings_page(client: TestClient) -> None:
    """Regression: goals used to deep-link to /os/settings?tab=goals."""
    goal = client.post(f"{V1}/goals", json={"title": "Learn Rust"}).json()
    activity_row = client.get(f"{V1}/activity", params={"limit": 5, "days": 0}).json()["items"][0]
    assert activity_row["entity_type"] == "goal" and activity_row["entity_id"] == goal["id"]
    assert activity_row["href"] == "/os/goals"
    assert "settings" not in activity_row["href"]

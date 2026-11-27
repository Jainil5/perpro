"""HTTP contract tests for dashboard, notifications, search, activity and system routes."""

from __future__ import annotations

import datetime as dt
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.helpers import clock_iso

V1 = "/api/v1"
TODAY = "2026-11-21"
MISSING = "00000000-0000-4000-8000-000000000000"


def create(client: TestClient, path: str, body: dict) -> dict:
    response = client.post(f"{V1}{path}", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def seed(client: TestClient, today: str = TODAY) -> dict:
    response = client.post(f"{V1}/demo/seed", params={"today": today})
    assert response.status_code == 200, response.text
    return response.json()


# ----------------------------------------------------------------------- health


def test_health_reports_the_active_configuration(client: TestClient) -> None:
    body = client.get(f"{V1}/health").json()
    assert set(body) == {"status", "version", "workspace", "database", "ai_enabled"}
    assert body["status"] == "ok" and body["database"] == "sqlite"
    assert body["workspace"] == "default" and body["ai_enabled"] is False
    assert body["version"].count(".") == 2


def test_workspace_read_and_patch(client: TestClient) -> None:
    workspace = client.get(f"{V1}/workspace").json()
    assert set(workspace) == {"id", "name", "slug", "timezone", "currency", "created_at"}
    assert workspace["slug"] == "default"
    assert workspace["created_at"].endswith("Z")

    patched = client.patch(
        f"{V1}/workspace", json={"name": "Personal", "timezone": "Europe/Berlin", "currency": "EUR"}
    ).json()
    assert patched["name"] == "Personal" and patched["timezone"] == "Europe/Berlin"
    assert patched["currency"] == "EUR" and patched["slug"] == "default"
    # only those three fields are editable
    assert client.patch(f"{V1}/workspace", json={"slug": "other"}).status_code == 422
    assert client.patch(f"{V1}/workspace", json={}).status_code == 200
    assert client.patch(f"{V1}/workspace", json={"timezone": ""}).status_code == 422
    # surrounding spaces are trimmed, the value is stored as typed
    trimmed = client.patch(f"{V1}/workspace", json={"name": "  My OS  "}).json()
    assert trimmed["name"] == "My OS"
    assert client.get(f"{V1}/health").json()["workspace"] == "default"  # slug never moved


def test_meta_is_the_single_source_of_enumerations(client: TestClient) -> None:
    body = client.get(f"{V1}/meta").json()
    assert set(body) == {"enums", "counts"}
    assert body["enums"]["task.status"] == ["todo", "in_progress", "blocked", "done", "dropped"]
    assert body["enums"]["priority"] == ["low", "medium", "high", "urgent"]
    assert body["enums"]["task.recurrence"] == [
        "none",
        "daily",
        "weekly",
        "fortnightly",
        "monthly",
    ]
    assert body["enums"]["project.status"][0] == "backlog"
    assert "notification.kind" in body["enums"] and "activity.verb" in body["enums"]
    assert "note.category" in body["enums"]
    # Phase 3 (PHASE3_FINANCE.md §5): the finance enums come from the same table
    assert body["enums"]["expense.recurrence"] == ["none", "weekly", "monthly", "quarterly", "yearly"]
    assert body["enums"]["scenario.item.recurrence"] == [
        "none",
        "weekly",
        "monthly",
        "quarterly",
        "yearly",
        "one_time",
    ]
    assert body["enums"]["tax.regime"] == ["none", "flat", "slab", "presumptive"]
    assert len(body["enums"]["currency.code"]) == 46
    assert body["counts"]["tasks"] == 0

    create(client, "/tasks", {"title": "Counted"})
    counts = client.get(f"{V1}/meta").json()["counts"]
    assert counts["tasks"] == 1
    assert set(counts) == {
        "projects",
        "tasks",
        "tasks_open",
        "tasks_overdue",
        "tasks_due_today",
        "tasks_done",
        "milestones",
        "notes",
        "contacts",
        "companies",
        "tags",
        "goals",
        "reminders",
        "notifications",
        "activity",
        # Phase 3 (§4 "system surfaces"): one key per finance table the screens list
        "expenses",
        "income",
        "subscriptions",
        "services",
        "scenarios",
    }
    assert counts["tasks_done"] == 0 and counts["tasks_open"] == 1


# -------------------------------------------------------------------- dashboard


def test_dashboard_shape_on_an_empty_workspace(client: TestClient) -> None:
    body = client.get(f"{V1}/dashboard", params={"today": TODAY}).json()
    assert set(body) == {
        "today",
        "tasks",
        "projects",
        "people",
        "notes",
        "milestones",
        "reminders",
        "notifications",
        "activity",
        "insights",
    }
    assert body["today"] == TODAY
    assert set(body["tasks"]) == {
        "due_today",
        "overdue",
        "upcoming",
        "completed_this_week",
        "open",
    }
    assert body["tasks"]["open"] == 0 and body["tasks"]["due_today"] == []
    assert set(body["projects"]) == {"active", "deadline_soon"}
    assert body["insights"] == []
    assert body["notifications"] == {"unread": 0, "items": []}


def test_dashboard_is_date_injectable(client: TestClient) -> None:
    create(client, "/tasks", {"title": "Today", "due_date": TODAY})
    create(client, "/tasks", {"title": "Past", "due_date": "2026-11-01"})
    create(client, "/tasks", {"title": "Next week", "due_date": "2026-11-30"})

    today = client.get(f"{V1}/dashboard", params={"today": TODAY}).json()
    assert [task["title"] for task in today["tasks"]["due_today"]] == ["Today"]
    assert [task["title"] for task in today["tasks"]["overdue"]] == ["Past"]
    assert [task["title"] for task in today["tasks"]["upcoming"]] == ["Next week"]
    assert today["tasks"]["open"] == 3
    assert today["insights"] and {row["kind"] for row in today["insights"]} >= {"overdue"}

    tomorrow = client.get(f"{V1}/dashboard", params={"today": "2026-11-22"}).json()
    assert tomorrow["today"] == "2026-11-22"
    assert tomorrow["tasks"]["due_today"] == []
    # "Today" (due 2026-11-21) becomes overdue once the injected day moves past it
    assert sorted(task["title"] for task in tomorrow["tasks"]["overdue"]) == ["Past", "Today"]
    assert [task["title"] for task in tomorrow["tasks"]["upcoming"]] == ["Next week"]
    # every derived number moved with the injected date
    assert tomorrow["insights"] != today["insights"]


def test_dashboard_reflects_the_seeded_workspace(client: TestClient) -> None:
    seeded = seed(client)
    assert seeded["skipped"] is False
    board = client.get(f"{V1}/dashboard", params={"today": TODAY}).json()
    assert board["tasks"]["open"] > 0
    assert len(board["projects"]["active"]) <= 6
    assert len(board["notes"]["recent"]) <= 5
    assert len(board["activity"]) <= 8
    assert len(board["notifications"]["items"]) <= 5
    assert board["milestones"]["upcoming"] and board["reminders"]["due"]
    assert {row["kind"] for row in board["insights"]} >= {
        "overdue",
        "project_stalled",
        "past_target",
        "empty_project",
    }
    for insight in board["insights"]:
        assert set(insight) >= {"kind", "severity", "text"}
        assert insight["severity"] in {"info", "warning", "critical"}


# --------------------------------------------------------------- notifications


def test_notifications_are_generated_on_demand_only(client: TestClient) -> None:
    create(client, "/tasks", {"title": "Late", "due_date": "2026-11-01"})
    # response rule 4: reads never create notifications
    for path in ("/notifications", "/dashboard", "/meta", "/tasks"):
        assert client.get(f"{V1}{path}", params={"today": TODAY}).status_code == 200
        assert client.get(f"{V1}/notifications").json() == {"items": [], "unread": 0}

    refreshed = client.post(f"{V1}/notifications/refresh", params={"today": TODAY}).json()
    assert set(refreshed) == {"created", "resolved"}
    assert refreshed["created"] >= 1
    listed = client.get(f"{V1}/notifications").json()
    assert set(listed) == {"items", "unread"}
    assert listed["unread"] == len(listed["items"]) > 0
    first = listed["items"][0]
    assert set(first) == {
        "id",
        "kind",
        "severity",
        "title",
        "body",
        "entity_type",
        "entity_id",
        "href",
        "read",
        "read_at",
        "dedupe_key",
        "created_at",
        "updated_at",
    }
    assert first["kind"] == "task_overdue" and first["severity"] == "critical"
    assert first["href"] == "/tasks?filter=overdue"

    again = client.post(f"{V1}/notifications/refresh", params={"today": TODAY}).json()
    assert again == {"created": 0, "resolved": 0}


def test_notification_filters_and_read_flow(client: TestClient) -> None:
    create(client, "/tasks", {"title": "Late", "due_date": "2026-11-01"})
    create(client, "/tasks", {"title": "Tomorrow", "due_date": "2026-11-22"})
    client.post(f"{V1}/notifications/refresh", params={"today": TODAY})

    all_items = client.get(f"{V1}/notifications").json()
    assert len(all_items["items"]) == all_items["unread"] == 2
    due = client.get(f"{V1}/notifications", params={"kind": "task_due"}).json()
    assert [row["kind"] for row in due["items"]] == ["task_due"]
    overdue = client.get(f"{V1}/notifications", params={"kind": "task_overdue"}).json()["items"]
    assert len(overdue) == 1

    assert len(client.get(f"{V1}/notifications", params={"limit": 1}).json()["items"]) == 1
    assert client.get(f"{V1}/notifications", params={"kind": "nope"}).status_code == 422
    assert client.get(f"{V1}/notifications", params={"limit": 0}).status_code == 422

    target = overdue[0]
    read = client.patch(f"{V1}/notifications/{target['id']}", json={"read": True}).json()
    assert read["read"] is True and read["read_at"].endswith("Z")
    assert client.get(f"{V1}/notifications", params={"unread": "true"}).json()["unread"] == (
        all_items["unread"] - 1
    )
    assert client.patch(f"{V1}/notifications/{target['id']}", json={"read": False}).json()["read"] is False

    marked = client.post(f"{V1}/notifications/read-all").json()
    assert set(marked) == {"updated"} and marked["updated"] >= 1
    assert client.post(f"{V1}/notifications/read-all").json()["updated"] == 0
    assert client.get(f"{V1}/notifications").json()["unread"] == 0

    assert client.patch(f"{V1}/notifications/{MISSING}", json={"read": True}).status_code == 404
    assert client.delete(f"{V1}/notifications/{target['id']}").status_code == 204
    assert client.delete(f"{V1}/notifications/{target['id']}").status_code == 404


def test_notifications_disappear_when_the_condition_clears(client: TestClient) -> None:
    task = create(client, "/tasks", {"title": "Late", "due_date": "2026-11-01"})
    client.post(f"{V1}/notifications/refresh", params={"today": TODAY})
    assert len(client.get(f"{V1}/notifications").json()["items"]) == 1
    client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})
    resolved = client.post(f"{V1}/notifications/refresh", params={"today": TODAY}).json()
    assert resolved["resolved"] == 1
    assert client.get(f"{V1}/notifications").json()["items"] == []


def test_notifications_are_scoped_to_the_workspace(
    client: TestClient, session: Session, workspace_id: str
) -> None:
    from tests.helpers import make_task, other_workspace

    make_task(
        session,
        other_workspace(session, slug="signals-elsewhere"),
        "Foreign late",
        due_date=dt.date(2026, 10, 1),
    )
    session.commit()
    client.post(f"{V1}/notifications/refresh", params={"today": TODAY})
    assert client.get(f"{V1}/notifications").json()["items"] == []
    # another workspace's row is a 404 here, never a 403
    assert client.get(f"{V1}/notifications/{MISSING}").status_code == 404
    assert client.get(f"{V1}/tasks", params={"today": TODAY}).json()["total"] == 0


# ----------------------------------------------------------------------- search


def test_search_groups_every_module(client: TestClient) -> None:
    project = create(client, "/projects", {"name": "Order service"})
    create(client, "/tasks", {"title": "Order the parts", "project_id": project["id"]})
    create(client, "/notes", {"title": "Order rules", "content": "about ordering"})
    create(client, "/milestones", {"project_id": project["id"], "title": "First order", "date": "2026-12-01"})
    create(client, "/contacts", {"name": "Order Contact"})
    create(client, "/companies", {"name": "Order Supplies"})

    body = client.get(f"{V1}/search", params={"q": "order"}).json()
    assert set(body) == {"query", "groups", "total"}
    assert body["query"] == "order"
    assert [group["type"] for group in body["groups"]] == [
        "tasks",
        "projects",
        "notes",
        "milestones",
        "contacts",
        "companies",
    ]
    for group in body["groups"]:
        assert set(group) == {"type", "label", "href", "items"}
        assert group["label"] in {"Tasks", "Projects", "Notes", "Milestones", "Contacts", "Companies"}
        for item in group["items"]:
            assert set(item) == {"id", "title", "subtitle", "href", "badge"}
    assert body["total"] == sum(len(group["items"]) for group in body["groups"])


def test_search_edges(client: TestClient) -> None:
    assert client.get(f"{V1}/search", params={"q": "or"}).json() == {"groups": [], "total": 0, "query": "or"}
    create(client, "/tasks", {"title": "100% coverage"})
    assert client.get(f"{V1}/search", params={"q": "100%"}).json()["total"] == 1
    assert client.get(f"{V1}/search", params={"q": "nothing here"}).json()["groups"] == []
    assert client.get(f"{V1}/search").json()["groups"] == []
    limited = client.get(f"{V1}/search", params={"q": "coverage", "limit": 1}).json()
    assert limited["total"] == 1
    assert client.get(f"{V1}/search", params={"q": "coverage", "limit": 0}).status_code == 422


# --------------------------------------------------------------------- activity


def test_activity_records_the_writes(client: TestClient) -> None:
    task = create(client, "/tasks", {"title": "Logged"})
    client.patch(f"{V1}/tasks/{task['id']}", json={"status": "in_progress"})
    client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})

    # the default 7-day window is counted from the server's own day, and these three
    # rows were written on it, so no ?today= is needed (or wanted) here
    body = client.get(f"{V1}/activity").json()
    assert set(body) == {"items", "total"}
    assert body["total"] == 3
    rows = {row["verb"]: row for row in body["items"]}
    assert set(rows) == {"created", "updated", "completed"}
    row = rows["completed"]
    assert set(row) == {
        "id",
        "verb",
        "entity_type",
        "entity_id",
        "entity_title",
        "summary",
        "project_id",
        "href",
        "actor",
        "created_at",
    }
    assert row["entity_type"] == "task" and row["entity_id"] == task["id"]
    assert row["entity_title"] == "Logged" and row["href"] == f"/tasks?task={task['id']}"
    assert row["actor"] == "owner" and row["created_at"].endswith("Z")
    assert "Logged" in row["summary"]
    assert rows["created"]["summary"].startswith("Created")

    # newest first; timestamps are second-precision, so same-second rows are ordered by id
    assert body["items"] == sorted(body["items"], key=lambda item: item["created_at"], reverse=True)
    assert [r["verb"] for r in client.get(f"{V1}/activity", params={"verb": "created"}).json()["items"]] == [
        "created"
    ]
    assert client.get(f"{V1}/activity", params={"entity_type": "task"}).json()["total"] == 3
    assert client.get(f"{V1}/activity", params={"entity_type": "note"}).json()["items"] == []
    assert client.get(f"{V1}/activity", params={"project_id": MISSING}).json()["items"] == []
    assert client.get(f"{V1}/activity", params={"verb": "nope"}).status_code == 422
    assert client.get(f"{V1}/activity", params={"limit": 1}).json() == {
        "items": body["items"][:1],
        "total": 3,
    }


def test_activity_window_is_measured_from_the_injected_today(client: TestClient) -> None:
    create(client, "/tasks", {"title": "Old"})
    # ``days`` is a floor counted back from ``today``, so a day far past the row's own
    # timestamp excludes it - measured from the clock, because that is what wrote the row
    ahead = clock_iso(400)
    assert client.get(f"{V1}/activity", params={"days": 10, "today": ahead}).json() == {
        "items": [],
        "total": 0,
    }
    # days=0 disables the window (the full-history view)
    assert client.get(f"{V1}/activity", params={"days": 0, "today": ahead}).json()["total"] == 1
    # measured from the day the row was written, a one-day window still holds it
    within = client.get(f"{V1}/activity", params={"days": 1, "today": clock_iso()}).json()
    assert within["total"] == 1
    assert client.get(f"{V1}/activity", params={"days": -1}).status_code == 422
    assert client.get(f"{V1}/activity", params={"days": 99999}).status_code == 422


# ------------------------------------------------------------------------ export


def test_export_returns_the_documented_dump(client: TestClient) -> None:
    seed(client)
    response = client.get(f"{V1}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert set(body) == {"exported_at", "workspace", "tables"}
    assert body["exported_at"].endswith("Z")
    assert body["workspace"]["slug"] == "default"
    assert len(body["tables"]["projects"]) == 8
    assert len(body["tables"]["tasks"]) == 49
    assert json.dumps(body)  # everything in the dump is JSON-serialisable


def test_export_covers_the_workspace_only(client: TestClient) -> None:
    create(client, "/tasks", {"title": "Mine"})
    body = client.get(f"{V1}/export").json()
    assert [row["title"] for row in body["tables"]["tasks"]] == ["Mine"]


# -------------------------------------------------------------------------- demo


def test_demo_seed_is_idempotent_over_http(client: TestClient) -> None:
    first = seed(client)
    assert first["skipped"] is False
    assert first["created"]["projects"] == 8 and first["created"]["tasks"] == 49
    second = seed(client)
    assert second == {"created": {}, "skipped": True}
    assert client.get(f"{V1}/tasks", params={"today": TODAY}).json()["total"] == 49
    # the demo data satisfies the documented OrderBook example - read at the day it was
    # seeded for, since "overdue" is a comparison and not a stored column
    orderbook = [
        row
        for row in client.get(f"{V1}/projects", params={"today": TODAY}).json()["items"]
        if row["name"] == "OrderBook CRM"
    ][0]
    assert orderbook["progress"] == 62
    assert orderbook["task_counts"] == {"total": 13, "done": 8, "open": 5, "overdue": 1}


def test_demo_seed_shifts_with_the_injected_today(client: TestClient) -> None:
    seed(client, today="2027-03-03")
    overdue = client.get(f"{V1}/tasks", params={"due": "overdue", "today": "2027-03-03"}).json()
    assert overdue["total"] > 0
    due_dates = [row["due_date"] for row in client.get(f"{V1}/tasks").json()["items"]]
    assert all(date is None or date <= "2027-06-30" for date in due_dates), due_dates


def test_demo_reset_is_guarded_by_configuration(client: TestClient) -> None:
    seed(client)
    blocked = client.post(f"{V1}/demo/reset", params={"today": TODAY})
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "conflict"
    assert "MYOS_ALLOW_DEMO_RESET" in blocked.json()["error"]["message"]
    # the guard refused before doing anything
    assert client.get(f"{V1}/projects").json()["total"] == 8


def test_demo_reset_works_when_enabled(client: TestClient, monkeypatch) -> None:
    from app.core.config import reload_settings

    monkeypatch.setenv("MYOS_ALLOW_DEMO_RESET", "1")
    reload_settings()
    try:
        seeded = seed(client)
        user_project = create(client, "/projects", {"name": "My own work"})
        result = client.post(f"{V1}/demo/reset", params={"today": TODAY})
        assert result.status_code == 200, result.text
        body = result.json()
        assert set(body) == {"created", "skipped"}
        assert body["skipped"] is False
        assert body["created"] == seeded["created"]
        names = [row["name"] for row in client.get(f"{V1}/projects").json()["items"]]
        assert "My own work" in names
        assert names.count("OrderBook CRM") == 1
        assert client.get(f"{V1}/projects/{user_project['id']}").status_code == 200
        # demo tags are cleaned up, the user's own rows are untouched
        assert client.get(f"{V1}/meta").json()["counts"]["projects"] == 9
    finally:
        monkeypatch.delenv("MYOS_ALLOW_DEMO_RESET", raising=False)
        reload_settings()


def test_seed_route_reports_the_skip(client: TestClient) -> None:
    assert client.post(f"{V1}/demo/seed").json()["skipped"] is False
    assert client.post(f"{V1}/demo/seed").json()["skipped"] is True


# ------------------------------------------------------------- routing & errors


def test_every_documented_route_exists(client: TestClient) -> None:
    """The OpenAPI surface is exactly the API.md contract - nothing else."""
    paths = client.get("/openapi.json").json()["paths"]
    operations = {f"{method.upper()} {path}" for path, item in paths.items() for method in item}
    assert len(operations) == 132
    for expected in (
        "GET /api/v1/health",
        "GET /api/v1/dashboard",
        "POST /api/v1/tasks/bulk",
        "POST /api/v1/tasks/import",
        "GET /api/v1/note-tags",
        "GET /api/v1/export",
        "POST /api/v1/demo/reset",
        "PATCH /api/v1/workspace",
        # Phase 3 (PHASE3_FINANCE.md §4): the finance surface, verbs exactly as written
        "GET /api/v1/finance/summary",
        "GET /api/v1/expenses/summary",
        "GET /api/v1/expenses/export.csv",
        "GET /api/v1/income/export.csv",
        "POST /api/v1/expenses/bulk",
        "POST /api/v1/income/{income_id}/mark-paid",
        "POST /api/v1/income-profiles/preview",
        "POST /api/v1/exchange-rates/sync",
        "GET /api/v1/convert",
        "GET /api/v1/services/{service_id}",
        "POST /api/v1/subscriptions/{subscription_id}/pause",
        "GET /api/v1/cost-scenarios/compare",
        "POST /api/v1/cost-scenarios/{scenario_id}/activate",
        "PATCH /api/v1/cost-scenario-items/{item_id}",
    ):
        assert expected in operations, expected
    # nothing was invented beyond the contract
    assert "DELETE /api/v1/dashboard" not in operations
    assert "POST /api/v1/search" not in operations
    # §4 lists no single-category read and no scenario-item read: they are not here either
    assert "GET /api/v1/expense-categories/{category_id}" not in operations
    assert "GET /api/v1/cost-scenario-items/{item_id}" not in operations


def test_unknown_paths_use_the_same_error_envelope(client: TestClient) -> None:
    for path in (f"{V1}/nope", f"{V1}/tasks/{MISSING}/nope"):
        response = client.get(path)
        assert response.status_code == 404, path
        assert response.json()["error"]["code"] == "not_found"
        assert response.json()["error"]["details"] == []
    # API.md has no 405 in its status table, so a wrong method reports the envelope as 404
    wrong_method = client.delete(f"{V1}/dashboard")
    assert wrong_method.status_code == 404
    assert wrong_method.json() == {
        "error": {"code": "not_found", "message": "method not allowed", "details": []}
    }
    assert client.post(f"{V1}/health").status_code == 404


def test_malformed_json_bodies_are_400_or_422_not_500(client: TestClient) -> None:
    response = client.post(
        f"{V1}/tasks", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code in (400, 422)
    assert set(response.json()) == {"error"}


def test_a_route_never_leaks_a_500_for_empty_input(client: TestClient) -> None:
    for path in (
        "/tasks",
        "/projects",
        "/notes",
        "/milestones",
        "/contacts",
        "/companies",
        "/goals",
        "/reminders",
        "/notifications",
        "/activity",
        "/search",
        "/dashboard",
        "/export",
        "/meta",
        "/workspace",
        "/health",
    ):
        response = client.get(f"{V1}{path}", params={"today": TODAY})
        assert response.status_code == 200, path
        assert response.json() is not None, path


@pytest.mark.parametrize(
    "path",
    [
        "/tasks",
        "/projects",
        "/notes",
        "/milestones",
        "/contacts",
        "/companies",
        "/goals",
        "/reminders",
        "/notifications",
        "/activity",
        "/dashboard",
        "/export",
        "/workspace",
        "/health",
        "/meta",
        "/search",
        "/note-tags",
    ],
)
def test_every_response_uses_z_timestamps(client: TestClient, path: str) -> None:
    seed(client)
    response = client.get(f"{V1}{path}", params={"today": TODAY})
    assert response.status_code == 200, path
    text = response.text
    assert "+00:00" not in text
    if "created_at" in text:
        assert 'Z"' in text

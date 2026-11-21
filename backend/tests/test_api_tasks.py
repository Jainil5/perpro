"""HTTP-level contract tests for ``/api/v1/tasks`` (and the shared rules it shows).

These go through ``TestClient`` only: no service call, no clock mocking - every date
comes from ``?today=`` so the behaviour is reproducible.
"""

from __future__ import annotations

import datetime as dt

from fastapi.testclient import TestClient

V1 = "/api/v1"
TODAY = "2026-11-21"

TASK_KEYS = {
    "id",
    "title",
    "description",
    "notes",
    "project_id",
    "project",
    "parent_task_id",
    "status",
    "priority",
    "due_date",
    "start_date",
    "estimated_minutes",
    "actual_minutes",
    "recurrence",
    "tags",
    "position",
    "completed_at",
    "created_at",
    "updated_at",
    "is_overdue",
    "is_due_today",
}


def post_task(client: TestClient, **body: object) -> dict:
    response = client.post(f"{V1}/tasks", json={"title": "Task", **body})
    assert response.status_code == 201, response.text
    return response.json()


# ----------------------------------------------------------------------- basics


def test_health_and_root_answer_on_an_empty_install(client: TestClient) -> None:
    health = client.get(f"{V1}/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "version": health.json()["version"],
        "workspace": "default",
        "database": "sqlite",
        "ai_enabled": False,
    }
    assert client.get("/").json()["api"] == V1


def test_list_tasks_returns_the_documented_envelope(client: TestClient) -> None:
    page = client.get(f"{V1}/tasks").json()
    assert set(page) == {"items", "total", "limit", "offset"}
    assert page["items"] == [] and page["total"] == 0 and page["limit"] == 200


def test_create_task_returns_every_documented_field(client: TestClient) -> None:
    task = post_task(client, title="Write migration notes", due_date="2026-11-23", tags=["schema"])
    assert set(task) == TASK_KEYS
    assert task["title"] == "Write migration notes"
    assert task["status"] == "todo" and task["priority"] == "medium"
    assert task["recurrence"] == "none" and task["tags"] == ["schema"]
    assert task["due_date"] == "2026-11-23" and task["completed_at"] is None
    assert task["project"] is None and task["parent_task_id"] is None
    assert task["created_at"].endswith("Z") and task["due_date"] == "2026-11-23"
    assert task["is_overdue"] is False and task["is_due_today"] is False


def test_client_supplied_ids_are_rejected(client: TestClient) -> None:
    """API.md: ids are server-generated - the body simply has no ``id`` field."""
    response = client.post(f"{V1}/tasks", json={"title": "Mine", "id": "1234"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "id"


def test_imported_tasks_get_fresh_uuids(client: TestClient) -> None:
    raw = '[{"id":"fixed-id","title":"Renumbered"}]'
    result = client.post(f"{V1}/tasks/import", json={"raw": raw}).json()
    assert result["created"] == 1
    assert result["warnings"] == ["task 0: ignored client-side key(s) ['id']; the server assigns ids"]
    task = client.get(f"{V1}/tasks").json()["items"][0]
    assert task["id"] != "fixed-id"
    assert set(task["id"]) <= set("0123456789abcdef-")


# ---------------------------------------------------------------------- filters


def test_filters_narrow_the_list(client: TestClient) -> None:
    post_task(client, title="Alpha", status="todo", priority="high", due_date="2026-11-21")
    post_task(client, title="Beta", status="done", priority="low")
    post_task(client, title="Gamma", status="blocked", due_date="2026-10-01")
    post_task(client, title="Delta", status="todo", due_date="2026-12-01")

    def titles(**params) -> list[str]:
        response = client.get(f"{V1}/tasks", params={"today": TODAY, **params})
        assert response.status_code == 200, response.text
        return [task["title"] for task in response.json()["items"]]

    assert titles(status="done") == ["Beta"]
    assert titles(status="todo") == ["Alpha", "Delta"]
    assert titles(priority="high") == ["Alpha"]
    assert titles(due="today") == ["Alpha"]
    assert titles(due="overdue") == ["Gamma"]
    assert titles(due="none") == ["Beta"]
    assert titles(due="upcoming") == ["Delta"]
    assert titles(due="week") == ["Alpha"]
    assert titles(q="lph") == ["Alpha"]
    assert titles(project_id="none") == ["Gamma", "Alpha", "Delta", "Beta"]
    assert titles(status="todo", priority="low") == []
    assert sorted(titles(include_subtasks="false")) == ["Alpha", "Beta", "Delta", "Gamma"]


def test_sort_and_pagination(client: TestClient) -> None:
    for index, (title, due) in enumerate([("Late", "2026-12-30"), ("Early", "2026-11-25")]):
        post_task(client, title=title, due_date=due)
    by_due = client.get(f"{V1}/tasks", params={"sort": "due", "today": TODAY}).json()
    assert [task["title"] for task in by_due["items"]] == ["Early", "Late"]
    page = client.get(f"{V1}/tasks", params={"sort": "title", "limit": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1 and page["limit"] == 1
    second = client.get(f"{V1}/tasks", params={"sort": "title", "limit": 1, "offset": 1}).json()
    assert second["offset"] == 1 and second["items"][0]["id"] != page["items"][0]["id"]


def test_tag_filter_accepts_a_leading_hash(client: TestClient) -> None:
    post_task(client, title="Tagged", tags=["schema"])
    post_task(client, title="Untagged")
    for tag in ("schema", "#schema", "Schema"):
        found = client.get(f"{V1}/tasks", params={"tag": tag}).json()
        assert [task["title"] for task in found["items"]] == ["Tagged"], tag


def test_derived_flags_follow_today(client: TestClient) -> None:
    task = post_task(client, title="Due", due_date="2026-11-21")
    overdue = post_task(client, title="Past", due_date="2026-11-01")
    fetched = client.get(f"{V1}/tasks/{task['id']}", params={"today": TODAY}).json()
    assert fetched["is_due_today"] is True and fetched["is_overdue"] is False
    # the same row is overdue one day later
    later = client.get(f"{V1}/tasks/{overdue['id']}", params={"today": "2026-11-22"}).json()
    assert later["is_overdue"] is True and later["is_due_today"] is False


# -------------------------------------------------------------------- validation


def error(client: TestClient, method: str, path: str, **kwargs) -> dict:
    response = getattr(client, method)(f"{V1}{path}", **kwargs)
    assert response.status_code in (404, 409, 422), response.text
    body = response.json()
    assert set(body) == {"error"}
    envelope = body["error"]
    assert set(envelope) == {"code", "message", "details"}
    assert isinstance(envelope["details"], list)
    return envelope


def test_missing_title_is_a_422_with_field_details(client: TestClient) -> None:
    response = client.post(f"{V1}/tasks", json={"priority": "high"})
    assert response.status_code == 422
    envelope = response.json()["error"]
    assert envelope["code"] == "validation_error"
    assert envelope["message"] == "request validation failed"
    detail = envelope["details"][0]
    assert set(detail) == {"loc", "field", "msg", "type"}
    assert detail["loc"] == ["title"] and detail["field"] == "title"
    assert detail["type"] == "missing" and detail["msg"] == "Field required"


def test_unknown_body_keys_are_rejected(client: TestClient) -> None:
    response = client.post(f"{V1}/tasks", json={"title": "X", "colour": "red"})
    assert response.status_code == 422
    detail = response.json()["error"]["details"][0]
    assert detail["field"] == "colour" and detail["loc"] == ["colour"]
    assert detail["type"] == "extra_forbidden"


def test_bad_enum_and_date_bodies_are_rejected(client: TestClient) -> None:
    for body in (
        {"title": "X", "priority": "urgent-ish"},
        {"title": "X", "status": "finished"},
        {"title": "X", "recurrence": "yearly"},
        {"title": "X", "due_date": "01/11/2026"},
        {"title": "X", "estimated_minutes": -5},
    ):
        response = client.post(f"{V1}/tasks", json=body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"


def test_messy_casing_is_normalised_not_rejected(client: TestClient) -> None:
    task = post_task(client, title="  Padded  ", priority="High", status="In Progress")
    assert task["title"] == "Padded"
    assert task["priority"] == "high" and task["status"] == "in_progress"


def test_bad_query_parameters_are_422s(client: TestClient) -> None:
    for params in (
        {"status": "nope"},
        {"priority": "nope"},
        {"due": "nope"},
        {"sort": "nope"},
        {"limit": 0},
        {"offset": -1},
    ):
        response = client.get(f"{V1}/tasks", params=params)
        assert response.status_code == 422, params
        envelope = response.json()["error"]
        assert envelope["code"] == "validation_error"
        assert envelope["details"][0]["loc"] == ["query", next(iter(params))]
        assert envelope["details"][0]["field"] == f"query.{next(iter(params))}"


def test_blank_query_parameters_count_as_absent(client: TestClient) -> None:
    post_task(client, title="Any")
    response = client.get(f"{V1}/tasks", params={"status": "", "due": "", "sort": ""})
    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_unknown_task_is_404(client: TestClient) -> None:
    envelope = error(client, "get", "/tasks/00000000-0000-4000-8000-000000000000")
    assert envelope["code"] == "not_found" and envelope["message"] == "task not found"


def test_dangling_project_id_is_422(client: TestClient) -> None:
    response = client.post(
        f"{V1}/tasks", json={"title": "Orphan", "project_id": "does-not-exist"}
    )
    assert response.status_code == 422
    detail = response.json()["error"]["details"][0]
    assert detail["loc"] == ["project_id"] and detail["field"] == "project_id"
    assert response.json()["error"]["message"] == "project_id not found"


def test_a_project_from_another_workspace_is_a_conflict(
    client: TestClient, session, workspace_id: str
) -> None:
    from app.models import Project
    from app.services import context
    from tests.helpers import other_workspace, make_project

    foreign = other_workspace(session)
    theirs = make_project(session, foreign, "Theirs")
    session.commit()
    response = client.post(f"{V1}/tasks", json={"title": "X", "project_id": theirs["id"]})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert session.get(Project, theirs["id"]) is not None
    assert context.resolve_workspace(session).id == workspace_id


# ------------------------------------------------------------------- mutations


def test_patch_updates_only_supplied_fields(client: TestClient) -> None:
    task = post_task(client, title="Before", due_date="2026-11-30", priority="low")
    patched = client.patch(f"{V1}/tasks/{task['id']}", json={"title": "After"}).json()
    assert patched["title"] == "After" and patched["due_date"] == "2026-11-30"
    assert patched["priority"] == "low"
    assert patched["updated_at"] >= task["updated_at"]


def test_patch_to_done_stamps_completed_at(client: TestClient) -> None:
    task = post_task(client, title="Finish me")
    done = client.patch(f"{V1}/tasks/{task['id']}", json={"status": "done"}).json()
    assert done["status"] == "done" and done["completed_at"].endswith("Z")
    reopened = client.post(f"{V1}/tasks/{task['id']}/reopen").json()
    assert reopened["status"] == "todo" and reopened["completed_at"] is None


def test_patch_can_clear_a_date(client: TestClient) -> None:
    task = post_task(client, title="Loose", due_date="2026-11-30")
    cleared = client.patch(f"{V1}/tasks/{task['id']}", json={"due_date": None}).json()
    assert cleared["due_date"] is None


def test_delete_returns_204_and_removes_the_row(client: TestClient) -> None:
    task = post_task(client, title="Temporary")
    assert client.delete(f"{V1}/tasks/{task['id']}").status_code == 204
    assert client.get(f"{V1}/tasks/{task['id']}").status_code == 404
    assert client.delete(f"{V1}/tasks/{task['id']}").status_code == 404


def test_complete_a_plain_task_returns_the_task(client: TestClient) -> None:
    task = post_task(client, title="One off")
    response = client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == set(TASK_KEYS)
    assert body["status"] == "done" and body["completed_at"] is not None
    assert body["id"] == task["id"]


def test_completing_a_recurring_task_rolls_the_series_forward(client: TestClient) -> None:
    task = post_task(client, title="Weekly review", recurrence="weekly", due_date="2026-11-21")
    response = client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"task", "next"}
    assert body["task"]["id"] == task["id"] and body["task"]["status"] == "done"
    assert body["next"]["title"] == "Weekly review"
    assert body["next"]["due_date"] == "2026-11-28"
    assert body["next"]["recurrence"] == "weekly"
    assert body["next"]["status"] == "todo" and body["next"]["id"] != task["id"]
    assert body["next"]["completed_at"] is None


def test_a_series_rolls_forward_from_today_without_a_due_date(client: TestClient) -> None:
    task = post_task(client, title="Daily standup", recurrence="daily")
    body = client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY}).json()
    assert body["task"]["due_date"] is None and body["next"]["due_date"] == "2026-11-22"
    again = client.post(f"{V1}/tasks/{body['next']['id']}/complete", params={"today": TODAY}).json()
    # the series keeps walking forward from its own last occurrence
    assert again["next"]["due_date"] == "2026-11-23"


def test_move_changes_column_and_index(client: TestClient) -> None:
    first = post_task(client, title="First")
    second = post_task(client, title="Second")
    moved = client.post(
        f"{V1}/tasks/{second['id']}/move", json={"status": "in_progress", "position": 0}
    ).json()
    assert moved["status"] == "in_progress" and moved["position"] == 0
    column = client.get(f"{V1}/tasks", params={"status": "todo"}).json()["items"]
    assert [task["id"] for task in column] == [first["id"]]


def test_move_rejects_an_unknown_column(client: TestClient) -> None:
    task = post_task(client, title="Nowhere")
    response = client.post(f"{V1}/tasks/{task['id']}/move", json={"status": "parked"})
    assert response.status_code == 422
    detail = response.json()["error"]["details"][0]
    assert detail["field"] == "status" and "must be one of" in detail["msg"]


# -------------------------------------------------------------------------- bulk


def test_bulk_complete_and_delete_report_per_id_results(client: TestClient) -> None:
    one = post_task(client, title="One")
    two = post_task(client, title="Two")
    done = client.post(
        f"{V1}/tasks/bulk", json={"ids": [one["id"], two["id"], "missing"], "action": "complete"}
    ).json()
    assert done["updated"] == 2
    assert done["failed"] == [{"id": "missing", "error": "not_found"}]
    assert client.get(f"{V1}/tasks/{one['id']}").json()["status"] == "done"

    removed = client.post(
        f"{V1}/tasks/bulk", json={"ids": [one["id"], two["id"]], "action": "delete"}
    ).json()
    assert removed == {"updated": 2, "failed": []}
    assert client.get(f"{V1}/tasks").json()["total"] == 0


def test_bulk_set_priority_and_project(client: TestClient) -> None:
    task = post_task(client, title="Reprioritise")
    project = client.post(f"{V1}/projects", json={"name": "Holder"}).json()
    client.post(
        f"{V1}/tasks/bulk",
        json={"ids": [task["id"]], "action": "set_priority", "value": "Urgent"},
    )
    assert client.get(f"{V1}/tasks/{task['id']}").json()["priority"] == "urgent"
    client.post(
        f"{V1}/tasks/bulk",
        json={"ids": [task["id"]], "action": "set_project", "value": project["id"]},
    )
    assert client.get(f"{V1}/tasks/{task['id']}").json()["project_id"] == project["id"]
    detached = client.post(
        f"{V1}/tasks/bulk", json={"ids": [task["id"]], "action": "set_project", "value": None}
    ).json()
    assert detached["updated"] == 1
    assert client.get(f"{V1}/tasks/{task['id']}").json()["project_id"] is None


def test_bulk_validates_its_action_and_value(client: TestClient) -> None:
    task = post_task(client, title="Guard")
    bad_action = client.post(f"{V1}/tasks/bulk", json={"ids": [task["id"]], "action": "archive"})
    assert bad_action.status_code == 422
    bad_value = client.post(
        f"{V1}/tasks/bulk", json={"ids": [task["id"]], "action": "set_priority", "value": "nope"}
    )
    assert bad_value.status_code == 422
    assert bad_value.json()["error"]["details"][0]["field"] == "value"


def test_bulk_ids_are_normalised_and_deduplicated(client: TestClient) -> None:
    task = post_task(client, title="Once")
    result = client.post(
        f"{V1}/tasks/bulk", json={"ids": [task["id"], f" {task['id']} ", task["id"]], "action": "complete"}
    ).json()
    assert result["updated"] == 1 and result["failed"] == []


# ------------------------------------------------------------------------ import


LITERAL_PAYLOAD = (
    '{"tasks":[{"title":"Enforce user_limit","category":"RLS","notes":"Gate free tier to 3'
    " orders per user via user_limit in tenants.config. Read at API boundary, not in policy."
    '\\n\\nAcceptance:\\n- Free tier blocked on 4th order\\n- Upgrade prompt\\n\\n",'
    '"priority":"High","due_date":"2026-11-01",},{"title":"Test tenant isolation",'
    '"category":"Verification","notes":"Verify across 3 tenants.\\n\\nAcceptance:'
    '\\n- 3 tenants created\\n- Cross-tenant reads blocked","priority":"Medium",'
    '"due_date":"2026-11-15"}],}'
)


def test_the_importer_accepts_the_messy_real_world_payload(client: TestClient) -> None:
    result = client.post(f"{V1}/tasks/import", json={"raw": LITERAL_PAYLOAD}).json()
    assert set(result) == {"created", "duplicates", "rejected", "warnings"}
    assert result["created"] == 2 and result["duplicates"] == 0
    assert result["rejected"] == []
    # trailing commas are repaired, and the repair is reported
    assert result["warnings"] == ["removed 2 trailing comma(s) from the payload"]

    tasks = client.get(f"{V1}/tasks", params={"sort": "created"}).json()["items"]
    assert [task["title"] for task in tasks] == ["Enforce user_limit", "Test tenant isolation"]
    assert tasks[0]["priority"] == "high" and tasks[0]["due_date"] == "2026-11-01"
    assert tasks[0]["tags"] == ["RLS"]
    assert "Acceptance:" in tasks[0]["notes"] and "\n\n" in tasks[0]["notes"]
    assert tasks[1]["priority"] == "medium" and tasks[1]["due_date"] == "2026-11-15"


def test_import_is_idempotent_per_workspace(client: TestClient) -> None:
    first = client.post(f"{V1}/tasks/import", json={"raw": LITERAL_PAYLOAD}).json()
    assert first["created"] == 2
    again = client.post(f"{V1}/tasks/import", json={"raw": LITERAL_PAYLOAD}).json()
    assert again["created"] == 0 and again["duplicates"] == 2
    forced = client.post(
        f"{V1}/tasks/import", json={"raw": LITERAL_PAYLOAD, "allow_duplicates": True}
    ).json()
    assert forced["created"] == 2
    assert client.get(f"{V1}/tasks").json()["total"] == 4


def test_import_targets_a_project(client: TestClient) -> None:
    project = client.post(f"{V1}/projects", json={"name": "Import target"}).json()
    result = client.post(
        f"{V1}/tasks/import", json={"raw": '[{"title":"Scoped"}]', "project_id": project["id"]}
    ).json()
    assert result["created"] == 1
    task = client.get(f"{V1}/tasks").json()["items"][0]
    assert task["project_id"] == project["id"]
    assert task["project"]["name"] == "Import target"


def test_import_reports_rejected_items_instead_of_failing(
    client: TestClient
) -> None:
    raw = '{"tasks":[{"title":"Good"},{"title":"  "},{"nope":1},{"title":"' + "x" * 501 + '"}]}'
    result = client.post(f"{V1}/tasks/import", json={"raw": raw}).json()
    assert result["created"] == 1
    assert {item["index"] for item in result["rejected"]} == {1, 2, 3}
    assert all("reason" in item and "title" in item for item in result["rejected"])


def test_import_rejects_unparsable_raw(client: TestClient) -> None:
    response = client.post(f"{V1}/tasks/import", json={"raw": "no json here at all"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "raw"


def test_import_validates_the_target_project(client: TestClient) -> None:
    response = client.post(
        f"{V1}/tasks/import", json={"raw": '[{"title":"X"}]', "project_id": "ghost"}
    )
    assert response.status_code == 422


def test_import_requires_raw(client: TestClient) -> None:
    response = client.post(f"{V1}/tasks/import", json={})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "raw"


# ------------------------------------------------------------------- subtasks


def test_parent_child_links_are_enforced(client: TestClient) -> None:
    parent = post_task(client, title="Parent")
    child = post_task(client, title="Child", parent_task_id=parent["id"])
    assert child["parent_task_id"] == parent["id"]
    mismatched = client.post(
        f"{V1}/tasks",
        json={
            "title": "Wrong tree",
            "parent_task_id": parent["id"],
            "project_id": client.post(f"{V1}/projects", json={"name": "Other"}).json()["id"],
        },
    )
    assert mismatched.status_code == 422
    assert mismatched.json()["error"]["details"][0]["field"] == "parent_task_id"
    include_off = client.get(
        f"{V1}/tasks", params={"include_subtasks": "false", "q": "Child"}
    ).json()
    assert include_off["total"] == 0


def test_deleting_a_parent_keeps_children_detached(client: TestClient) -> None:
    parent = post_task(client, title="Parent")
    child = post_task(client, title="Child", parent_task_id=parent["id"])
    assert client.delete(f"{V1}/tasks/{parent['id']}").status_code == 204
    assert client.get(f"{V1}/tasks/{child['id']}").json()["parent_task_id"] is None


def test_due_dates_validate_the_shape_not_the_calendar(client: TestClient) -> None:
    response = client.post(f"{V1}/tasks", json={"title": "Bad", "due_date": "2026-13-01"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "due_date"


def test_the_today_parameter_shape_is_validated(client: TestClient) -> None:
    assert client.get(f"{V1}/tasks", params={"today": "2026-11-1"}).status_code == 422
    assert client.get(f"{V1}/tasks", params={"today": "not-a-date"}).status_code == 422
    assert client.get(f"{V1}/tasks", params={"today": TODAY}).status_code == 200


def test_reference_date_does_not_leak_into_responses(client: TestClient) -> None:
    task = post_task(client, title="Typed", due_date=str(dt.date(2026, 11, 21)))
    assert task["due_date"] == "2026-11-21"
    assert client.get(f"{V1}/tasks/{task['id']}").json()["due_date"] == "2026-11-21"

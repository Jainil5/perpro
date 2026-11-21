"""HTTP contract tests for ``/projects``, ``/projects/{id}/stats`` and ``/milestones``."""

from __future__ import annotations

from fastapi.testclient import TestClient

V1 = "/api/v1"
TODAY = "2026-11-21"

PROJECT_KEYS = {
    "id",
    "name",
    "description",
    "category",
    "status",
    "priority",
    "start_date",
    "target_date",
    "repository_url",
    "documentation_url",
    "next_action",
    "manual_progress",
    "progress",
    "task_counts",
    "next_due",
    "milestone_count",
    "milestones_done",
    "created_at",
    "updated_at",
}

MILESTONE_KEYS = {
    "id",
    "project_id",
    "title",
    "description",
    "date",
    "status",
    "completed_at",
    "days_away",
    "created_at",
    "updated_at",
}


def make_project(client: TestClient, name: str, **body: object) -> dict:
    response = client.post(f"{V1}/projects", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()


def make_task(client: TestClient, **body: object) -> dict:
    response = client.post(f"{V1}/tasks", json={"title": "Task", **body})
    assert response.status_code == 201, response.text
    return response.json()


def make_milestone(client: TestClient, project_id: str, title: str, **body: object) -> dict:
    response = client.post(
        f"{V1}/milestones", json={"project_id": project_id, "title": title, "date": "2026-12-01", **body}
    )
    assert response.status_code == 201, response.text
    return response.json()


def make_note(client: TestClient, title: str, **body: object) -> dict:
    response = client.post(f"{V1}/notes", json={"title": title, **body})
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------- projects


def test_project_shape_matches_the_contract(client: TestClient) -> None:
    project = make_project(
        client,
        "OrderBook CRM",
        description="Multi-tenant orders",
        category="client",
        status="in_progress",
        priority="high",
        start_date="2026-10-01",
        target_date="2026-12-15",
        repository_url="https://example.invalid/repo",
        next_action="Send schema draft to Ravi",
    )
    assert set(project) == PROJECT_KEYS
    assert "slug" not in project  # storage detail, never exposed
    assert project["status"] == "in_progress" and project["priority"] == "high"
    assert project["start_date"] == "2026-10-01" and project["target_date"] == "2026-12-15"
    assert project["documentation_url"] is None
    assert project["progress"] == 0  # no tasks yet => manual_progress
    assert project["task_counts"] == {"total": 0, "done": 0, "open": 0, "overdue": 0}
    assert project["next_due"] is None
    assert project["milestone_count"] == 0 and project["milestones_done"] == 0


def test_manual_progress_only_counts_when_there_are_no_tasks(client: TestClient) -> None:
    project = make_project(client, "Handed", manual_progress=40)
    assert project["progress"] == 40
    tasks = [make_task(client, title=f"T{index}", project_id=project["id"]) for index in range(4)]
    assert client.get(f"{V1}/projects/{project['id']}").json()["progress"] == 0
    client.post(f"{V1}/tasks/{tasks[0]['id']}/complete", params={"today": TODAY})
    assert client.get(f"{V1}/projects/{project['id']}").json()["progress"] == 25
    assert client.patch(
        f"{V1}/projects/{project['id']}", json={"manual_progress": 80}
    ).json()["manual_progress"] == 80


def test_progress_is_the_documented_rounding(client: TestClient) -> None:
    project = make_project(client, "Counted")
    for index in range(13):
        task = make_task(client, title=f"task {index}", project_id=project["id"])
        if index < 8:
            client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})
    fetched = client.get(f"{V1}/projects/{project['id']}").json()
    assert fetched["task_counts"] == {"total": 13, "done": 8, "open": 5, "overdue": 0}
    assert fetched["progress"] == 62


def test_completed_and_archived_projects_are_always_full(client: TestClient) -> None:
    project = make_project(client, "Finished", status="completed")
    make_task(client, title="Loose end", project_id=project["id"])
    assert client.get(f"{V1}/projects/{project['id']}").json()["progress"] == 100


def test_next_due_is_the_nearest_open_task(client: TestClient) -> None:
    project = make_project(client, "Scheduled")
    make_task(client, title="Far", project_id=project["id"], due_date="2026-12-30")
    near = make_task(client, title="Near", project_id=project["id"], due_date="2026-11-23")
    fetched = client.get(f"{V1}/projects/{project['id']}").json()
    assert fetched["next_due"] == {"title": "Near", "due_date": "2026-11-23"}
    client.post(f"{V1}/tasks/{near['id']}/complete", params={"today": TODAY})
    assert client.get(f"{V1}/projects/{project['id']}").json()["next_due"]["title"] == "Far"


def test_duplicate_project_names_conflict(client: TestClient) -> None:
    make_project(client, "OrderBook CRM")
    response = client.post(f"{V1}/projects", json={"name": "OrderBook CRM"})
    assert response.status_code == 409
    envelope = response.json()["error"]
    assert envelope["code"] == "conflict"
    assert envelope["details"] == [] or envelope["details"][0]["field"] == "name"


def test_name_matching_is_trimmed_and_case_insensitive(client: TestClient) -> None:
    make_project(client, "Alpha One")
    for variant in ("alpha one", "  Alpha One  ", "ALPHA ONE"):
        response = client.post(f"{V1}/projects", json={"name": variant})
        assert response.status_code == 409, variant


def test_rename_onto_an_existing_name_conflicts(client: TestClient) -> None:
    first = make_project(client, "First")
    make_project(client, "Second")
    response = client.patch(f"{V1}/projects/{first['id']}", json={"name": "Second"})
    assert response.status_code == 409
    assert client.get(f"{V1}/projects/{first['id']}").json()["name"] == "First"


def test_project_list_filters_sort_and_pages(client: TestClient) -> None:
    a = make_project(client, "Atlas", status="in_progress", priority="high", target_date="2026-12-01")
    b = make_project(client, "Beta", status="backlog", priority="low", target_date="2026-11-01")
    c = make_project(client, "Gamma", status="completed", target_date="2027-01-01")

    def names(**params) -> list[str]:
        response = client.get(f"{V1}/projects", params={"today": TODAY, **params})
        assert response.status_code == 200, response.text
        return [project["name"] for project in response.json()["items"]]

    assert names(status="in_progress") == ["Atlas"]
    assert names(priority="low") == ["Beta"]
    assert names(q="atlas") == ["Atlas"]
    assert names(sort="name") == ["Atlas", "Beta", "Gamma"]
    assert names(sort="target") == ["Beta", "Atlas", "Gamma"]
    page = client.get(f"{V1}/projects", params={"sort": "name", "limit": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 2
    assert [p["name"] for p in page["items"]] == ["Atlas", "Beta"]
    # a project keeps the derived blocks in a list too
    listed = client.get(f"{V1}/projects", params={"sort": "name"}).json()["items"]
    assert {row["id"] for row in listed} == {a["id"], b["id"], c["id"]}
    assert all(set(row) == PROJECT_KEYS for row in listed)


def test_project_stats_block(client: TestClient) -> None:
    project = make_project(client, "Stats")
    task = make_task(client, title="Due today", project_id=project["id"], due_date=TODAY)
    make_task(client, title="Backlog", project_id=project["id"], status="blocked")
    make_task(client, title="Upcoming", project_id=project["id"], due_date="2026-11-25")
    stats = client.get(f"{V1}/projects/{project['id']}/stats", params={"today": TODAY}).json()
    assert set(stats) == {
        "total",
        "done",
        "open",
        "overdue",
        "due_today",
        "pct",
        "next_due",
        "by_status",
        "by_priority",
    }
    assert stats["total"] == 3 and stats["open"] == 3 and stats["done"] == 0
    assert stats["due_today"] == 1 and stats["overdue"] == 0
    assert stats["pct"] == 0
    assert stats["by_status"]["blocked"] == 1 and stats["by_status"]["todo"] == 2
    assert stats["by_priority"]["medium"] == 3
    # next_due is the next *upcoming* date, so today's task does not count
    assert stats["next_due"] == {"title": "Upcoming", "due_date": "2026-11-25"}
    client.post(f"{V1}/tasks/{task['id']}/complete", params={"today": TODAY})
    after = client.get(f"{V1}/projects/{project['id']}/stats", params={"today": TODAY}).json()
    assert after["done"] == 1 and after["pct"] == 33 and after["due_today"] == 0


def test_stats_and_detail_404_for_unknown_projects(client: TestClient) -> None:
    missing = "00000000-0000-4000-8000-000000000000"
    for path in (f"/projects/{missing}", f"/projects/{missing}/stats"):
        response = client.get(f"{V1}{path}")
        assert response.status_code == 404, path
        assert response.json()["error"]["code"] == "not_found"


def test_deleting_a_project_keeps_tasks_and_drops_milestones(client: TestClient) -> None:
    project = make_project(client, "Dropped")
    task = make_task(client, title="Survivor", project_id=project["id"])
    milestone = make_milestone(client, project["id"], "Vanishes")
    note = make_note(client, "Kept too", project_id=project["id"])

    assert client.delete(f"{V1}/projects/{project['id']}").status_code == 204
    assert client.get(f"{V1}/projects/{project['id']}").status_code == 404

    survivor = client.get(f"{V1}/tasks/{task['id']}").json()
    assert survivor["project_id"] is None and survivor["project"] is None
    # milestones really go; the list is the only read route API.md documents
    assert [row["id"] for row in client.get(f"{V1}/milestones").json()["items"]] == []
    assert client.patch(f"{V1}/milestones/{milestone['id']}", json={"title": "x"}).status_code == 404
    assert client.get(f"{V1}/notes/{note['id']}").json()["project_id"] is None
    assert client.get(f"{V1}/projects").json()["total"] == 0


def test_project_patch_clears_optional_fields(client: TestClient) -> None:
    project = make_project(client, "Loose", target_date="2026-12-15", next_action="Do it")
    patched = client.patch(
        f"{V1}/projects/{project['id']}", json={"target_date": None, "next_action": "Later"}
    ).json()
    assert patched["target_date"] is None and patched["next_action"] == "Later"
    assert patched["name"] == "Loose"


def test_project_validation(client: TestClient) -> None:
    missing = client.post(f"{V1}/projects", json={})
    assert missing.status_code == 422
    assert missing.json()["error"]["details"][0]["field"] == "name"
    assert client.post(f"{V1}/projects", json={"name": " "}).status_code == 422
    assert client.post(f"{V1}/projects", json={"name": "X", "progress": 5}).status_code == 422
    assert (
        client.get(f"{V1}/projects", params={"status": "someday"}).json()["error"]["code"]
        == "validation_error"
    )
    assert client.patch(f"{V1}/projects/x", json={"manual_progress": 101}).status_code == 422


# ------------------------------------------------------------------- milestones


def test_milestone_shape_and_days_away(client: TestClient) -> None:
    project = make_project(client, "Milestone home")
    milestone = make_milestone(client, project["id"], "Beta to first client", date="2026-12-01")
    assert set(milestone) == MILESTONE_KEYS
    assert milestone["status"] == "open" and milestone["completed_at"] is None
    assert milestone["project_id"] == project["id"]
    # days_away is relative to ?today=: 2026-11-21 -> 2026-12-01
    assert milestone["days_away"] == 10
    listed = client.get(f"{V1}/milestones", params={"today": "2026-11-25"}).json()["items"]
    assert [row["days_away"] for row in listed] == [6]


def test_milestone_list_is_open_first_by_date(client: TestClient) -> None:
    project = make_project(client, "Ordered")
    make_milestone(client, project["id"], "Later", date="2027-01-10")
    make_milestone(client, project["id"], "Soon", date="2026-12-01")
    make_milestone(client, project["id"], "Past", date="2026-11-01")
    listed = client.get(f"{V1}/milestones", params={"today": TODAY}).json()
    assert set(listed) == {"items", "total"}
    assert [row["title"] for row in listed["items"]] == ["Past", "Soon", "Later"]
    assert listed["total"] == 3

    filtered = client.get(
        f"{V1}/milestones", params={"project_id": project["id"], "status": "open"}
    ).json()
    assert filtered["total"] == 3
    done = client.post(f"{V1}/milestones/{listed['items'][0]['id']}/complete").json()
    assert done["status"] == "done" and done["completed_at"].endswith("Z")
    assert client.get(f"{V1}/milestones", params={"status": "done"}).json()["total"] == 1
    assert client.get(f"{V1}/milestones", params={"status": "open"}).json()["total"] == 2
    reopened = client.post(f"{V1}/milestones/{done['id']}/reopen").json()
    assert reopened["status"] == "open" and reopened["completed_at"] is None


def test_milestones_count_into_their_project(client: TestClient) -> None:
    project = make_project(client, "Counted milestones")
    milestone = make_milestone(client, project["id"], "v1")
    assert client.get(f"{V1}/projects/{project['id']}").json()["milestone_count"] == 1
    client.post(f"{V1}/milestones/{milestone['id']}/complete")
    after = client.get(f"{V1}/projects/{project['id']}").json()
    assert after["milestone_count"] == 1 and after["milestones_done"] == 1


def test_milestone_validation_and_missing_rows(client: TestClient) -> None:
    project = make_project(client, "Anchor")
    for body in (
        {"title": "No project"},
        {"project_id": project["id"]},
        {"project_id": project["id"], "title": "Bad date", "date": "12-2026"},
        {"project_id": "00000000-0000-4000-8000-000000000000", "title": "Ghost", "date": "2026-12-01"},
    ):
        response = client.post(f"{V1}/milestones", json=body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"

    created = make_milestone(client, project["id"], "Delete me")
    assert client.delete(f"{V1}/milestones/{created['id']}").status_code == 204
    assert client.delete(f"{V1}/milestones/{created['id']}").status_code == 404
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.patch(f"{V1}/milestones/{missing}", json={"title": "x"}).status_code == 404
    assert client.post(f"{V1}/milestones/{missing}/complete").status_code == 404
    assert client.delete(f"{V1}/milestones/{missing}").status_code == 404


def test_milestone_patch_only_touches_supplied_fields(client: TestClient) -> None:
    project = make_project(client, "Patched milestone")
    milestone = make_milestone(client, project["id"], "Original", date="2026-12-01")
    patched = client.patch(
        f"{V1}/milestones/{milestone['id']}", json={"description": "Scope freeze"}
    ).json()
    assert patched["title"] == "Original" and patched["date"] == "2026-12-01"
    assert patched["description"] == "Scope freeze"

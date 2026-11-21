"""HTTP contract tests for ``/contacts``, ``/companies``, ``/goals`` and ``/reminders``."""

from __future__ import annotations

from fastapi.testclient import TestClient

V1 = "/api/v1"

CONTACT_KEYS = {
    "id",
    "name",
    "email",
    "phone",
    "title",
    "company_id",
    "company",
    "location",
    "kind",
    "tags",
    "notes",
    "created_at",
    "updated_at",
}

COMPANY_KEYS = {
    "id",
    "name",
    "website",
    "industry",
    "location",
    "notes",
    "contact_count",
    "created_at",
    "updated_at",
}

GOAL_KEYS = {
    "id",
    "title",
    "description",
    "project_id",
    "project",
    "category",
    "priority",
    "status",
    "progress",
    "target_date",
    "completed_at",
    "created_at",
    "updated_at",
}

REMINDER_KEYS = {
    "id",
    "title",
    "due_at",
    "status",
    "entity_type",
    "entity_id",
    "notes",
    "snoozed_until",
    "created_at",
    "updated_at",
}


def create(client: TestClient, path: str, body: dict) -> dict:
    response = client.post(f"{V1}{path}", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------- contacts


def test_contact_shape(client: TestClient) -> None:
    company = create(client, "/companies", {"name": "Northwind", "industry": "fintech"})
    contact = create(
        client,
        "/contacts",
        {
            "name": "Ravi Kumar",
            "email": "ravi@example.com",
            "title": "CTO",
            "company_id": company["id"],
            "location": "Bengaluru",
            "kind": "client",
            "tags": ["crm"],
        },
    )
    assert set(contact) == CONTACT_KEYS
    assert contact["company"] == "Northwind" and contact["company_id"] == company["id"]
    assert contact["kind"] == "client" and contact["tags"] == ["crm"]
    assert contact["phone"] is None and contact["notes"] is None
    assert contact["created_at"].endswith("Z")


def test_contact_defaults_and_casing(client: TestClient) -> None:
    contact = create(client, "/contacts", {"name": "  Ana Silva  ", "kind": "Personal"})
    assert contact["name"] == "Ana Silva"
    assert contact["kind"] == "personal"
    assert contact["company_id"] is None and contact["company"] is None


def test_contact_list_filters(client: TestClient) -> None:
    north = create(client, "/companies", {"name": "Northwind"})
    create(client, "/contacts", {"name": "Ravi Kumar", "company_id": north["id"], "kind": "client", "tags": ["crm"]})
    create(client, "/contacts", {"name": "Dana Lee", "kind": "vendor", "email": "dana@example.com"})

    def names(**params) -> list[str]:
        response = client.get(f"{V1}/contacts", params=params)
        assert response.status_code == 200, response.text
        body = response.json()
        assert set(body) == {"items", "total"}  # API.md rule 1
        return [row["name"] for row in body["items"]]

    assert names(kind="client") == ["Ravi Kumar"]
    assert names(kind="Vendor") == ["Dana Lee"]
    assert names(company_id=north["id"]) == ["Ravi Kumar"]
    assert names(tag="crm") == ["Ravi Kumar"]
    assert names(tag="#CRM") == ["Ravi Kumar"]
    assert names(q="dana@example.com") == ["Dana Lee"]
    assert names(q="kumar") == ["Ravi Kumar"]
    assert names(kind="client", q="ravi") == ["Ravi Kumar"]


def test_contact_and_company_validation(client: TestClient) -> None:
    missing = client.post(f"{V1}/contacts", json={"email": "x@example.com"})
    assert missing.status_code == 422
    assert missing.json()["error"]["details"][0]["field"] == "name"

    bad_kind = client.post(f"{V1}/contacts", json={"name": "X", "kind": "colleague"})
    assert bad_kind.status_code == 422

    # email is a free-text column in Phase 1 - stored as typed, never rewritten
    loose = client.post(f"{V1}/contacts", json={"name": "X", "email": "not-an-email"})
    assert loose.status_code == 201
    assert loose.json()["email"] == "not-an-email"

    ghost_company = client.post(f"{V1}/contacts", json={"name": "X", "company_id": "ghost"})
    assert ghost_company.status_code == 422

    blank_company = client.post(f"{V1}/companies", json={"name": ""})
    assert blank_company.status_code == 422

    listed = client.get(f"{V1}/contacts", params={"kind": "nonsense"})
    assert listed.status_code == 422
    assert listed.json()["error"]["details"][0]["loc"] == ["query", "kind"]


def test_contact_update_and_delete(client: TestClient) -> None:
    contact = create(client, "/contacts", {"name": "Temp"})
    patched = client.patch(f"{V1}/contacts/{contact['id']}", json={"title": "CEO"}).json()
    assert patched["title"] == "CEO" and patched["name"] == "Temp"
    assert client.delete(f"{V1}/contacts/{contact['id']}").status_code == 204
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"{V1}/contacts/{missing}").status_code == 404
    assert client.patch(f"{V1}/contacts/{missing}", json={"title": "x"}).status_code == 404
    assert client.delete(f"{V1}/contacts/{missing}").status_code == 404


# --------------------------------------------------------------------- companies


def test_company_counts_its_contacts(client: TestClient) -> None:
    company = create(client, "/companies", {"name": "Northwind", "website": "https://example.invalid"})
    assert set(company) == COMPANY_KEYS
    assert company["contact_count"] == 0 and company["location"] is None

    first = create(client, "/contacts", {"name": "One", "company_id": company["id"]})
    create(client, "/contacts", {"name": "Two", "company_id": company["id"]})
    listed = client.get(f"{V1}/companies").json()
    assert set(listed) == {"items", "total"}
    assert listed["total"] == 1
    assert listed["items"][0]["contact_count"] == 2

    assert client.delete(f"{V1}/contacts/{first['id']}").status_code == 204
    after = client.get(f"{V1}/companies").json()["items"][0]
    assert after["contact_count"] == 1

    patched = client.patch(f"{V1}/companies/{company['id']}", json={"industry": "saas"}).json()
    assert patched["industry"] == "saas" and patched["name"] == "Northwind"
    assert client.delete(f"{V1}/companies/{company['id']}").status_code == 204
    assert client.get(f"{V1}/companies").json()["items"] == []


def test_deleting_a_company_detaches_contacts(client: TestClient) -> None:
    company = create(client, "/companies", {"name": "Vanishing"})
    contact = create(client, "/contacts", {"name": "Kept", "company_id": company["id"]})
    assert client.delete(f"{V1}/companies/{company['id']}").status_code == 204
    survivor = client.get(f"{V1}/contacts/{contact['id']}").json()
    assert survivor["company_id"] is None and survivor["company"] is None


# ------------------------------------------------------------------------- goals


def test_goal_shape_progress_and_completion(client: TestClient) -> None:
    goal = create(
        client,
        "/goals",
        {
            "title": "Ship v1",
            "description": "the release",
            "category": "business",
            "priority": "High",
            "target_date": "2026-12-31",
            "progress": 40,
        },
    )
    assert set(goal) == GOAL_KEYS
    assert goal["status"] == "active" and goal["priority"] == "high"
    assert goal["progress"] == 40 and goal["completed_at"] is None
    assert goal["target_date"] == "2026-12-31"

    moved = client.patch(f"{V1}/goals/{goal['id']}", json={"progress": 55}).json()
    assert moved["progress"] == 55 and moved["status"] == "active"

    completed = client.post(f"{V1}/goals/{goal['id']}/complete").json()
    assert completed["status"] == "completed"
    assert completed["progress"] == 100
    assert completed["completed_at"].endswith("Z")

    abandoned = client.patch(f"{V1}/goals/{goal['id']}", json={"status": "abandoned"}).json()
    assert abandoned["status"] == "abandoned"
    assert client.patch(f"{V1}/goals/{goal['id']}", json={"status": "dropped"}).status_code == 422


def test_goal_project_link_round_trip(client: TestClient) -> None:
    project = create(client, "/projects", {"name": "Atlas rollout"})
    goal = create(client, "/goals", {"title": "Ship Atlas", "project_id": project["id"]})
    assert goal["project_id"] == project["id"]
    assert goal["project"] == {
        "id": project["id"],
        "name": "Atlas rollout",
        "status": project["status"],
    }

    listed = client.get(f"{V1}/goals").json()["items"][0]
    assert listed["project_id"] == project["id"] and listed["project"]["name"] == "Atlas rollout"

    moved = create(client, "/projects", {"name": "Other work"})
    patched = client.patch(f"{V1}/goals/{goal['id']}", json={"project_id": moved["id"]}).json()
    assert patched["project_id"] == moved["id"] and patched["project"]["name"] == "Other work"

    unlinked = client.patch(f"{V1}/goals/{goal['id']}", json={"project_id": None}).json()
    assert unlinked["project_id"] is None and unlinked["project"] is None


def test_goal_without_project_is_null(client: TestClient) -> None:
    goal = create(client, "/goals", {"title": "Loose end"})
    assert goal["project_id"] is None and goal["project"] is None
    assert client.get(f"{V1}/goals/{goal['id']}").json()["project"] is None


def test_deleting_a_project_keeps_its_goal_unlinked(client: TestClient) -> None:
    project = create(client, "/projects", {"name": "Doomed"})
    goal = create(client, "/goals", {"title": "Outlives the project", "project_id": project["id"]})
    assert client.delete(f"{V1}/projects/{project['id']}").status_code == 204
    survivor = client.get(f"{V1}/goals/{goal['id']}").json()
    assert survivor["title"] == "Outlives the project"
    assert survivor["project_id"] is None and survivor["project"] is None


def test_goal_project_id_is_validated(client: TestClient) -> None:
    response = client.post(
        f"{V1}/goals",
        json={"title": "Orphan", "project_id": "00000000-0000-4000-8000-000000000000"},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"] == "project_id not found"
    assert error["details"] == [
        {
            "loc": ["project_id"],
            "field": "project_id",
            "msg": "project_id does not reference an existing record",
            "type": "value_error",
        }
    ]
    assert client.patch(
        f"{V1}/goals/{create(client, '/goals', {'title': 'Patch target'})['id']}",
        json={"project_id": "does-not-exist"},
    ).status_code == 422


def test_goal_progress_is_bounded(client: TestClient) -> None:
    goal = create(client, "/goals", {"title": "Bounded"})
    for bad in ({"progress": 101}, {"progress": -1}, {"target_date": "31/12/2026"}):
        response = client.patch(f"{V1}/goals/{goal['id']}", json=bad)
        assert response.status_code == 422, bad
    assert client.post(f"{V1}/goals", json={"title": "X", "progress": 200}).status_code == 422


def test_goal_list_and_crud_round_trip(client: TestClient) -> None:
    active = create(client, "/goals", {"title": "Active goal", "target_date": "2026-11-01"})
    create(client, "/goals", {"title": "Done goal", "status": "completed"})
    listed = client.get(f"{V1}/goals").json()
    assert set(listed) == {"items", "total"}
    assert listed["total"] == 2
    assert [row["title"] for row in client.get(f"{V1}/goals", params={"status": "active"}).json()["items"]] == [
        "Active goal"
    ]
    assert [row["title"] for row in client.get(f"{V1}/goals", params={"q": "done"}).json()["items"]] == [
        "Done goal"
    ]
    assert client.get(f"{V1}/goals/{active['id']}").json()["title"] == "Active goal"
    assert client.delete(f"{V1}/goals/{active['id']}").status_code == 204
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"{V1}/goals/{missing}").status_code == 404
    assert client.post(f"{V1}/goals/{missing}/complete").status_code == 404
    assert client.patch(f"{V1}/goals/{missing}", json={"progress": 5}).status_code == 404
    assert client.delete(f"{V1}/goals/{missing}").status_code == 404


# --------------------------------------------------------------------- reminders


def test_reminder_shape_and_utc_instant(client: TestClient) -> None:
    reminder = create(
        client,
        "/reminders",
        {"title": "Chase invoice", "due_at": "2026-11-24T09:00:00Z", "notes": "acme"},
    )
    assert set(reminder) == REMINDER_KEYS
    assert reminder["status"] == "pending"
    assert reminder["due_at"] == "2026-11-24T09:00:00Z"
    assert reminder["snoozed_until"] is None
    assert reminder["entity_type"] is None and reminder["entity_id"] is None


def test_reminder_offsets_are_normalised_to_z(client: TestClient) -> None:
    reminder = create(client, "/reminders", {"title": "Offset", "due_at": "2026-11-24T09:00:00+05:30"})
    assert reminder["due_at"] == "2026-11-24T03:30:00Z"
    naive = create(client, "/reminders", {"title": "Naive", "due_at": "2026-11-24 09:00"})
    assert naive["due_at"] == "2026-11-24T09:00:00Z"
    # schemas.common.parse_datetime: a bare date means midnight UTC
    bare = create(client, "/reminders", {"title": "Bare date", "due_at": "2026-11-24"})
    assert bare["due_at"] == "2026-11-24T00:00:00Z"
    assert client.post(f"{V1}/reminders", json={"title": "Bad", "due_at": "2026-11-24T09:00:00+25:00"}).status_code == 422


def test_reminder_entity_link_is_validated(client: TestClient) -> None:
    task = create(client, "/tasks", {"title": "Reminded task"})
    reminder = create(
        client,
        "/reminders",
        {"title": "On a task", "due_at": "2026-11-24T09:00:00Z", "entity_type": "task", "entity_id": task["id"]},
    )
    assert reminder["entity_type"] == "task" and reminder["entity_id"] == task["id"]

    ghost = client.post(
        f"{V1}/reminders",
        json={
            "title": "Dangling",
            "due_at": "2026-11-24T09:00:00Z",
            "entity_type": "task",
            "entity_id": "00000000-0000-4000-8000-000000000000",
        },
    )
    assert ghost.status_code == 422
    wrong_type = client.post(
        f"{V1}/reminders",
        json={"title": "Bad", "due_at": "2026-11-24T09:00:00Z", "entity_type": "invoice", "entity_id": task["id"]},
    )
    assert wrong_type.status_code == 422
    type_without_id = client.post(
        f"{V1}/reminders",
        json={"title": "Bad", "due_at": "2026-11-24T09:00:00Z", "entity_type": "task"},
    )
    assert type_without_id.status_code == 422


def test_reminder_complete_snooze_and_list_filters(client: TestClient) -> None:
    soon = create(client, "/reminders", {"title": "Due now", "due_at": "2026-11-21T06:00:00Z"})
    later = create(client, "/reminders", {"title": "Due later", "due_at": "2026-12-21T06:00:00Z"})

    body = client.get(f"{V1}/reminders", params={"today": "2026-11-21"}).json()
    assert set(body) == {"items", "total"}
    assert [row["title"] for row in body["items"]] == ["Due now", "Due later"]

    due = client.get(f"{V1}/reminders", params={"today": "2026-11-21", "due": "today"}).json()
    assert [row["title"] for row in due["items"]] == ["Due now"]
    assert client.get(f"{V1}/reminders", params={"due": "none"}).json()["items"] == []
    assert client.get(f"{V1}/reminders", params={"due": "overdue"}).status_code == 422

    completed = client.post(f"{V1}/reminders/{soon['id']}/complete").json()
    assert completed["status"] == "done"  # API.md's reminder shape has no completed_at
    assert client.get(f"{V1}/reminders", params={"status": "done"}).json()["total"] == 1
    assert client.get(f"{V1}/reminders", params={"status": "pending"}).json()["total"] == 1

    snoozed = client.post(f"{V1}/reminders/{later['id']}/snooze", json={"minutes": 60}).json()
    assert snoozed["snoozed_until"].endswith("Z")
    assert snoozed["status"] == "pending"
    # a done reminder comes back to pending when it is snoozed
    revived = client.post(f"{V1}/reminders/{soon['id']}/snooze", json={"minutes": 10}).json()
    assert revived["status"] == "pending"
    assert client.post(f"{V1}/reminders/{soon['id']}/snooze", json={"minutes": 0}).status_code == 422
    # minutes is optional: the documented default window
    defaulted = client.post(f"{V1}/reminders/{soon['id']}/snooze", json={}).json()
    assert defaulted["snoozed_until"].endswith("Z")

    assert client.delete(f"{V1}/reminders/{later['id']}").status_code == 204
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"{V1}/reminders/{missing}").status_code == 404
    assert client.post(f"{V1}/reminders/{missing}/snooze", json={"minutes": 5}).status_code == 404
    assert client.patch(f"{V1}/reminders/{missing}", json={"title": "x"}).status_code == 404
    assert client.delete(f"{V1}/reminders/{missing}").status_code == 404


def test_reminder_body_validation(client: TestClient) -> None:
    for body in (
        {"title": "No due date"},
        {"due_at": "2026-11-24T09:00:00Z"},
        {"title": "Bad", "due_at": "yesterday"},
        {"title": "Bad", "due_at": "2026-11-24T09:00:00Z", "status": "snoozed"},
        {"title": "Bad", "due_at": "2026-11-24T09:00:00Z", "minutes": 5},
    ):
        response = client.post(f"{V1}/reminders", json=body)
        assert response.status_code == 422, body
        assert response.json()["error"]["code"] == "validation_error"


def test_reminder_update_can_relink_and_clear(client: TestClient) -> None:
    task = create(client, "/tasks", {"title": "First target"})
    other = create(client, "/tasks", {"title": "Second target"})
    reminder = create(
        client,
        "/reminders",
        {"title": "Relink me", "due_at": "2026-11-24T09:00:00Z", "entity_type": "task", "entity_id": task["id"]},
    )
    patched = client.patch(
        f"{V1}/reminders/{reminder['id']}", json={"entity_type": "task", "entity_id": other["id"]}
    ).json()
    assert patched["entity_id"] == other["id"]
    assert client.patch(
        f"{V1}/reminders/{reminder['id']}", json={"entity_id": "ghost"}
    ).status_code == 422
    cleared = client.patch(
        f"{V1}/reminders/{reminder['id']}", json={"entity_type": None, "entity_id": None}
    ).json()
    assert cleared["entity_type"] is None and cleared["entity_id"] is None

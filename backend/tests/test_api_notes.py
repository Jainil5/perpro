"""HTTP contract tests for ``/notes``, ``/note-tags`` and note relations."""

from __future__ import annotations

from fastapi.testclient import TestClient

V1 = "/api/v1"

NOTE_KEYS = {
    "id",
    "title",
    "category",
    "tags",
    "is_favorite",
    "project_id",
    "word_count",
    "relations",
    "backlinks",
    "created_at",
    "updated_at",
    "content",
}

SUMMARY_KEYS = (NOTE_KEYS - {"content"}) | {"excerpt"}


def make_note(client: TestClient, title: str, **body: object) -> dict:
    response = client.post(f"{V1}/notes", json={"title": title, **body})
    assert response.status_code == 201, response.text
    return response.json()


def make_project(client: TestClient, name: str) -> dict:
    return client.post(f"{V1}/projects", json={"name": name}).json()


def make_task(client: TestClient, title: str, **body: object) -> dict:
    response = client.post(f"{V1}/tasks", json={"title": title, **body})
    assert response.status_code == 201, response.text
    return response.json()


# -------------------------------------------------------------------------- crud


def test_note_shape_lists_content_and_derived_fields(client: TestClient) -> None:
    note = make_note(
        client,
        "RLS patterns",
        content="# markdown body\n\none two three",
        category="technical",
        tags=["postgres", "security"],
    )
    assert set(note) == NOTE_KEYS
    assert note["content"].startswith("# markdown")
    assert note["category"] == "technical" and note["tags"] == ["postgres", "security"]
    assert note["is_favorite"] is False and note["project_id"] is None
    assert note["relations"] == [] and note["backlinks"] == []
    assert note["word_count"] == 5  # "one two three" plus the heading words


def test_note_list_uses_summaries_with_excerpts(client: TestClient) -> None:
    long = "word " * 200
    make_note(client, "Long", content=long)
    listed = client.get(f"{V1}/notes").json()
    assert set(listed) == {"items", "total", "categories"}
    summary = listed["items"][0]
    assert set(summary) == SUMMARY_KEYS
    assert "content" not in summary
    assert len(summary["excerpt"]) <= 161 and summary["excerpt"].endswith("…")


def test_note_list_filters_and_sorts(client: TestClient) -> None:
    project = make_project(client, "Note home")
    make_note(client, "Alpha note", category="technical", tags=["postgres"], content="a b c")
    make_note(client, "Beta note", category="meeting", is_favorite=True, content="d e")
    make_note(client, "Gamma note", project_id=project["id"], content="f g h i")

    def titles(**params) -> list[str]:
        response = client.get(f"{V1}/notes", params=params)
        assert response.status_code == 200, response.text
        return [note["title"] for note in response.json()["items"]]

    assert titles(category="meeting") == ["Beta note"]
    assert titles(tag="postgres") == ["Alpha note"]
    assert titles(tag="#Postgres") == ["Alpha note"]
    assert titles(favorite="true") == ["Beta note"]
    # the filter is the assertion here, not the order: without a `sort=` the default is
    # `updated_at desc`, and three notes created in one request are within one tick of
    # each other, so only the title sort may be pinned by position.
    assert sorted(titles(favorite="false")) == ["Alpha note", "Gamma note"]
    assert titles(q="Gamma") == ["Gamma note"]
    assert titles(project_id=project["id"]) == ["Gamma note"]
    assert titles(sort="title") == ["Alpha note", "Beta note", "Gamma note"]
    assert {row["category"] for row in client.get(f"{V1}/notes").json()["categories"]} == {
        "technical",
        "meeting",
        "personal",
    }
    assert all(row["count"] >= 1 for row in client.get(f"{V1}/notes").json()["categories"])
    page = client.get(f"{V1}/notes", params={"sort": "title", "limit": 1}).json()
    assert page["total"] == 3 and len(page["items"]) == 1


def test_unknown_note_category_and_sort_are_422(client: TestClient) -> None:
    for params in ({"category": "wiki"}, {"sort": "relevance"}, {"favorite": "maybe"}):
        response = client.get(f"{V1}/notes", params=params)
        assert response.status_code == 422, params
        assert response.json()["error"]["code"] == "validation_error"


def test_get_patch_and_delete_a_note(client: TestClient) -> None:
    note = make_note(client, "Draft", content="first")
    assert client.get(f"{V1}/notes/{note['id']}").json()["content"] == "first"
    patched = client.patch(f"{V1}/notes/{note['id']}", json={"title": "Final"}).json()
    assert patched["title"] == "Final" and patched["content"] == "first"
    assert client.delete(f"{V1}/notes/{note['id']}").status_code == 204
    assert client.get(f"{V1}/notes/{note['id']}").status_code == 404
    missing = "00000000-0000-4000-8000-000000000000"
    assert client.get(f"{V1}/notes/{missing}").status_code == 404
    assert client.patch(f"{V1}/notes/{missing}", json={"title": "x"}).status_code == 404
    assert client.delete(f"{V1}/notes/{missing}").status_code == 404


def test_note_requires_a_title_and_valid_category(client: TestClient) -> None:
    missing = client.post(f"{V1}/notes", json={"content": "body"})
    assert missing.status_code == 422
    assert missing.json()["error"]["details"][0]["field"] == "title"
    blank = client.post(f"{V1}/notes", json={"title": "   "})
    assert blank.status_code == 422
    bad = client.post(f"{V1}/notes", json={"title": "X", "category": "wiki"})
    assert bad.status_code == 422
    detail = bad.json()["error"]["details"][0]
    assert detail["field"] == "category" and "must be one of" in detail["msg"]
    ghost = client.post(f"{V1}/notes", json={"title": "X", "project_id": "ghost"})
    assert ghost.status_code == 422


# --------------------------------------------------------------------- relations


def test_relations_are_created_with_the_note_and_read_back(client: TestClient) -> None:
    task = make_task(client, "Linked task")
    project = make_project(client, "Linked project")
    note = make_note(
        client,
        "Hub",
        relations=[{"target_type": "task", "target_id": task["id"]}],
    )
    assert len(note["relations"]) == 1
    relation = note["relations"][0]
    assert set(relation) == {"id", "target_type", "target_id", "target_title", "label"}
    assert relation["label"] is None
    assert relation["target_type"] == "task" and relation["target_id"] == task["id"]
    assert relation["target_title"] == "Linked task"

    added = client.post(
        f"{V1}/notes/{note['id']}/relations",
        json={"relations": [{"target_type": "project", "target_id": project["id"]}]},
    )
    assert added.status_code == 201, added.text
    rows = added.json()
    assert isinstance(rows, list) and len(rows) == 2
    assert [row["target_type"] for row in rows] == ["project", "task"]  # sorted by type


def test_relations_are_case_insensitive_and_deduplicated(client: TestClient) -> None:
    task = make_task(client, "Dated")
    note = make_note(
        client,
        "Dedupe",
        relations=[
            {"target_type": "Task", "target_id": task["id"]},
            {"target_type": "task", "target_id": task["id"]},
        ],
    )
    assert len(note["relations"]) == 1


def test_backlinks_point_at_the_target_note(client: TestClient) -> None:
    target = make_note(client, "Being referenced", content="text")
    source = make_note(
        client, "Referencing", relations=[{"target_type": "note", "target_id": target["id"]}]
    )
    fetched = client.get(f"{V1}/notes/{target['id']}").json()
    assert fetched["backlinks"] == [{"note_id": source["id"], "note_title": "Referencing"}]
    assert fetched["relations"] == []


def test_relation_validation(client: TestClient) -> None:
    note = make_note(client, "Strict")
    unknown_type = client.post(
        f"{V1}/notes/{note['id']}/relations",
        json={"relations": [{"target_type": "invoice", "target_id": "x"}]},
    )
    assert unknown_type.status_code == 422
    assert unknown_type.json()["error"]["details"][0]["field"] == "relations.0.target_type"

    ghost = client.post(
        f"{V1}/notes/{note['id']}/relations",
        json={"relations": [{"target_type": "task", "target_id": "00000000-0000-4000-8000-000000000000"}]},
    )
    assert ghost.status_code == 422
    # the unknown id is a service rule, not a Pydantic shape error
    assert ghost.json()["error"]["details"][0]["field"] == "target_id"

    blank = client.post(
        f"{V1}/notes/{note['id']}/relations", json={"relations": [{"target_type": "", "target_id": ""}]}
    )
    assert blank.status_code == 422


def test_relations_can_be_removed(client: TestClient) -> None:
    task = make_task(client, "Unlink me")
    note = make_note(client, "Linker", relations=[{"target_type": "task", "target_id": task["id"]}])
    relation_id = note["relations"][0]["id"]
    removed = client.delete(f"{V1}/notes/{note['id']}/relations/{relation_id}")
    assert removed.status_code == 204
    assert client.get(f"{V1}/notes/{note['id']}").json()["relations"] == []
    again = client.delete(f"{V1}/notes/{note['id']}/relations/{relation_id}")
    assert again.status_code == 404
    assert again.json()["error"]["code"] == "not_found"


def test_deleting_a_linked_target_leaves_a_stable_relation(client: TestClient) -> None:
    task = make_task(client, "Temporary target")
    note = make_note(client, "Pointer", relations=[{"target_type": "task", "target_id": task["id"]}])
    assert client.delete(f"{V1}/tasks/{task['id']}").status_code == 204
    relations = client.get(f"{V1}/notes/{note['id']}").json()["relations"]
    assert relations == []


# --------------------------------------------------------------------- note-tags


def test_note_tags_is_a_bare_array_of_counts(client: TestClient) -> None:
    make_note(client, "One", tags=["postgres", "security"])
    make_note(client, "Two", tags=["postgres"])
    payload = client.get(f"{V1}/note-tags")
    assert payload.status_code == 200
    body = payload.json()
    assert isinstance(body, list)  # API.md documents the bare array for this route
    assert {row["tag"]: row["count"] for row in body} == {"postgres": 2, "security": 1}
    assert body[0]["count"] >= body[-1]["count"]


def test_note_tags_start_empty_and_follow_tags(client: TestClient) -> None:
    assert client.get(f"{V1}/note-tags").json() == []
    note = make_note(client, "Tagged once", tags=["ai"])
    client.patch(f"{V1}/notes/{note['id']}", json={"tags": ["ai", "ml"]})
    assert {row["tag"] for row in client.get(f"{V1}/note-tags").json()} == {"ai", "ml"}
    client.patch(f"{V1}/notes/{note['id']}", json={"tags": []})
    # the tag rows stay (they are shared vocabulary) but nothing counts them
    assert {row["tag"]: row["count"] for row in client.get(f"{V1}/note-tags").json()} == {
        "ai": 0,
        "ml": 0,
    }

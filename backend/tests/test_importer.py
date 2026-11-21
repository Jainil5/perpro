"""The tolerant importer: messy LLM output in, validated tasks out."""

from __future__ import annotations

import datetime as dt
import json

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Task
from app.services import importer
from tests.helpers import make_project, make_task

#: the literal payload from the brief, trailing commas and all
LLM_PAYLOAD = (
    '{"tasks":[{"title":"Enforce user_limit","category":"RLS",'
    '"notes":"Gate free tier to 3 orders per user via user_limit in tenants.config. '
    'Read at API boundary, not in policy.\\n\\nAcceptance:\\n'
    '- Free tier blocked on 4th order\\n- Upgrade prompt\\n\\n",'
    '"priority":"High","due_date":"2026-11-01",},'
    '{"title":"Test tenant isolation","category":"Verification",'
    '"notes":"Verify across 3 tenants.\\n\\nAcceptance:\\n'
    '- 3 tenants created\\n- Cross-tenant reads blocked",'
    '"priority":"Medium","due_date":"2026-11-15"}],}'
)


# ------------------------------------------------------------------------ parsing


def test_the_reference_payload_parses_into_two_tasks() -> None:
    items, warnings = importer.parse_raw(LLM_PAYLOAD)
    assert len(items) == 2
    assert [item["title"] for item in items] == ["Enforce user_limit", "Test tenant isolation"]
    assert any("trailing comma" in note for note in warnings)


def test_json_without_a_wrapper_object_is_accepted() -> None:
    items, warnings = importer.parse_raw('[{"title": "One"}, {"title": "Two"}]')
    assert [item["title"] for item in items] == ["One", "Two"]
    assert warnings == []


@pytest.mark.parametrize("key", ["tasks", "items", "todos"])
def test_the_documented_wrapper_keys_are_unwrapped(key: str) -> None:
    items, _ = importer.parse_raw(json.dumps({key: [{"title": "One"}]}))
    assert items == [{"title": "One"}]


def test_a_single_object_counts_as_one_task() -> None:
    items, _ = importer.parse_raw('{"title": "Solo"}')
    assert items == [{"title": "Solo"}]


def test_empty_list_warns_but_is_not_an_error() -> None:
    items, warnings = importer.parse_raw('{"tasks": []}')
    assert items == []
    assert any("empty task list" in note for note in warnings)


def test_markdown_fences_and_prose_are_stripped() -> None:
    raw = (
        "Sure, here are the tasks:\n"
        "```json\n"
        '[{"title": "Fenced", "priority": "High"}]\n'
        "```\n"
        "Let me know if you want more detail."
    )
    items, _ = importer.parse_raw(raw)
    assert [item["title"] for item in items] == ["Fenced"]


def test_prose_around_bare_json_is_ignored() -> None:
    items, _ = importer.parse_raw('Of course! {"title": "Inline"} - enjoy!')
    assert items == [{"title": "Inline"}]


def test_brackets_inside_strings_do_not_confuse_the_span_scan() -> None:
    raw = 'thinking... {"title": "a } balanced [brace]"} trailing words'
    items, _ = importer.parse_raw(raw)
    assert items == [{"title": "a } balanced [brace]"}]


def test_single_quotes_and_bare_keys_are_repaired() -> None:
    items, warnings = importer.parse_raw("[{title: 'Ship it', priority: 'high'}]")
    assert items == [{"title": "Ship it", "priority": "high"}]
    assert any("single-quoted" in note for note in warnings)


def test_line_comments_inside_the_payload_are_stripped() -> None:
    raw = '[\n  // suggested by mymodel\n  {"title": "Commented"}\n]'
    items, warnings = importer.parse_raw(raw)
    assert [item["title"] for item in items] == ["Commented"]
    assert any("comments" in note for note in warnings)


def test_prose_before_a_json_array_needs_no_repair() -> None:
    items, warnings = importer.parse_raw('// header\n[{"title": "Body"}]\n// footer')
    assert [item["title"] for item in items] == ["Body"]
    assert warnings == []


@pytest.mark.parametrize("raw", ["", "   ", "no json anywhere", '[{"title": unclosed', '"bare string"'])
def test_unparsable_input_is_a_422(raw: object) -> None:
    with pytest.raises(ApiError) as excinfo:
        importer.parse_raw(raw)  # type: ignore[arg-type]
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "validation_error"
    assert excinfo.value.details[0]["field"] == "raw"


def test_a_json_scalar_without_any_brackets_is_rejected() -> None:
    with pytest.raises(ApiError) as excinfo:
        importer.parse_raw("42")
    assert excinfo.value.status_code == 422


# ----------------------------------------------------------------------- coercion


def test_alias_keys_map_onto_the_canonical_fields() -> None:
    payload, reason, warnings = importer.normalize_item(
        {
            "name": "Renamed task",
            "desc": "details live here",
            "deadline": "2026-12-01",
            "done": True,
            "labels": ["#urgent", "ops"],
            "estimate": "45",
            "repeat": "monthly",
        },
        0,
    )
    assert reason is None and warnings == []
    assert payload == {
        "title": "Renamed task",
        "description": "details live here",
        "due_date": dt.date(2026, 12, 1),
        "status": "done",
        "recurrence": "monthly",
        "estimated_minutes": 45,
        "tags": ["urgent", "ops"],
    }
    assert "priority" not in payload  # absent keys are simply not set


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, "done"),
        ("yes", "done"),
        ("DONE", "done"),
        ("finished", "done"),
        (False, "todo"),
        ("no", "todo"),
        ("0", "todo"),
        ("pending", "todo"),
        ("blocked", "blocked"),
        ("weird", "todo"),
    ],
)
def test_status_and_done_flags_normalise_to_the_enum(value: object, expected: str) -> None:
    payload, reason, _ = importer.normalize_item({"title": "t", "done": value}, 0)
    assert reason is None
    assert payload["status"] == expected


def test_category_becomes_a_tag_and_priority_is_cased_down() -> None:
    payload, reason, warnings = importer.normalize_item(
        {"title": "t", "category": "RLS", "priority": "High"}, 0
    )
    assert (reason, warnings) == (None, [])
    assert payload["tags"] == ["RLS"]
    assert payload["priority"] == "high"


def test_unknown_choice_values_warn_and_fall_back_to_the_default() -> None:
    payload, reason, warnings = importer.normalize_item(
        {"title": "t", "priority": "blazing", "recurrence": "weekly-ish", "status": "shipped"}, 0
    )
    assert reason is None
    assert payload["priority"] == "medium"
    assert payload["recurrence"] == "none"
    assert payload["status"] == "todo"
    assert len(warnings) == 3


@pytest.mark.parametrize("recurrence", ["never", "once", "no", "NONE"])
def test_never_recurs_words_map_to_none(recurrence: str) -> None:
    payload, _, warnings = importer.normalize_item(
        {"title": "t", "recurrence": recurrence}, 0
    )
    assert payload["recurrence"] == "none"
    assert warnings == []


def test_bad_dates_numbers_and_ids_are_dropped_with_warnings() -> None:
    payload, reason, warnings = importer.normalize_item(
        {
            "id": "client-side-id",
            "title": "t",
            "due_date": "sometime in november",
            "estimated_minutes": "abc",
            "actual_minutes": -30,
        },
        3,
    )
    assert reason is None
    assert "due_date" not in payload
    assert "estimated_minutes" not in payload
    assert "actual_minutes" not in payload
    assert len(warnings) == 4
    assert any("server assigns ids" in note for note in warnings)
    assert all("task 3" in note for note in warnings)


@pytest.mark.parametrize(
    ("item", "reason"),
    [
        ("just a string", None),
        (42, None),
        (None, None),
        ({"title": "   "}, "missing title"),
        ({"notes": "no title at all"}, "missing title"),
        ({"title": "x" * 501}, None),
    ],
)
def test_items_that_cannot_become_a_task_are_rejected(item: object, reason: str | None) -> None:
    payload, message, _ = importer.normalize_item(item, 0)
    assert payload is None
    assert message is not None
    if reason:
        assert reason in message


def test_a_long_or_list_shaped_title_still_works() -> None:
    payload, reason, _ = importer.normalize_item({"title": ["Line one", "Line two"]}, 0)
    assert reason is None
    assert payload["title"] == "Line one\nLine two"


# ------------------------------------------------------------------------- apply


def test_import_creates_the_two_tasks_from_the_reference_payload(
    session: Session, workspace_id: str
) -> None:
    result = importer.import_tasks(session, workspace_id, raw=LLM_PAYLOAD)
    assert result["created"] == 2
    assert result["duplicates"] == 0
    assert result["rejected"] == []

    rows = {task.title: task for task in session.scalars(sa.select(Task))}
    assert set(rows) == {"Enforce user_limit", "Test tenant isolation"}
    enforce = rows["Enforce user_limit"]
    assert enforce.priority == "high"
    assert enforce.due_date == dt.date(2026, 11, 1)
    assert enforce.recurrence == "none"
    assert [tag.name for tag in enforce.tags] == ["RLS"]
    assert "Acceptance:" in (enforce.notes or "")
    assert "\n\n" in (enforce.notes or "")  # the multi-line body survived
    assert rows["Test tenant isolation"].priority == "medium"


def test_importing_the_same_payload_twice_reports_duplicates(
    session: Session, workspace_id: str
) -> None:
    importer.import_tasks(session, workspace_id, raw=LLM_PAYLOAD)
    again = importer.import_tasks(session, workspace_id, raw=LLM_PAYLOAD)
    assert again["created"] == 0
    assert again["duplicates"] == 2
    assert any("already exists" in note for note in again["warnings"])

    forced = importer.import_tasks(session, workspace_id, raw=LLM_PAYLOAD, allow_duplicates=True)
    assert forced["created"] == 2
    assert forced["duplicates"] == 0


def test_duplicate_titles_inside_one_payload_are_rejected(session: Session, workspace_id: str) -> None:
    result = importer.import_tasks(
        session,
        workspace_id,
        raw='[{"title": "Only once"}, {"title": "only once "}]',
    )
    assert result["created"] == 1
    assert len(result["rejected"]) == 1
    assert result["rejected"][0]["index"] == 1
    assert "duplicate title in payload" in result["rejected"][0]["reason"]


def test_matching_is_on_the_trimmed_lowercased_title(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "  Weekly Sync  ")
    result = importer.import_tasks(session, workspace_id, raw='[{"title": "weekly sync"}]')
    assert (result["created"], result["duplicates"]) == (0, 1)


def test_bad_items_are_reported_instead_of_failing_the_import(
    session: Session, workspace_id: str
) -> None:
    result = importer.import_tasks(
        session,
        workspace_id,
        raw='[{"title": "good"}, "a bare string", {"notes": "titleless"}]',
    )
    assert result["created"] == 1
    assert [item["index"] for item in result["rejected"]] == [1, 2]
    assert result["rejected"][1]["reason"] == "missing title"
    assert result["rejected"][0]["title"] is None


def test_dangling_parent_is_an_item_reject_not_a_crash(
    session: Session, workspace_id: str
) -> None:
    result = importer.import_tasks(
        session,
        workspace_id,
        raw='[{"title": "child", "parent_task_id": "00000000-0000-0000-0000-000000000000"}]',
    )
    assert result["created"] == 0
    assert result["rejected"][0]["reason"]


def test_import_into_a_project_only_compares_inside_that_project(
    session: Session, workspace_id: str
) -> None:
    first = make_project(session, workspace_id, "Alpha")
    make_task(session, workspace_id, "Shared title", project_id=first["id"])
    second = make_project(session, workspace_id, "Beta")

    payload = '[{"title": "Shared title"}]'
    inside_first = importer.import_tasks(
        session, workspace_id, raw=payload, project_id=first["id"]
    )
    assert (inside_first["created"], inside_first["duplicates"]) == (0, 1)

    inside_second = importer.import_tasks(
        session, workspace_id, raw=payload, project_id=second["id"]
    )
    assert inside_second["created"] == 1
    moved = list(
        session.scalars(sa.select(Task).where(Task.title == "Shared title"))
    )
    assert len(moved) == 2
    assert {task.project_id for task in moved} == {first["id"], second["id"]}


def test_import_with_an_unknown_project_id_is_a_422(session: Session, workspace_id: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        importer.import_tasks(
            session, workspace_id, raw='[{"title": "t"}]', project_id="nope"
        )
    assert excinfo.value.status_code == 422
    assert excinfo.value.details[0]["field"] == "project_id"


def test_imported_tasks_do_not_become_demo_rows(session: Session, workspace_id: str) -> None:
    importer.import_tasks(session, workspace_id, raw='[{"title": "Imported"}]')
    task = session.scalars(sa.select(Task).where(Task.title == "Imported")).one()
    assert task.source == "user"

"""Request normalisation and the JSON formats promised by API.md."""

from __future__ import annotations

import datetime as dt

import pytest
from pydantic import ValidationError

from app.core.utils import to_utc_iso
from app.schemas.common import clean_tags, parse_date, parse_datetime, require_choice
from app.schemas.contacts import ContactCreate
from app.schemas.notes import NoteCreate, RelationIn
from app.schemas.projects import MilestoneCreate, ProjectCreate, ProjectUpdate
from app.schemas.signals import ReminderCreate
from app.schemas.tasks import TaskBulkRequest, TaskCreate, TaskOut, TaskUpdate

DAY = dt.date(2026, 11, 21)


def task_out_payload(**overrides: object) -> dict:
    base = {
        "id": "00000000-0000-0000-0000-000000000000",
        "title": "Write the spec",
        "status": "todo",
        "priority": "medium",
        "recurrence": "none",
        "created_at": dt.datetime(2026, 11, 1, 8, 30),
        "updated_at": dt.datetime(2026, 11, 20, 8, 30, tzinfo=dt.timezone.utc),
    }
    base.update(overrides)
    return base


# ------------------------------------------------------------------ normalisation


def test_choice_values_are_normalised_not_rejected() -> None:
    created = TaskCreate.model_validate(
        {"title": "Ship", "priority": "High", "status": "In Progress", "recurrence": "Fortnightly"}
    )
    assert created.priority == "high"
    assert created.status == "in_progress"
    assert created.recurrence == "fortnightly"


def test_choice_rejects_unknown_values() -> None:
    with pytest.raises(ValidationError) as excinfo:
        TaskCreate.model_validate({"title": "Ship", "priority": "asap"})
    assert "priority must be one of" in str(excinfo.value)
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "Ship", "recurrence": "weekdays"})


def test_non_string_choices_are_rejected_by_the_type_check() -> None:
    assert require_choice(42, "priority", "priority") == 42  # pass-through for the type layer
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "Ship", "priority": 42})


@pytest.mark.parametrize("blank", ["", None])
def test_blank_enums_count_as_absent(blank: object) -> None:
    created = TaskCreate.model_validate({"title": "Ship", "priority": blank})
    assert created.priority is None


def test_required_strings_are_trimmed_and_blanks_rejected() -> None:
    assert TaskCreate.model_validate({"title": "  spaced  "}).title == "spaced"
    for blank in ("", "   ", None):
        with pytest.raises(ValidationError):
            TaskCreate.model_validate({"title": blank})


def test_unknown_request_keys_are_a_validation_error() -> None:
    with pytest.raises(ValidationError) as excinfo:
        TaskCreate.model_validate({"title": "Ship", "colour": "blue"})
    assert "colour" in str(excinfo.value)
    assert "Extra inputs are not permitted" in str(excinfo.value)


# ------------------------------------------------------------------------- dates


@pytest.mark.parametrize("good", ["2026-11-01", " 2026-11-01 "])
def test_dates_accept_the_documented_format(good: str) -> None:
    assert TaskCreate.model_validate({"title": "t", "due_date": good}).due_date == dt.date(
        2026, 11, 1
    )


@pytest.mark.parametrize("bad", ["2026-11-1", "01/11/2026", "Nov 2026", "2026-13-01", "yesterday"])
def test_dates_are_strict(bad: str) -> None:
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "t", "due_date": bad})


@pytest.mark.parametrize("blank", ["", None])
def test_blank_dates_clear_the_field(blank: object) -> None:
    assert TaskCreate.model_validate({"title": "t", "due_date": blank}).due_date is None


def test_milestones_require_a_date() -> None:
    with pytest.raises(ValidationError):
        MilestoneCreate.model_validate({"project_id": "p", "title": "Ship"})
    assert MilestoneCreate.model_validate(
        {"project_id": "p", "title": "Ship", "date": "2026-12-01"}
    ).date == dt.date(2026, 12, 1)


def test_reminders_require_an_iso_datetime() -> None:
    created = ReminderCreate.model_validate({"title": "Call", "due_at": "2026-11-25T09:30:00Z"})
    assert created.due_at == dt.datetime(2026, 11, 25, 9, 30, tzinfo=dt.timezone.utc)
    with pytest.raises(ValidationError):
        ReminderCreate.model_validate({"title": "Call"})


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-11-01T10:00:00Z", dt.datetime(2026, 11, 1, 10, tzinfo=dt.timezone.utc)),
        ("2026-11-01T10:00:00", dt.datetime(2026, 11, 1, 10, tzinfo=dt.timezone.utc)),
        ("2026-11-01T15:30:00+05:30", dt.datetime(2026, 11, 1, 10, tzinfo=dt.timezone.utc)),
        ("2026-11-01", dt.datetime(2026, 11, 1, 0, 0, tzinfo=dt.timezone.utc)),
    ],
)
def test_parse_datetime_normalises_to_utc(raw: str, expected: dt.datetime) -> None:
    assert parse_datetime(raw) == expected


def test_parse_datetime_rejects_junk() -> None:
    for bad in ("not a date", "2026-11-01T99:00:00Z"):
        with pytest.raises(ValueError):
            parse_datetime(bad)
    assert parse_datetime(None) is None
    assert parse_datetime("") is None


def test_parse_date_passes_objects_through() -> None:
    assert parse_date(DAY) is DAY
    assert parse_date(dt.datetime(2026, 11, 21, 10)) == dt.datetime(2026, 11, 21, 10)
    with pytest.raises(ValueError):
        parse_date(12345)


# -------------------------------------------------------------------------- tags


def test_clean_tags_dedupes_and_strips_hashes() -> None:
    assert clean_tags(["#Inbox", " inbox ", "urgent", "", None]) == ["Inbox", "urgent"]
    assert clean_tags("a, b; c") == ["a", "b", "c"]
    assert clean_tags(None) == []
    with pytest.raises(ValueError):
        clean_tags(["nested", {"oops": 1}])


def test_note_tags_are_cleaned_on_the_way_in() -> None:
    note = NoteCreate.model_validate({"title": "T", "tags": ["#rust", "Rust", " db "]})
    assert note.tags == ["rust", "db"]


# ------------------------------------------------------------------------- misc


def test_require_choice_handles_separators() -> None:
    assert require_choice("In-Progress", "project.status", "status") == "in_progress"
    assert require_choice(None, "priority", "priority") is None
    assert require_choice("", "priority", "priority") is None


def test_null_and_blank_enums_are_both_absent_in_bodies() -> None:
    """``{"priority": null}`` and ``{"priority": ""}`` both mean "not provided"."""
    for value in (None, "", "   "):
        assert TaskCreate.model_validate({"title": "Ship", "priority": value}).priority is None
        assert TaskUpdate.model_validate({"priority": value}).priority is None
    with pytest.raises(ValidationError):
        TaskUpdate.model_validate({"status": "shipped"})


def test_numeric_bounds_are_enforced() -> None:
    with pytest.raises(ValidationError):
        TaskCreate.model_validate({"title": "t", "estimated_minutes": -5})
    with pytest.raises(ValidationError):
        ProjectCreate.model_validate({"name": "p", "manual_progress": 101})
    assert TaskCreate.model_validate({"title": "t", "estimated_minutes": 90}).estimated_minutes == 90


def test_update_models_distinguish_absent_from_null() -> None:
    untouched = TaskUpdate.model_validate({})
    assert untouched.due_date is None and "due_date" not in untouched.model_dump(exclude_unset=True)
    cleared = TaskUpdate.model_validate({"due_date": None})
    assert "due_date" in cleared.model_dump(exclude_unset=True)
    with pytest.raises(ValidationError):
        TaskUpdate.model_validate({"title": "   "})


def test_blank_contact_and_relation_inputs_are_rejected() -> None:
    with pytest.raises(ValidationError):
        ContactCreate.model_validate({"name": ""})
    with pytest.raises(ValidationError):
        RelationIn.model_validate({"target_type": "task", "target_id": "  "})
    with pytest.raises(ValidationError):
        RelationIn.model_validate({"target_type": "spaceship", "target_id": "x"})


def test_bulk_request_normalises_ids_and_values() -> None:
    request = TaskBulkRequest.model_validate(
        {"ids": ["a", "b", " a "], "action": "set_priority", "value": "HIGH"}
    )
    assert request.ids == ["a", "b"]
    assert request.value == "high"
    with pytest.raises(ValidationError):
        TaskBulkRequest.model_validate({"ids": [], "action": "complete"})
    with pytest.raises(ValidationError):
        TaskBulkRequest.model_validate({"ids": ["a", ""], "action": "complete"})
    with pytest.raises(ValidationError):
        TaskBulkRequest.model_validate({"ids": ["a"], "action": "teleport"})


# -------------------------------------------------------------------- json shapes


def test_timestamps_serialise_with_a_z_suffix() -> None:
    assert to_utc_iso(dt.datetime(2026, 11, 21, 4, 5, 6)) == "2026-11-21T04:05:06Z"
    assert to_utc_iso(None) is None
    dumped = TaskOut.model_validate(task_out_payload()).model_dump(mode="json")
    assert dumped["created_at"] == "2026-11-01T08:30:00Z"
    assert dumped["updated_at"] == "2026-11-20T08:30:00Z"
    assert dumped["due_date"] is None
    assert TaskOut.model_validate(task_out_payload(due_date=DAY)).model_dump(mode="json")[
        "due_date"
    ] == "2026-11-21"


def test_optional_response_fields_have_documented_defaults() -> None:
    dumped = TaskOut.model_validate(task_out_payload()).model_dump(mode="json")
    assert dumped["tags"] == []
    assert dumped["position"] == 0
    assert dumped["is_overdue"] is False
    assert dumped["recurrence"] == "none"
    assert dumped["completed_at"] is None


def test_project_update_clears_dates_with_null() -> None:
    patch = ProjectUpdate.model_validate({"target_date": None, "next_action": None})
    assert patch.model_dump(exclude_unset=True) == {"target_date": None, "next_action": None}

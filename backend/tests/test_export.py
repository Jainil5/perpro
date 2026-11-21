"""``GET /export`` / ``app.cli export``: a column-for-column JSON backup."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

from sqlalchemy.orm import Session

from app.core import json as zjson
from app.core.utils import new_id
from app.models import Task
from app.services import activity, context, demo
from app.services import projects as projects_service
from app.services.export import TABLE_ORDER, export_payload
from tests.helpers import make_project, make_task

DAY = dt.date(2026, 11, 21)

#: every Phase 1 table, dumped in this order
EXPECTED_TABLES = (
    "workspaces",
    "users",
    "workspace_members",
    "projects",
    "milestones",
    "tasks",
    "task_dependencies",
    "tags",
    "task_tags",
    "notes",
    "note_relations",
    "note_tags",
    "companies",
    "contacts",
    "contact_tags",
    "goals",
    "reminders",
    "notifications",
    "activity_logs",
)


def tables(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return payload["tables"]


# ------------------------------------------------------------------------- shape


def test_the_order_is_a_documented_contract() -> None:
    assert TABLE_ORDER == EXPECTED_TABLES
    assert len(TABLE_ORDER) == 19


def test_payload_has_exactly_the_documented_top_level_keys(
    session: Session, workspace_id: str
) -> None:
    payload = export_payload(session, workspace_id)
    assert set(payload) == {"exported_at", "workspace", "tables"}
    assert set(tables(payload)) == set(EXPECTED_TABLES)


def test_an_empty_database_still_dumps_every_table(
    session: Session, workspace_id: str
) -> None:
    payload = export_payload(session, workspace_id)
    assert list(tables(payload)) == list(EXPECTED_TABLES)
    assert tables(payload)["tasks"] == []
    assert tables(payload)["milestones"] == []


def test_the_workspace_block_describes_the_active_workspace(
    session: Session, workspace_id: str
) -> None:
    payload = export_payload(session, workspace_id)
    workspace = payload["workspace"]
    assert workspace["id"] == workspace_id
    assert set(workspace) == {"id", "name", "slug", "timezone", "currency", "created_at"}
    assert workspace["timezone"] == "Asia/Kolkata"
    assert workspace["currency"] == "INR"


def test_timestamps_are_utc_z_and_dates_are_plain(
    session: Session, workspace_id: str
) -> None:
    project = make_project(session, workspace_id, "Reported")
    make_task(session, workspace_id, "Write it", project_id=project["id"], due_date=DAY)
    session.flush()
    payload = export_payload(session, workspace_id)

    exported = payload["exported_at"]
    assert exported.endswith("Z") and "+00:00" not in exported
    row = tables(payload)["tasks"][0]
    assert row["due_date"] == "2026-11-21"
    assert row["created_at"].endswith("Z")
    assert row["completed_at"] is None
    assert payload["workspace"]["created_at"].endswith("Z")


def test_rows_are_stored_columns_not_api_payloads(
    session: Session, workspace_id: str
) -> None:
    """The dump is a backup: raw columns, including ones the API never exposes."""
    project = make_project(session, workspace_id, "Raw", description="some text")
    make_task(session, workspace_id, "A task", project_id=project["id"], notes="notes text")
    session.flush()
    task = tables(export_payload(session, workspace_id))["tasks"][0]
    assert task["workspace_id"] == workspace_id
    assert task["project_id"] == project["id"]
    assert task["notes"] == "notes text"
    assert task["source"] == "user"
    assert "progress" not in task  # derived, so never stored
    dumped_project = tables(export_payload(session, workspace_id))["projects"][0]
    assert dumped_project["description"] == "some text"


def test_json_columns_survive_as_objects(session: Session, workspace_id: str) -> None:
    activity.record(
        session,
        workspace_id=workspace_id,
        verb="updated",
        entity_type="task",
        entity_id="00000000-0000-4000-8000-000000000001",
        entity_title="Something",
        payload={"status": "in_progress", "count": 2},
    )
    session.flush()
    row = tables(export_payload(session, workspace_id))["activity_logs"][0]
    assert row["payload"] == {"status": "in_progress", "count": 2}


def test_enum_columns_are_dumped_as_their_values(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Urgent", priority="urgent", status="blocked")
    session.flush()
    row = tables(export_payload(session, workspace_id))["tasks"][0]
    assert row["priority"] == "urgent"
    assert row["status"] == "blocked"


# ----------------------------------------------------------------------- scoping


def test_rows_from_another_workspace_are_absent(session: Session, workspace_id: str) -> None:
    from tests.helpers import other_workspace

    make_task(session, workspace_id, "Mine")
    foreign = other_workspace(session)
    session.add(Task(id=new_id(), workspace_id=foreign, title="Theirs", status="todo"))
    make_project(session, foreign, "Their project")
    session.flush()

    dumped = tables(export_payload(session, workspace_id))
    assert [row["title"] for row in dumped["tasks"]] == ["Mine"]
    assert [row["name"] for row in dumped["projects"]] == []
    assert [row["id"] for row in dumped["workspaces"]] == [workspace_id]


def test_the_dump_is_deterministic(session: Session, workspace_id: str) -> None:
    for index in range(4):
        make_task(session, workspace_id, f"Task {index}")
    session.flush()
    first = tables(export_payload(session, workspace_id))["tasks"]
    second = tables(export_payload(session, workspace_id))["tasks"]
    assert first == second
    # stored rows come back ordered by (created_at, id), not by insertion order
    keys = [(row["created_at"], row["id"]) for row in first]
    assert keys == sorted(keys)


# -------------------------------------------------------------------- round-trip


def test_the_dump_round_trips_through_the_shared_encoder(
    session: Session, workspace_id: str
) -> None:
    demo.seed(session, workspace_id, today=DAY)
    payload = export_payload(session, workspace_id)
    text = zjson.dumps(payload)
    assert "+00:00" not in text
    restored = json.loads(text)
    assert restored == json.loads(zjson.dumps(payload))
    assert set(restored["tables"]) == set(EXPECTED_TABLES)
    assert restored["tables"]["tasks"] == payload["tables"]["tasks"]


def test_a_dumped_file_reloads_into_the_same_counts(
    tmp_path, session: Session, workspace_id: str
) -> None:
    """Write -> read -> compare: what the CLI export produces is a usable backup."""
    demo.seed(session, workspace_id, today=DAY)
    payload = export_payload(session, workspace_id)
    path = tmp_path / "backup.json"
    path.write_text(zjson.dumps(payload), encoding="utf-8")

    restored = json.loads(path.read_text(encoding="utf-8"))
    assert restored["tables"]["projects"] == payload["tables"]["projects"]
    assert len(restored["tables"]["tasks"]) == len(payload["tables"]["tasks"])
    ids = {row["id"] for row in restored["tables"]["projects"]}
    assert len(ids) == len(restored["tables"]["projects"])


def test_the_dump_covers_the_seeded_dataset(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    dumped = tables(export_payload(session, workspace_id))
    assert len(dumped["projects"]) == 8
    assert len(dumped["tasks"]) == 49
    assert len(dumped["notes"]) == 12
    assert len(dumped["tags"]) == 21
    assert dumped["notifications"] and dumped["activity_logs"]
    assert len(dumped["task_tags"]) > 0
    # tenancy: the owner row is created on first touch, like every other read
    assert dumped["users"] == [] and dumped["workspace_members"] == []
    context.resolve_owner(session, context.resolve_workspace(session))
    session.flush()
    after = tables(export_payload(session, workspace_id))
    assert len(after["users"]) == 1
    assert len(after["workspace_members"]) == 1
    assert after["workspace_members"][0]["role"] == "owner"
    assert after["workspace_members"][0]["workspace_id"] == workspace_id


def test_exported_at_is_the_only_live_value(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    first = export_payload(session, workspace_id)
    second = export_payload(session, workspace_id)
    del first["exported_at"], second["exported_at"]
    assert first == second


def test_association_rows_follow_their_parent(
    session: Session, workspace_id: str
) -> None:
    """Tags are shared vocabulary; the *link* is what belongs to a workspace."""
    from tests.helpers import other_workspace

    mine = make_task(session, workspace_id, "Tagged here", tags=["alpha"])
    foreign = other_workspace(session, slug="foreign-tags")
    make_task(session, foreign, "Tagged there", tags=["alpha"])
    session.flush()

    dumped = tables(export_payload(session, workspace_id))
    assert [row["title"] for row in dumped["tasks"]] == ["Tagged here"]
    assert len(dumped["task_tags"]) == 1
    assert dumped["task_tags"][0]["task_id"] == mine["id"]
    assert {row["name"] for row in dumped["tags"]} == {"alpha"}


def test_notifications_are_part_of_the_dump(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    rows = tables(export_payload(session, workspace_id))["notifications"]
    assert rows
    assert {"id", "workspace_id", "kind", "severity", "read_at", "created_at"} <= set(rows[0])
    assert {row["kind"] for row in rows} <= {
        "task_overdue", "task_due", "milestone", "reminder", "project_stalled", "system"
    }


def test_writing_a_new_row_changes_only_its_tables(session: Session, workspace_id: str) -> None:
    before = tables(export_payload(session, workspace_id))
    make_project(session, workspace_id, "Added later")
    session.flush()
    after = tables(export_payload(session, workspace_id))
    changed = {name for name in EXPECTED_TABLES if before[name] != after[name]}
    assert changed == {"projects", "activity_logs"}
    assert len(after["projects"]) == len(before["projects"]) + 1


def test_deleting_a_project_removes_its_rows_from_the_dump(
    session: Session, workspace_id: str
) -> None:
    project = make_project(session, workspace_id, "Temporary")
    make_task(session, workspace_id, "Kept", project_id=project["id"])
    session.flush()
    projects_service.delete_project(session, workspace_id, project["id"])
    dumped = tables(export_payload(session, workspace_id))
    assert dumped["projects"] == []
    # tasks survive a project delete with the link cleared (API.md)
    assert dumped["tasks"][0]["project_id"] is None

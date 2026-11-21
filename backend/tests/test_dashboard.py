"""``GET /dashboard``: the block shapes and the deterministic insight rules."""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy.orm import Session

from app.services import dashboard
from tests.helpers import (
    backdate_completion,
    set_snooze,
    backdate_task,
    make_contact,
    make_goal,
    make_milestone,
    make_note,
    make_project,
    make_reminder,
    make_task,
)

DAY = dt.date(2026, 11, 21)
TOP_LEVEL = {
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


def kinds(payload_insights: list[dict[str, Any]]) -> list[str]:
    return [insight["kind"] for insight in payload_insights]


# ------------------------------------------------------------------------- shape


def test_empty_dashboard_still_has_every_documented_block(session: Session, workspace_id: str) -> None:
    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert set(payload) == TOP_LEVEL
    assert payload["today"] == DAY
    assert set(payload["tasks"]) == {
        "due_today",
        "overdue",
        "upcoming",
        "completed_this_week",
        "open",
    }
    assert set(payload["projects"]) == {"active", "deadline_soon"}
    assert set(payload["people"]) == {"new_contacts_30d"}
    assert set(payload["notes"]) == {"recent"}
    assert set(payload["milestones"]) == {"upcoming"}
    assert set(payload["reminders"]) == {"due"}
    assert set(payload["notifications"]) == {"unread", "items"}
    assert payload["activity"] == []
    assert payload["insights"] == []
    assert payload["tasks"]["open"] == 0
    assert payload["tasks"]["completed_this_week"] == 0


def test_task_blocks_split_on_the_injected_today(session: Session, workspace_id: str) -> None:
    yesterday = make_task(session, workspace_id, "Yesterday", due_date=DAY - dt.timedelta(days=1))
    today = make_task(session, workspace_id, "Today", due_date=DAY)
    next_week = make_task(session, workspace_id, "Next week", due_date=DAY + dt.timedelta(days=5))
    far_away = make_task(session, workspace_id, "Far", due_date=DAY + dt.timedelta(days=40))
    undated = make_task(session, workspace_id, "No date")
    make_task(session, workspace_id, "Recently done", status="done")

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    titles = {key: [task["title"] for task in payload["tasks"][key]] for key in ("due_today", "overdue", "upcoming")}
    assert titles == {
        "due_today": ["Today"],
        "overdue": ["Yesterday"],
        "upcoming": ["Next week"],
    }
    assert titles["upcoming"] != [far_away["title"], undated["title"]]
    assert payload["tasks"]["open"] == 5
    assert payload["tasks"]["completed_this_week"] == 1
    assert payload["tasks"]["overdue"][0]["is_overdue"] is True
    assert today["id"] != next_week["id"]


def test_completed_this_week_only_counts_recent_completions(
    session: Session, workspace_id: str
) -> None:
    fresh = make_task(session, workspace_id, "Fresh", status="done")
    old = make_task(session, workspace_id, "Old", status="done")
    backdate_completion(session, fresh["id"], dt.datetime(2026, 11, 18, 9, 0))
    backdate_completion(session, old["id"], dt.datetime(2026, 10, 1, 9, 0))

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert payload["tasks"]["completed_this_week"] == 1


def test_project_blocks_and_deadline_window(session: Session, workspace_id: str) -> None:
    active = make_project(session, workspace_id, "Active", status="in_progress")
    make_project(session, workspace_id, "Backlog", status="backlog")
    make_project(session, workspace_id, "Finished", status="completed")
    soon = make_project(
        session, workspace_id, "Due soon", status="planning", target_date=DAY + dt.timedelta(days=3)
    )
    make_project(session, workspace_id, "Later", status="planning", target_date=DAY + dt.timedelta(days=60))

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    # "active" means planning / in_progress / review, newest touch first
    assert {project["name"] for project in payload["projects"]["active"]} == {
        "Active",
        "Due soon",
        "Later",
    }
    assert not {"Backlog", "Finished"} & {project["name"] for project in payload["projects"]["active"]}
    deadline = payload["projects"]["deadline_soon"]
    assert [row["id"] for row in deadline] == [soon["id"]]
    assert deadline[0]["days_left"] == 3
    assert set(deadline[0]) == {"id", "name", "target_date", "days_left"}
    assert active["id"] in [project["id"] for project in payload["projects"]["active"]]


def test_milestone_note_and_activity_caps(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Launch")
    make_milestone(session, workspace_id, project["id"], "Inside", date=DAY + dt.timedelta(days=6))
    make_milestone(session, workspace_id, project["id"], "Outside", date=DAY + dt.timedelta(days=20))
    for index in range(7):
        make_note(session, workspace_id, f"Note {index}")
    for index in range(10):
        make_task(session, workspace_id, f"Log me {index}")

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert [row["title"] for row in payload["milestones"]["upcoming"]] == ["Inside"]
    assert len(payload["notes"]["recent"]) == 5
    assert len(payload["activity"]) == 8


def test_reminders_due_block_uses_the_snooze_override(session: Session, workspace_id: str) -> None:
    make_reminder(session, workspace_id, "Past", dt.datetime(2026, 11, 20, 8, 0))
    future = make_reminder(session, workspace_id, "Future", dt.datetime(2026, 12, 5, 8, 0))
    dragged = make_reminder(session, workspace_id, "Dragged back", dt.datetime(2026, 12, 20, 8, 0))
    set_snooze(session, dragged["id"], dt.datetime(2026, 11, 21, 7, 0))

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    titles = {row["title"] for row in payload["reminders"]["due"]}
    assert titles == {"Past", "Dragged back"}
    assert future["id"] not in {row["id"] for row in payload["reminders"]["due"]}


def test_people_and_notifications_blocks(session: Session, workspace_id: str) -> None:
    make_contact(session, workspace_id, "New this month")
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    from app.services import notifications

    notifications.refresh(session, workspace_id, today=DAY)

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert payload["people"]["new_contacts_30d"] == 1
    assert payload["notifications"]["unread"] >= 1
    assert len(payload["notifications"]["items"]) <= 5


# ---------------------------------------------------------------------- insights


def test_overdue_insight_clusters_by_project(session: Session, workspace_id: str) -> None:
    big = make_project(session, workspace_id, "Big project")
    for index in range(3):
        make_task(
            session, workspace_id, f"Late in big {index}", project_id=big["id"],
            due_date=DAY - dt.timedelta(days=1),
        )
    make_task(session, workspace_id, "Late alone", due_date=DAY - dt.timedelta(days=2))

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    listed = kinds(payload["insights"])
    assert listed[0] == "overdue"
    assert listed[1] == "overdue_cluster"
    first = payload["insights"][0]
    assert first["severity"] == "critical"
    assert first["text"] == "4 tasks are overdue"
    assert first["href"] == "/os/tasks?filter=overdue"
    assert first["entity_id"] is None
    cluster = payload["insights"][1]
    assert "3 tasks overdue in “Big project”" == cluster["text"]


def test_overdue_insights_on_an_empty_list(session: Session, workspace_id: str) -> None:
    assert dashboard.overdue_insights([]) == []


def test_stalled_past_target_empty_and_unlinked_rules(session: Session, workspace_id: str) -> None:
    stalled = make_project(session, workspace_id, "Stalled", status="in_progress")
    quiet = make_task(session, workspace_id, "Quiet task", project_id=stalled["id"])
    backdate_task(session, quiet["id"], dt.datetime(2026, 10, 20, 9, 0))

    late = make_project(
        session,
        workspace_id,
        "Past target",
        status="in_progress",
        target_date=DAY - dt.timedelta(days=4),
    )
    fresh = make_task(session, workspace_id, "Open task", project_id=late["id"])
    assert fresh["id"] != quiet["id"]

    make_project(session, workspace_id, "Empty nest", status="planning")
    make_note(session, workspace_id, "Orphan note")
    make_goal(
        session,
        workspace_id,
        "Learn Rust",
        target_date=DAY - dt.timedelta(days=10),
        progress=20,
    )

    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    listed = kinds(payload["insights"])
    assert "overdue" not in listed  # nothing is past its due date here
    assert "project_stalled" in listed
    assert "past_target" in listed
    assert "empty_project" in listed
    assert "unlinked_note" in listed
    assert "goal_past_due" in listed

    stalled_text = next(row for row in payload["insights"] if row["kind"] == "project_stalled")
    assert "no task activity for" in stalled_text["text"]
    assert stalled_text["entity_id"] == stalled["id"]
    assert stalled_text["href"] == f"/os/projects/{stalled['id']}"

    goal = next(row for row in payload["insights"] if row["kind"] == "goal_past_due")
    assert "10 days past its target (20% done)" in goal["text"]
    assert goal["href"] == "/os/goals"

    note = next(row for row in payload["insights"] if row["kind"] == "unlinked_note")
    assert note["text"] == "Note “Orphan note” is linked to nothing"


def test_insights_are_deterministic_and_capped(session: Session, workspace_id: str) -> None:
    for index in range(5):
        project = make_project(session, workspace_id, f"Empty {index}", status="planning")
        assert project["id"]
    first = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    second = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert first["insights"] == second["insights"]
    empty = [row for row in first["insights"] if row["kind"] == "empty_project"]
    assert len(empty) == dashboard.INSIGHT_LIMIT_PER_RULE
    assert [row["text"] for row in empty] == sorted(row["text"] for row in empty)


def test_moving_today_moves_the_whole_dashboard(session: Session, workspace_id: str) -> None:
    task = make_task(session, workspace_id, "Due next Tuesday", due_date=DAY + dt.timedelta(days=1))
    assert task["due_date"] == DAY + dt.timedelta(days=1)

    on_the_day = dashboard.dashboard_payload(session, workspace_id, today=DAY + dt.timedelta(days=1))
    before = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    assert [row["title"] for row in on_the_day["tasks"]["due_today"]] == ["Due next Tuesday"]
    assert before["tasks"]["due_today"] == []
    assert on_the_day["insights"] == []

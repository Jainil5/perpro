"""Derived notifications: rules, idempotent refresh, resolve/reopen, read state."""

from __future__ import annotations

import datetime as dt

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Notification
from app.services import notifications
from tests.helpers import (
    backdate_task,
    make_contact,
    make_milestone,
    make_note,
    make_project,
    make_reminder,
    make_task,
)

DAY = dt.date(2026, 11, 21)


def rows(session: Session, workspace_id: str) -> list[Notification]:
    return list(
        session.scalars(
            sa.select(Notification)
            .where(Notification.workspace_id == workspace_id)
            .order_by(Notification.dedupe_key)
        )
    )


def keys(session: Session, workspace_id: str) -> set[str]:
    return {row.dedupe_key for row in rows(session, workspace_id)}


def by_key(session: Session, workspace_id: str, needle: str) -> Notification:
    found = [row for row in rows(session, workspace_id) if needle in row.dedupe_key]
    assert len(found) == 1, found
    return found[0]


# -------------------------------------------------------------------------- rules


def test_an_overdue_task_produces_one_critical_notification(
    session: Session, workspace_id: str
) -> None:
    make_task(session, workspace_id, "Late thing", due_date=DAY - dt.timedelta(days=2))
    rules = notifications.derive_rules(session, workspace_id, today=DAY)
    overdue = [rule for rule in rules if rule.kind == "task_overdue"]
    assert len(overdue) == 1
    assert overdue[0].severity == "critical"
    assert overdue[0].dedupe_key == f"task_overdue:{workspace_id}"
    assert "Late thing" in (overdue[0].body or "")
    assert overdue[0].href == "/os/tasks?filter=overdue"


def test_due_today_and_tomorrow_are_separate_rules(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Today", due_date=DAY)
    make_task(session, workspace_id, "Tomorrow", due_date=DAY + dt.timedelta(days=1))
    rules = {rule.dedupe_key: rule for rule in notifications.derive_rules(session, workspace_id, today=DAY)}
    assert rules[f"task_due:today:{workspace_id}"].severity == "warning"
    assert rules[f"task_due:tomorrow:{workspace_id}"].severity == "info"
    assert rules[f"task_due:today:{workspace_id}"].title == "1 task due today"


def test_many_overdue_tasks_still_report_once_with_a_tail(
    session: Session, workspace_id: str
) -> None:
    for index in range(5):
        make_task(session, workspace_id, f"Late {index}", due_date=DAY - dt.timedelta(days=1))
    rule = next(
        rule
        for rule in notifications.derive_rules(session, workspace_id, today=DAY)
        if rule.kind == "task_overdue"
    )
    assert rule.title == "5 tasks overdue"
    assert "and 2 more" in (rule.body or "")


def test_done_and_dropped_tasks_never_notify(session: Session, workspace_id: str) -> None:
    make_task(
        session, workspace_id, "Finished", status="done", due_date=DAY - dt.timedelta(days=3)
    )
    make_task(
        session, workspace_id, "Abandoned", status="dropped", due_date=DAY - dt.timedelta(days=3)
    )
    kinds = {rule.kind for rule in notifications.derive_rules(session, workspace_id, today=DAY)}
    assert "task_overdue" not in kinds


def test_milestone_window_and_severity(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Launch")
    near = make_milestone(
        session, workspace_id, project["id"], "Ship v1", date=DAY + dt.timedelta(days=2)
    )
    far = make_milestone(
        session, workspace_id, project["id"], "Retro", date=DAY + dt.timedelta(days=7)
    )
    out_of_window = make_milestone(
        session, workspace_id, project["id"], "Someday", date=DAY + dt.timedelta(days=30)
    )
    rules = {
        rule.dedupe_key: rule
        for rule in notifications.derive_rules(session, workspace_id, today=DAY)
    }

    assert rules[f"milestone:{near['id']}"].severity == "warning"
    assert rules[f"milestone:{far['id']}"].severity == "info"
    assert "in 7 days" in rules[f"milestone:{far['id']}"].title
    assert f"milestone:{out_of_window['id']}" not in rules


def test_due_reminders_notify_and_future_ones_do_not(
    session: Session, workspace_id: str
) -> None:
    past = make_reminder(session, workspace_id, "Call bank", dt.datetime(2026, 11, 20, 9, 0))
    later = make_reminder(session, workspace_id, "Renew domain", dt.datetime(2026, 12, 1, 9, 0))
    rules = {rule.dedupe_key: rule for rule in notifications.derive_rules(session, workspace_id, today=DAY)}
    assert rules[f"reminder:{past['id']}"].kind == "reminder"
    assert f"reminder:{later['id']}" not in rules


def test_stalled_projects_notify_once_with_quiet_days(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Silent work", status="in_progress")
    task = make_task(session, workspace_id, "Waiting", project_id=project["id"])
    backdate_task(session, task["id"], dt.datetime(2026, 10, 30, 9, 0))

    rule = next(
        rule
        for rule in notifications.derive_rules(session, workspace_id, today=DAY)
        if rule.kind == "project_stalled"
    )
    assert rule.entity_id == project["id"]
    assert "no task activity for" in rule.title
    assert "1 open task still waiting." in (rule.body or "")


def test_finished_projects_are_never_stalled(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Done deal", status="completed")
    task = make_task(session, workspace_id, "Was waiting", project_id=project["id"])
    backdate_task(session, task["id"], dt.datetime(2026, 10, 1, 9, 0))
    kinds = {rule.kind for rule in notifications.derive_rules(session, workspace_id, today=DAY)}
    assert "project_stalled" not in kinds


# ------------------------------------------------------------------------ refresh


def test_refresh_is_idempotent(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    first = notifications.refresh(session, workspace_id, today=DAY)
    assert first["created"] > 0
    second = notifications.refresh(session, workspace_id, today=DAY)
    assert second == {"created": 0, "resolved": 0}
    assert len(rows(session, workspace_id)) == first["created"]


def test_refresh_would_not_invent_notifications_for_clean_data(
    session: Session, workspace_id: str
) -> None:
    make_task(session, workspace_id, "No dates at all")
    assert notifications.refresh(session, workspace_id, today=DAY) == {"created": 0, "resolved": 0}
    assert rows(session, workspace_id) == []


def test_resolving_the_condition_resolves_the_notification(
    session: Session, workspace_id: str
) -> None:
    task = make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    overdue_row = by_key(session, workspace_id, "task_overdue")
    assert overdue_row.resolved_at is None

    from app.services import tasks as tasks_service

    tasks_service.complete_task(session, workspace_id, task["id"], today=DAY)
    result = notifications.refresh(session, workspace_id, today=DAY)
    assert result["created"] == 0
    assert result["resolved"] >= 1
    assert overdue_row.resolved_at is not None
    # the row stays (history), it just leaves the open list
    assert overdue_row.dedupe_key in keys(session, workspace_id)
    assert overdue_row.dedupe_key not in {
        item["dedupe_key"] for item in notifications.list_notifications(session, workspace_id)["items"]
    }


def test_a_returning_condition_reopens_the_row(session: Session, workspace_id: str) -> None:
    task = make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    row = by_key(session, workspace_id, "task_overdue")
    from app.services import tasks as tasks_service

    tasks_service.complete_task(session, workspace_id, task["id"], today=DAY)
    notifications.refresh(session, workspace_id, today=DAY)
    assert row.resolved_at is not None

    make_task(session, workspace_id, "Late again", due_date=DAY - dt.timedelta(days=1))
    result = notifications.refresh(session, workspace_id, today=DAY)
    assert result["created"] == 0  # the key already existed, it was reopened
    assert row.resolved_at is None
    assert row.read is False


def test_refresh_updates_the_text_of_an_existing_row(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "One late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    row = by_key(session, workspace_id, "task_overdue")
    assert row.title == "1 task overdue"

    make_task(session, workspace_id, "Two late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    assert row.title == "2 tasks overdue"
    assert len(rows(session, workspace_id)) == 1


# --------------------------------------------------------------------- the list


def test_list_is_ordered_by_severity_then_newest(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Launch")
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))  # critical
    make_task(session, workspace_id, "Today", due_date=DAY)  # warning
    make_reminder(session, workspace_id, "Call", dt.datetime(2026, 11, 21, 8, 0))  # info
    make_milestone(session, workspace_id, project["id"], "Soon", date=DAY)  # warning
    notifications.refresh(session, workspace_id, today=DAY)

    panel = notifications.list_notifications(session, workspace_id)
    severities = [item["severity"] for item in panel["items"]]
    assert severities == sorted(severities, key={"critical": 0, "warning": 1, "info": 2}.get)
    assert severities[0] == "critical"
    assert panel["unread"] == len(panel["items"])
    assert set(panel) == {"items", "unread"}


def test_list_filters_and_limit(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    make_reminder(session, workspace_id, "Call", dt.datetime(2026, 11, 21, 8, 0))
    notifications.refresh(session, workspace_id, today=DAY)

    only_reminders = notifications.list_notifications(session, workspace_id, kind="reminder")
    assert {item["kind"] for item in only_reminders["items"]} == {"reminder"}
    assert len(notifications.list_notifications(session, workspace_id, limit=1)["items"]) == 1
    unread = notifications.list_notifications(session, workspace_id, unread_only=True)
    assert unread["unread"] == len(unread["items"]) == 2


def test_resolved_rows_are_hidden(session: Session, workspace_id: str) -> None:
    task = make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    assert notifications.list_notifications(session, workspace_id)["items"]

    from app.services import tasks as tasks_service

    tasks_service.complete_task(session, workspace_id, task["id"], today=DAY)
    notifications.refresh(session, workspace_id, today=DAY)
    remaining = notifications.list_notifications(session, workspace_id)
    assert "task_overdue" not in {item["kind"] for item in remaining["items"]}


# ---------------------------------------------------------------- read / dismiss


def test_set_read_roundtrip(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    item = notifications.list_notifications(session, workspace_id)["items"][0]

    read = notifications.set_read(session, workspace_id, item["id"], read=True)
    assert read["read"] is True and read["read_at"] is not None
    assert notifications.list_notifications(session, workspace_id)["unread"] == 0

    unread = notifications.set_read(session, workspace_id, item["id"], read=False)
    assert unread["read"] is False and unread["read_at"] is None
    assert notifications.list_notifications(session, workspace_id)["unread"] == 1


def test_mark_all_read_is_idempotent(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    make_reminder(session, workspace_id, "Call", dt.datetime(2026, 11, 21, 8, 0))
    notifications.refresh(session, workspace_id, today=DAY)

    first = notifications.mark_all_read(session, workspace_id)
    assert first["updated"] == 2
    assert notifications.mark_all_read(session, workspace_id)["updated"] == 0
    assert notifications.list_notifications(session, workspace_id)["unread"] == 0


def test_dismiss_removes_the_row(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    item = notifications.list_notifications(session, workspace_id)["items"][0]

    result = notifications.delete_notification(session, workspace_id, item["id"])
    assert result == {"deleted": 1}
    assert notifications.list_notifications(session, workspace_id)["items"] == []


def test_unknown_or_foreign_notification_ids(session: Session, workspace_id: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        notifications.set_read(session, workspace_id, "missing-id", read=True)
    assert excinfo.value.status_code == 404
    with pytest.raises(ApiError) as other:
        notifications.delete_notification(session, workspace_id, "missing-id")
    assert other.value.status_code == 404


def test_notifications_from_another_workspace_are_invisible(
    session: Session, workspace_id: str
) -> None:
    make_task(session, workspace_id, "Late", due_date=DAY - dt.timedelta(days=1))
    notifications.refresh(session, workspace_id, today=DAY)
    assert notifications.list_notifications(session, "some-other-workspace")["items"] == []


def test_derived_rows_are_scoped_to_the_workspace_and_entity(
    session: Session, workspace_id: str
) -> None:
    project = make_project(session, workspace_id, "Launch")
    make_milestone(session, workspace_id, project["id"], "Ship", date=DAY)
    make_note(session, workspace_id, "Unrelated note")
    make_contact(session, workspace_id, "Nadia")
    notifications.refresh(session, workspace_id, today=DAY)
    milestone_row = by_key(session, workspace_id, "milestone:")
    assert milestone_row.entity_type == "milestone"
    assert milestone_row.href.startswith("/os/projects/")

"""The derived-numbers rules from API.md: progress, counts, overdue/due-today.

These are pure functions over rows, so the boundary cases are cheap to pin down.
"""

from __future__ import annotations

import datetime as dt

from app.services.stats import (
    Aggregate,
    build_aggregate,
    is_due_today,
    is_overdue,
    progress_for,
    task_stats_row,
)
from tests.helpers import milestone_row, task_row

DAY = dt.date(2026, 11, 21)


def test_progress_matches_the_documented_example() -> None:
    """API.md: 8 of 13 tasks done reports 62, not 61.5 or 61."""
    aggregate = Aggregate(total=13, done=8, open=5)
    assert aggregate.pct == 62
    assert progress_for("in_progress", aggregate, manual_progress=0) == 62


def test_progress_rounds_half_up() -> None:
    assert Aggregate(total=2, done=1).pct == 50
    assert Aggregate(total=3, done=1).pct == 33
    assert Aggregate(total=3, done=2).pct == 67
    assert Aggregate(total=8, done=3).pct == 38  # 37.5 -> 38
    assert Aggregate(total=0, done=0).pct == 0


def test_terminal_projects_always_report_100() -> None:
    empty = Aggregate()
    assert progress_for("completed", empty, manual_progress=0) == 100
    assert progress_for("archived", empty, manual_progress=0) == 100
    assert progress_for("archived", Aggregate(total=10, done=1), manual_progress=0) == 100


def test_manual_progress_only_applies_without_tasks() -> None:
    assert progress_for("planning", Aggregate(), manual_progress=40) == 40
    assert progress_for("on_hold", Aggregate(total=4, done=1), manual_progress=99) == 25
    assert progress_for("planning", Aggregate(), manual_progress=0) == 0


def test_overdue_and_due_today_boundaries() -> None:
    assert is_overdue(DAY - dt.timedelta(days=1), "todo", DAY) is True
    assert is_overdue(DAY, "todo", DAY) is False
    assert is_due_today(DAY, "todo", DAY) is True
    assert is_due_today(DAY + dt.timedelta(days=1), "todo", DAY) is False
    assert is_overdue(None, "todo", DAY) is False
    assert is_due_today(None, "todo", DAY) is False


def test_finished_statuses_are_never_overdue() -> None:
    past = DAY - dt.timedelta(days=5)
    for status in ("done", "dropped"):
        assert is_overdue(past, status, DAY) is False
        assert is_due_today(past, status, DAY) is False
    for status in ("todo", "in_progress", "blocked"):
        assert is_overdue(past, status, DAY) is True


def test_build_aggregate_counts_every_bucket() -> None:
    tasks = [
        task_row("overdue one", due=DAY - dt.timedelta(days=3)),
        task_row("overdue two", status="in_progress", due=DAY - dt.timedelta(days=1)),
        task_row("due today", due=DAY),
        task_row("upcoming", due=DAY + dt.timedelta(days=4)),
        task_row("no date"),
        task_row("finished", status="done", due=DAY - dt.timedelta(days=9)),
        task_row("dropped", status="dropped"),
    ]
    aggregate = build_aggregate(tasks, [milestone_row("Ship", status="done")], today=DAY)

    assert aggregate.total == 7
    assert aggregate.done == 1
    assert aggregate.open == 5  # done and dropped are not open
    assert aggregate.overdue == 2
    assert aggregate.due_today == 1
    assert aggregate.by_status["todo"] == 4
    assert aggregate.by_status["in_progress"] == 1
    assert aggregate.by_status["dropped"] == 1
    assert aggregate.milestone_count == 1
    assert aggregate.milestones_done == 1
    assert aggregate.pct == 14  # 1/7 = 14.28 -> 14


def test_build_aggregate_picks_the_nearest_future_due_task() -> None:
    tasks = [
        task_row("later", due=DAY + dt.timedelta(days=10)),
        task_row("soonest", due=DAY + dt.timedelta(days=2)),
        task_row("done so ignored", status="done", due=DAY + dt.timedelta(days=1)),
        task_row("undated", due=None),
    ]
    aggregate = build_aggregate(tasks, today=DAY)
    assert aggregate.next_due is not None
    assert aggregate.next_due.title == "soonest"
    assert aggregate.next_due.due_date == DAY + dt.timedelta(days=2)


def test_build_aggregate_without_future_tasks_has_no_next_due() -> None:
    aggregate = build_aggregate([task_row("past", due=DAY - dt.timedelta(days=1))], today=DAY)
    assert aggregate.next_due is None


def test_build_aggregate_uses_the_latest_task_touch() -> None:
    old = dt.datetime(2026, 10, 1, 9, 0)
    new = dt.datetime(2026, 11, 20, 18, 30)
    aggregate = build_aggregate(
        [task_row("quiet", updated=old), task_row("loud", updated=new)], today=DAY
    )
    assert aggregate.last_activity == new


def test_stats_row_shape_matches_the_endpoint() -> None:
    tasks = [task_row("a", due=DAY), task_row("b", status="done")]
    row = task_stats_row(build_aggregate(tasks, today=DAY))
    assert set(row) == {
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
    assert row["total"] == 2
    assert row["done"] == 1
    assert row["open"] == 1
    assert row["due_today"] == 1
    assert row["pct"] == 50
    assert row["next_due"] is None  # due today is not "next due" (future only)
    assert row["by_priority"] == {"medium": 2}

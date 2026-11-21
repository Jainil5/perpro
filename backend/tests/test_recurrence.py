"""``app.services.recurrence``: the rolling rule and the month-end clamp."""

from __future__ import annotations

import datetime as dt

import pytest

from app.models.enums import Recurrence
from app.services.recurrence import is_recurring, next_occurrence

DAY = dt.date(2026, 11, 21)


def D(day: int) -> dt.date:
    return dt.date(2026, 11, day)


@pytest.mark.parametrize("frequency", ["none", None, "quarterly", "yearly", "weekdays"])
def test_only_the_four_documented_frequencies_recur(frequency: str | None) -> None:
    assert is_recurring(frequency) is (frequency in {"daily", "weekly", "fortnightly", "monthly"})
    assert next_occurrence(DAY, frequency, DAY) is None


def test_fixed_frequencies_step_by_their_period() -> None:
    """A future occurrence simply moves one period forward."""
    upcoming = D(25)
    assert next_occurrence(upcoming, Recurrence.DAILY.value, DAY) == upcoming + dt.timedelta(days=1)
    assert next_occurrence(
        upcoming, Recurrence.WEEKLY.value, DAY
    ) == upcoming + dt.timedelta(days=7)
    assert next_occurrence(
        upcoming, Recurrence.FORTNIGHTLY.value, DAY
    ) == upcoming + dt.timedelta(days=14)


def test_next_occurrence_is_always_strictly_after_today() -> None:
    """Completing an overdue recurring task must not create another overdue row."""
    for frequency, step in (("daily", 1), ("weekly", 7), ("fortnightly", 14)):
        overdue = DAY - dt.timedelta(days=2 * step)
        assert next_occurrence(overdue, frequency, DAY) == DAY + dt.timedelta(days=step)
    # a series far in the past still lands on the first slot after today
    ancient = dt.date(2020, 1, 1)
    assert next_occurrence(ancient, "daily", DAY) == DAY + dt.timedelta(days=1)
    assert next_occurrence(ancient, "weekly", DAY) > DAY


def test_due_today_rolls_to_the_next_slot_not_to_tomorrow() -> None:
    assert next_occurrence(DAY, "weekly", DAY) == DAY + dt.timedelta(days=7)
    assert next_occurrence(DAY, "daily", DAY) == DAY + dt.timedelta(days=1)


def test_recurring_task_without_a_due_date_chains_from_today() -> None:
    assert next_occurrence(None, "daily", DAY) == DAY + dt.timedelta(days=1)
    assert next_occurrence(None, "monthly", DAY) == dt.date(2026, 12, 21)


def test_monthly_keeps_the_day_of_the_month() -> None:
    assert next_occurrence(dt.date(2026, 9, 5), "monthly", DAY) == dt.date(2026, 12, 5)


@pytest.mark.parametrize(
    ("anchor", "months", "expected"),
    [
        (dt.date(2026, 1, 31), 1, dt.date(2026, 2, 28)),
        (dt.date(2028, 1, 31), 1, dt.date(2028, 2, 29)),
        (dt.date(2026, 1, 31), 2, dt.date(2026, 3, 31)),
        (dt.date(2026, 8, 31), 3, dt.date(2026, 11, 30)),
        (dt.date(2026, 5, 30), 1, dt.date(2026, 6, 30)),
    ],
)
def test_month_end_clamps_from_the_original_anchor(
    anchor: dt.date, months: int, expected: dt.date
) -> None:
    from app.core.utils import add_months

    assert add_months(anchor, months) == expected


def test_monthly_clamp_returns_to_the_long_month() -> None:
    """The Feb 28 occurrence of a Jan-31 series must roll forward to Mar 31."""
    rolled = next_occurrence(
        dt.date(2026, 2, 28), "monthly", dt.date(2026, 3, 1), anchor=dt.date(2026, 1, 31)
    )
    assert rolled == dt.date(2026, 3, 31)


def test_monthly_from_a_past_anchor_walks_up_to_the_next_future_slot() -> None:
    # the 31st clamps inside short months, the 25th does not
    assert next_occurrence(dt.date(2026, 8, 31), "monthly", DAY) == dt.date(2026, 11, 30)
    assert next_occurrence(dt.date(2026, 9, 25), "monthly", DAY) == dt.date(2026, 11, 25)

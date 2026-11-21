"""Recurrence: the next occurrence of a recurring task.

Phase 1 frequencies: ``daily`` / ``weekly`` / ``fortnightly`` / ``monthly``.

The result is always strictly *after* ``today``, so completing an overdue recurring
task rolls it forward into the future instead of recreating another overdue row.
Month-ends clamp from the original day-of-month anchor: Jan 31 -> Feb 28
(Feb 29 in a leap year) -> Mar 31.
"""

from __future__ import annotations

import datetime as dt

from app.core.utils import add_months
from app.models.enums import Recurrence

#: days added per step for the fixed-length frequencies
_STEP_DAYS: dict[str, int] = {
    Recurrence.DAILY.value: 1,
    Recurrence.WEEKLY.value: 7,
    Recurrence.FORTNIGHTLY.value: 14,
}

#: guard against unbounded loops on absurd data (5000 weeks ~= 96 years)
_MAX_STEPS = 5000


def is_recurring(recurrence: str | None) -> bool:
    return recurrence in _STEP_DAYS or recurrence == Recurrence.MONTHLY.value


def _advance(recurrence: str, base: dt.date, month_anchor: dt.date, steps: int) -> dt.date:
    """The ``steps``-th occurrence counted from ``base`` (monthly keeps its day anchor)."""
    if recurrence == Recurrence.MONTHLY.value:
        return add_months(month_anchor, steps)
    days = _STEP_DAYS[recurrence]
    return base + dt.timedelta(days=days * steps)


def next_occurrence(
    due_date: dt.date | None,
    recurrence: str | None,
    today: dt.date,
    *,
    anchor: dt.date | None = None,
) -> dt.date | None:
    """Next occurrence strictly after ``today``, or ``None`` when not recurring.

    ``due_date`` is the occurrence being completed. ``anchor`` defaults to it and is the
    original scheduled day that keeps the monthly day-of-month stable under clamping.
    A recurring task with no due date chains from ``today`` so the series still continues.
    """
    if not is_recurring(recurrence):
        return None
    frequency = str(recurrence)
    base = due_date or anchor or today
    month_anchor = anchor or base
    steps = 1
    candidate = _advance(frequency, base, month_anchor, steps)
    while candidate <= today and steps < _MAX_STEPS:
        steps += 1
        candidate = _advance(frequency, base, month_anchor, steps)
    return candidate

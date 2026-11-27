"""The frozen clock PHASE3_FINANCE.md §10.1 asks for: one seam, four dates, no machine date.

    python3 -m pytest -q                                     # the machine's own clock
    python3 -m pytest -q --frozen-date 1995-02-27             # before this code existed
    python3 -m pytest -q --frozen-date 2032-02-29             # a leap day that is not a century
    python3 -m pytest -q --frozen-date 2060-12-31             # past the longest horizon
    python3 -m pytest -q --frozen-date 2026-11-21 --frozen-time 18:30   # IST is already the 22nd

The app has exactly one clock seam: :func:`app.core.utils.now_utc`, and ``today_utc()`` is
derived from it. But almost every consumer imported those names *by value*
(``from app.core.utils import today_utc``), so replacing the attribute on
``app.core.utils`` alone would leave those references holding the real clock and the run
would be a lie. So the replacement is installed on ``app.core.utils`` and then re-applied to
every already-imported ``app.*`` (and ``tests.helpers``) module before each test - which also
catches a module that the first request of a test imports lazily.

The clock is frozen to a *day*, not to an instant: timestamps still tick forward, one
millisecond per call. A suite in which every ``created_at`` was equal would pass this run
only by accident, because ``sort=created`` would then be ordered by random uuid ids.
``tests/test_api_signals.py`` pins the documented route count, and nothing here touches it.

Without ``--frozen-date`` this module does nothing at all: the suite runs on the real clock,
and the only rule it enforces is the app's own.
"""

from __future__ import annotations

import datetime as dt
import sys
from typing import Any

from _pytest.config.argparsing import Parser

from app.core import utils as _utils

UTC = dt.timezone.utc
TICK = dt.timedelta(milliseconds=1)

#: captured before anything is replaced, so ``sweep`` can tell "still real" from "already ours"
REAL_NOW = _utils.now_utc
REAL_TODAY = _utils.today_utc


class FrozenClock:
    """A day plus a monotonic tick: ``now_utc`` moves, ``today_utc`` never does."""

    def __init__(self, day: dt.date, clock: str = "09:00:00") -> None:
        self.day = day
        self.start = dt.datetime.combine(day, dt.time.fromisoformat(clock), tzinfo=UTC)
        self.calls = 0

    def now_utc(self) -> dt.datetime:
        self.calls += 1
        return self.start + TICK * self.calls

    def today_utc(self) -> dt.date:
        return self.day


def add_option(parser: Parser) -> None:
    group = parser.getgroup("myos", "MyOS test controls")
    group.addoption(
        "--frozen-date",
        dest="frozen_date",
        default=None,
        metavar="YYYY-MM-DD",
        help="pin the app clock to this date (leap years and old dates are the point)",
    )
    group.addoption(
        "--frozen-time",
        dest="frozen_time",
        default="09:00:00",
        metavar="HH:MM[:SS]",
        help="UTC clock time of the frozen day; 18:30 puts Asia/Kolkata on the next date",
    )


def install(config: Any) -> FrozenClock | None:
    """Swap the seam if ``--frozen-date`` was passed; return the clock (or ``None``)."""
    requested = getattr(config.option, "frozen_date", None)
    if not requested:
        return None
    day = dt.date.fromisoformat(str(requested).strip())
    clock = FrozenClock(day, str(getattr(config.option, "frozen_time", "09:00:00")))
    _utils.now_utc = clock.now_utc  # type: ignore[assignment]
    _utils.today_utc = clock.today_utc  # type: ignore[assignment]
    sweep()
    return clock


def sweep() -> None:
    """Re-apply the installed clock to every module that imported it by value."""
    if _utils.now_utc is REAL_NOW:
        return
    replacements = {"now_utc": _utils.now_utc, "today_utc": _utils.today_utc}
    for name, module in list(sys.modules.items()):
        if not (name.startswith("app.") or name == "tests.helpers"):
            continue
        for attribute, replacement in replacements.items():
            if getattr(module, attribute, None) in (REAL_NOW, REAL_TODAY):
                setattr(module, attribute, replacement)


def frozen(config: Any) -> str | None:
    """What ``--frozen-date`` asked for, for the pytest header - ``None`` when it did not."""
    return getattr(config.option, "frozen_date", None) or None

"""Small shared helpers: time, ids, slugs, text.

All datetimes handled here are UTC. The database stores naive-looking UTC
(SQLite has no timezone storage) and the API layer always re-serialises them
with an explicit ``Z`` suffix, see :func:`to_utc_iso`.
"""

from __future__ import annotations

import calendar
import datetime as dt
import re
import uuid

UTC = dt.timezone.utc


def now_utc() -> dt.datetime:
    """Current instant, timezone-aware UTC (truncate to seconds keeps JSON stable)."""
    return dt.datetime.now(UTC).replace(microsecond=0)


def today_utc() -> dt.date:
    return now_utc().date()


def new_id() -> str:
    """Server-generated identifier (UUID4 string, as required by API.md)."""
    return str(uuid.uuid4())


def ensure_utc(value: dt.datetime | None) -> dt.datetime | None:
    """Attach UTC to naive datetimes, convert aware ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_utc_iso(value: dt.datetime | None) -> str | None:
    """ISO-8601 UTC with a ``Z`` suffix (API.md: "all timestamps are UTC ISO-8601 with Z")."""
    if value is None:
        return None
    aware = ensure_utc(value)
    assert aware is not None
    return aware.isoformat().replace("+00:00", "Z")


def to_date(value: dt.date | dt.datetime | str | None) -> dt.date | None:
    if value is None or isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    if len(text) == 10:
        return dt.date.fromisoformat(text)
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00")).date()


def add_months(day_anchor: dt.date, months: int) -> dt.date:
    """Add ``months`` to a date, clamping to the last day of the target month.

    ``add_months(date(2026, 1, 31), 1)`` -> ``2026-02-28`` (and ``2028-02-29`` in a
    leap year) — the day-of-month anchor is preserved whenever it fits.
    """
    total = day_anchor.year * 12 + (day_anchor.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    day = min(day_anchor.day, calendar.monthrange(year, month)[1])
    return dt.date(year, month, day)


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(value: str, *, fallback: str = "item") -> str:
    slug = _SLUG_STRIP.sub("-", (value or "").strip().lower()).strip("-")
    return slug or fallback


def plain_text(markdown: str | None) -> str:
    """Rough markdown -> text, used for note excerpts."""
    if not markdown:
        return ""
    text = re.sub(r"`{1,3}", "", markdown)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)  # images
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)  # links -> label
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)  # headings
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)  # blockquotes
    text = re.sub(r"^\s{0,3}[-*+]\s+", "", text, flags=re.MULTILINE)  # bullets
    text = re.sub(r"[*_]{1,3}", "", text)  # emphasis
    text = re.sub(r"\|", " ", text)  # table pipes
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def excerpt(markdown: str | None, limit: int = 160) -> str:
    text = plain_text(markdown)
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def word_count(text: str | None) -> int:
    if not text:
        return 0
    return len(plain_text(text).split())

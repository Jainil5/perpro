"""Shared Pydantic v2 building blocks: JSON formats, normalisers, envelopes.

Serialization rules come straight from API.md:

* timestamps  -> UTC ISO-8601 with a ``Z`` suffix
* dates       -> ``YYYY-MM-DD`` or ``null``
* requests    -> ``extra="forbid"``, so a typo is a 422 rather than a silent no-op

Input normalisation (``"High"`` -> ``"high"``, strict date parsing, tag cleaning) lives
here so the concrete schemas stay one-line-per-field and the rules cannot drift apart.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer

from app.core.utils import to_utc_iso
from app.models.enums import ENUMS

T = TypeVar("T")

#: UTC ISO-8601 with ``Z`` in JSON, ``datetime`` in Python. ``when_used="always"`` so
#: the format does not depend on whether FastAPI dumped the model in json or python mode.
UtcDateTime = Annotated[
    dt.datetime, PlainSerializer(to_utc_iso, return_type=str | None, when_used="always")
]
#: ``YYYY-MM-DD`` (Pydantic already does this; being explicit keeps python-mode dumps stable)
DateOnly = Annotated[
    dt.date, PlainSerializer(lambda value: value.isoformat(), return_type=str, when_used="always")
]

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_date(value: Any) -> Any:
    """Strict ``YYYY-MM-DD``; ``date``/``datetime`` objects pass through, blanks become ``None``."""
    if value is None or isinstance(value, (dt.date, dt.datetime)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if _DATE_RE.match(text):
            return dt.date.fromisoformat(text)
    raise ValueError("invalid date, expected YYYY-MM-DD")


def parse_datetime(value: Any) -> Any:
    """ISO-8601 with optional ``Z``; a bare date means midnight UTC."""
    if value is None or isinstance(value, dt.datetime):
        return value
    if isinstance(value, dt.date):
        return dt.datetime(value.year, value.month, value.day, tzinfo=dt.timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
        if _DATE_RE.match(candidate):
            year, month, day = (int(part) for part in candidate.split("-"))
            return dt.datetime(year, month, day, tzinfo=dt.timezone.utc)
        parsed = dt.datetime.fromisoformat(candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    raise ValueError("invalid datetime, expected ISO-8601")


def require_choice(value: Any, enum_key: str, field: str) -> Any:
    """Case/separator-normalise (``"In Progress"`` -> ``"in_progress"``) then pin to ENUMS."""
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        candidate = re.sub(r"[\s-]+", "_", text.lower())
        allowed = ENUMS[enum_key]
        if candidate in allowed:
            return candidate
        raise ValueError(f"{field} must be one of: {', '.join(allowed)}")
    return value


def trim_required(value: Any, field: str) -> Any:
    """Reject blank required strings, trim everything else."""
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError(f"{field} must not be empty")
        return text
    if value is None:
        raise ValueError(f"{field} must not be null")
    return value


def trim_optional(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return value


def clean_tags(value: Any) -> list[str]:
    """Trim, drop blanks, de-duplicate case-insensitively, keep first-seen order."""
    if value is None:
        return []
    if isinstance(value, str):
        value = re.split(r"[,;]", value)
    if not isinstance(value, (list, tuple, set)):
        raise ValueError("tags must be a list of strings")
    seen: dict[str, str] = {}
    for raw in value:
        if raw is None:
            continue
        if not isinstance(raw, str):
            raise ValueError("tags must be strings")
        name = raw.strip().lstrip("#")
        if not name:
            continue
        seen.setdefault(name.lower(), name)
    return list(seen.values())


def Choice(enum_key: str, field: str | None = None) -> Any:
    """Enum input pinned to :data:`ENUMS`, e.g. ``Choice("priority") | None``.

    ``"High"`` -> ``"high"``; an unknown value is a 422 listing the options. Because the
    annotated type already allows ``None`` - :func:`require_choice` maps ``null`` and a
    blank string to it - "not provided" and "blank" behave the same way as they do for
    query parameters. A *required* enum adds its own non-null validator (see
    ``RelationIn``).
    """
    key = enum_key
    name = field or enum_key
    return Annotated[
        str | None, BeforeValidator(lambda value: require_choice(value, key, name))
    ]


def RequiredStr(field: str) -> Any:
    """Non-empty trimmed string; ``""`` and ``null`` are both a 422."""
    return Annotated[str, BeforeValidator(lambda value: trim_required(value, field))]


def OptionalStr(field: str) -> Any:
    """Optional non-empty trimmed string: absent/``null`` clears, ``""`` is a 422."""
    return Annotated[
        str | None,
        BeforeValidator(lambda value: None if value is None else trim_required(value, field)),
    ]


#: reusable annotated input types
DateIn = Annotated[dt.date | None, BeforeValidator(parse_date)]
RequiredDateIn = Annotated[dt.date, BeforeValidator(parse_date)]
DateTimeIn = Annotated[dt.datetime | None, BeforeValidator(parse_datetime)]
RequiredDateTimeIn = Annotated[dt.datetime, BeforeValidator(parse_datetime)]
TagsIn = Annotated[list[str], BeforeValidator(clean_tags)]
TextIn = Annotated[str | None, BeforeValidator(trim_optional)]


class RequestModel(BaseModel):
    """Base for every request body: unknown keys are a 422."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResponseModel(BaseModel):
    """Base for every response model: built from ORM objects plus computed values."""

    model_config = ConfigDict(from_attributes=True)


class ListEnvelope(BaseModel, Generic[T]):
    """API.md response rule 1: lists are always ``{ "items": [...], "total": n }``."""

    items: list[T] = Field(default_factory=list)
    total: int = 0


class TaskCounts(ResponseModel):
    """Derived project counters, ``round``d progress lives next to them."""

    total: int = 0
    done: int = 0
    open: int = 0
    overdue: int = 0


class NextDue(ResponseModel):
    """The nearest future open task of a project."""

    title: str
    due_date: DateOnly


"""Tolerant task importer for ``POST /tasks/import``.

LLM output is rarely valid JSON, so this module repairs the usual damage before
parsing: markdown code fences, prose around the payload, trailing commas, single
quotes, ``//`` comments, bare object keys, and alias keys (``name``→``title``,
``deadline``/``due``→``due_date``, ``done``/``status``→``status``,
``desc``→``description``, ``category``→``tags``).

Two failure levels, per API.md:

* **rejected** - the item cannot become a task (not an object, blank title, or the
  same title twice inside one payload). Reported as ``{index, title, reason}``.
* **warning** - the item is created (or skipped) but something was dropped or
  guessed: an unknown priority, an unparsable date, a stray ``id``, a duplicate.

Ids are never taken from the payload: :func:`app.core.utils.new_id` assigns them.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ApiError, field_error, validation
from app.models import Project, Task
from app.models.enums import ENUMS, Priority, Recurrence, Source, TaskStatus
from app.schemas.common import clean_tags
from app.services import crud, tasks as tasks_service

#: payload key -> canonical task field, checked in order (first non-null match wins)
_ALIASES: dict[str, tuple[str, ...]] = {
    "title": ("title", "name", "task", "task_name"),
    "description": ("description", "desc", "details"),
    "notes": ("notes", "note"),
    "due_date": ("due_date", "deadline", "due", "due_on"),
    "start_date": ("start_date", "start", "starts_on"),
    "priority": ("priority", "prio"),
    "status": ("status", "state"),
    "done": ("done", "completed", "is_done"),
    "recurrence": ("recurrence", "repeat", "repeats"),
    "tags": ("tags", "tag", "labels", "category", "categories"),
    "estimated_minutes": ("estimated_minutes", "estimate", "estimate_minutes"),
    "actual_minutes": ("actual_minutes", "actual"),
    "parent_task_id": ("parent_task_id", "parent", "parent_task"),
}

#: values under ``done``/``status`` that mean "finished" / "not finished"
_DONE_WORDS = {"true", "yes", "y", "done", "completed", "complete", "finished", "1"}
_OPEN_WORDS = {"false", "no", "n", "todo", "to_do", "open", "pending", "0"}

_FENCE_RE = re.compile(r"```[ \t]*[a-zA-Z0-9_+-]*[ \t]*\r?\n(.*?)\r?\n?[ \t]*```", re.DOTALL)
_COMMENT_RE = re.compile(r"^\s*//[^\n]*$", re.MULTILINE)
_BARE_KEY_RE = re.compile(r"([{\[,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*):")
_DATE_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})")
_ID_KEY_RE = re.compile(r"\b(id|uuid|key)\b", re.IGNORECASE)


# --------------------------------------------------------------------------- parse


def _unwrap_fences(text: str) -> str:
    """Keep fenced bodies only; prose around them is discarded."""
    bodies = _FENCE_RE.findall(text)
    return "\n".join(bodies) if bodies else text


def _json_span(text: str) -> str:
    """The first balanced ``{…}``/``[…]`` region, ignoring brackets inside strings."""
    starts = sorted(
        (pos, char) for pos, char in ((text.find("["), "["), (text.find("{"), "{")) if pos >= 0
    )
    if not starts:
        raise validation(
            "raw does not contain JSON",
            [field_error(["body", "raw"], "no opening { or [ found")],
        )
    start, opener = starts[0]
    closer = "]" if opener == "[" else "}"
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return text[start:]


def _repair(text: str, warnings: list[str]) -> str:
    """Make damaged JSON parseable: comments, trailing commas, single quotes, bare keys."""
    decommented = _COMMENT_RE.sub("", text)
    if decommented != text:
        warnings.append("stripped // comments from the payload")

    out: list[str] = []
    in_string = False
    escaped = False
    quote_char = ""
    trailing_commas = 0
    replaced_quotes = 0
    for index, char in enumerate(decommented):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                in_string = False
                out.append('"')
                continue
            elif char == '"':
                out.append('\\"')  # a real quote inside a single-quoted string
                continue
            out.append(char)
            continue
        if char == '"':
            in_string = True
            quote_char = '"'
            out.append(char)
            continue
        if char in "'`" and _opens_string(decommented, index):
            in_string = True
            quote_char = char
            replaced_quotes += 1
            out.append('"')
            continue
        if char == "," and _peek_nonspace(decommented, index + 1) in ("]", "}"):
            trailing_commas += 1
            continue
        out.append(char)
    if trailing_commas:
        warnings.append(f"removed {trailing_commas} trailing comma(s) from the payload")
    if replaced_quotes:
        warnings.append(f"replaced {replaced_quotes} single-quoted string(s) with double quotes")
    return _BARE_KEY_RE.sub(r'\1"\2"\3:', "".join(out))


def _peek_nonspace(text: str, start: int) -> str:
    for index in range(start, len(text)):
        if not text[index].isspace():
            return text[index]
    return ""


def _opens_string(text: str, index: int) -> bool:
    """A lone quote only opens a string after ``:`` ``,`` ``[`` or ``{``."""
    for cursor in range(index - 1, -1, -1):
        char = text[cursor]
        if char.isspace():
            continue
        return char in (":", ",", "[", "{")
    return True


def parse_raw(raw: str) -> tuple[list[Any], list[str]]:
    """``raw`` -> ``(items, repair_warnings)``; raises a 422 when nothing parses.

    Accepts a bare array, ``{"tasks": [...]}`` (also ``items``/``todos``) and a
    single task object.
    """
    warnings: list[str] = []
    if not raw or not raw.strip():
        raise validation("raw must not be empty", [field_error(["body", "raw"], "empty string")])
    candidate = _repair(_json_span(_unwrap_fences(raw)), warnings)
    try:
        loaded = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise validation(
            "raw is not valid JSON",
            [field_error(["body", "raw"], f"{exc.msg} (line {exc.lineno}, column {exc.colno})")],
        ) from exc
    if isinstance(loaded, dict):
        for key in ("tasks", "items", "todos"):
            if isinstance(loaded.get(key), list):
                loaded = loaded[key]
                break
        else:
            loaded = [loaded]
    if not isinstance(loaded, list):
        raise validation(
            "raw must decode to a list of tasks",
            [field_error(["body", "raw"], f"got {type(loaded).__name__}")],
        )
    if not loaded:
        warnings.append("the payload contained an empty task list")
    return loaded, warnings


# ------------------------------------------------------------------------ coerce


def _pick(item: dict[str, Any], field: str) -> Any:
    """Value behind ``field``, following the alias table."""
    lowered = {str(key).strip().lower(): key for key in item}
    for candidate in _ALIASES.get(field, (field,)):
        original = lowered.get(candidate)
        if original is None:
            continue
        value = item[original]
        if value is not None and not (isinstance(value, str) and not value.strip()):
            return value
    return None


def _text(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, (list, tuple)):
        return "\n".join(str(part) for part in value if part not in (None, ""))
    return str(value if value is not None else "").strip()


def _choice(value: Any, enum_key: str, default: str, label: str, warnings: list[str]) -> str:
    """``"High"``→``high``; an unknown value warns and falls back to ``default``."""
    text = str(value).strip()
    candidate = re.sub(r"[\s-]+", "_", text.lower())
    if candidate in ENUMS[enum_key]:
        return candidate
    warnings.append(f"{label}: {text!r} is not a valid {enum_key}; using {default!r}")
    return default


def _integer(value: Any, label: str, warnings: list[str]) -> int | None:
    text = str(value).strip().rstrip("%")
    try:
        number = int(float(text))
    except ValueError:
        warnings.append(f"{label}: {value!r} is not a whole number; ignored")
        return None
    if number < 0:
        warnings.append(f"{label}: {value!r} is negative; ignored")
        return None
    return number


def _date(value: Any, label: str, warnings: list[str]) -> dt.date | None:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    match = _DATE_RE.match(str(value).strip())
    if match:
        try:
            return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            pass
    warnings.append(f"{label}: {value!r} is not a YYYY-MM-DD date; ignored")
    return None


def _tags(value: Any) -> list[str]:
    if isinstance(value, str):
        return clean_tags(value)
    if isinstance(value, (list, tuple, set)):
        names = [str(entry) for entry in value if isinstance(entry, str)]
        return clean_tags(names)
    return []


def normalize_item(item: Any, index: int) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    """One payload item -> a ``TaskCreate``-shaped dict, or ``(None, reason, warnings)``."""
    warnings: list[str] = []
    label = f"task {index}"
    if not isinstance(item, dict):
        return None, f"expected an object, got {type(item).__name__}", warnings
    stray = sorted(key for key in item if _ID_KEY_RE.match(str(key).strip()))
    if stray:
        warnings.append(f"{label}: ignored client-side key(s) {stray}; the server assigns ids")

    title = _text(_pick(item, "title"))
    if not title:
        return None, "missing title", warnings
    if len(title) > 500:
        return None, "title is longer than 500 characters", warnings

    payload: dict[str, Any] = {"title": title}
    for field in ("description", "notes"):
        text = _text(_pick(item, field))
        if text:
            payload[field] = text
    for field in ("due_date", "start_date"):
        value = _pick(item, field)
        if value is not None:
            day = _date(value, f"{label} {field}", warnings)
            if day is not None:
                payload[field] = day

    status = _pick(item, "status")
    if status is None:
        status = _pick(item, "done")
    if status is not None:
        marker = str(status).strip().lower()
        if marker in _DONE_WORDS:
            payload["status"] = TaskStatus.DONE.value
        elif marker in _OPEN_WORDS:
            payload["status"] = TaskStatus.TODO.value
        elif isinstance(status, bool):
            payload["status"] = (
                TaskStatus.DONE.value if status else TaskStatus.TODO.value
            )
        else:
            payload["status"] = _choice(
                marker, "task.status", TaskStatus.TODO.value, f"{label} status", warnings
            )
    priority = _pick(item, "priority")
    if priority is not None:
        payload["priority"] = _choice(
            priority, "priority", Priority.MEDIUM.value, f"{label} priority", warnings
        )
    recurrence = _pick(item, "recurrence")
    if recurrence is not None:
        text = str(recurrence).strip().lower()
        if text in ("never", "once", "no"):
            payload["recurrence"] = Recurrence.NONE.value
        else:
            payload["recurrence"] = _choice(
                text,
                "task.recurrence",
                Recurrence.NONE.value,
                f"{label} recurrence",
                warnings,
            )
    for field in ("estimated_minutes", "actual_minutes"):
        value = _pick(item, field)
        if value is not None:
            number = _integer(value, f"{label} {field}", warnings)
            if number is not None:
                payload[field] = number
    tags = _tags(_pick(item, "tags"))
    if tags:
        payload["tags"] = tags
    parent = _pick(item, "parent_task_id")
    if parent is not None:
        payload["parent_task_id"] = _text(parent)
    return payload, None, warnings


# ------------------------------------------------------------------------- apply


def _existing_title_keys(
    session: Session, workspace_id: str, project_id: str | None, keys: set[str]
) -> set[str]:
    """Which of ``keys`` are already used by a task in the same project scope."""
    if not keys:
        return set()
    conditions = [Task.workspace_id == workspace_id, sa.func.lower(sa.func.trim(Task.title)).in_(keys)]
    conditions.append(Task.project_id == project_id if project_id else Task.project_id.is_(None))
    rows = session.execute(sa.select(Task.title).where(*conditions))
    return {str(found).strip().lower() for (found,) in rows}


def import_tasks(
    session: Session,
    workspace_id: str,
    *,
    raw: str,
    project_id: str | None = None,
    allow_duplicates: bool = False,
) -> dict[str, Any]:
    """``POST /tasks/import`` -> ``{created, duplicates, rejected, warnings}``."""
    items, warnings = parse_raw(raw)
    if project_id:
        crud.validate_fk(
            session, Project, project_id, workspace_id=workspace_id, field="project_id"
        )

    seen: dict[str, int] = {}
    created = 0
    duplicates = 0
    rejected: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        payload, reason, item_warnings = normalize_item(item, index)
        warnings.extend(item_warnings)
        if payload is None:
            rejected.append(
                {
                    "index": index,
                    "title": _text(_pick(item, "title")) if isinstance(item, dict) else None,
                    "reason": reason or "invalid item",
                }
            )
            continue
        key = payload["title"].lower()
        if key in seen:
            rejected.append(
                {
                    "index": index,
                    "title": payload["title"],
                    "reason": f"duplicate title in payload (same title as task {seen[key]})",
                }
            )
            continue
        seen[key] = index
        if not allow_duplicates and key in _existing_title_keys(
            session, workspace_id, project_id, {key}
        ):
            duplicates += 1
            warnings.append(
                f"task {index}: “{payload['title']}” already exists in this project - "
                "skipped (use allow_duplicates to import it anyway)"
            )
            continue
        if project_id:
            # ``project_id`` on the request is the import target (API.md)
            payload["project_id"] = project_id
        try:
            tasks_service.create_task(
                session, workspace_id, payload, source=Source.USER.value, record_activity=True
            )
        except ApiError as exc:  # a dangling parent is an item-level reject, not a 500
            rejected.append({"index": index, "title": payload["title"], "reason": exc.message})
            continue
        created += 1
    return {
        "created": created,
        "duplicates": duplicates,
        "rejected": rejected,
        "warnings": warnings,
    }

"""Deep links: the only place that knows how the MyOS frontend is addressed.

Every ``href`` the backend emits - activity rows, notifications, dashboard insights,
search results, demo data - is built here, so a route change is a one-line edit in this
module instead of a hunt through five services.

The rules, all of them enforced by :func:`href_for`:

* a screen that selects one object does it with a **query parameter**
  (``/os/tasks?task=…``, ``/os/notes?note=…``, ``/os/contacts?contact=…``); only
  projects have a detail route of their own (``/os/projects/<id>``);
* a milestone opens **its project** - there is no milestone page;
* entities with no detail screen at all - goals, reminders, notifications, companies,
  workspaces - link to the list page that shows them;
* a missing id never leaks into a URL: ``href_for("milestone", mid, project_id=None)``
  is ``/os/projects``, not ``/os/projects/None``.  The guard lives here rather than at
  every call site, so it cannot be forgotten;
* an entity type we do not know yields ``None`` - no link is better than a wrong one.

The full target set is written down in docs/MYOS/DATA_MODEL.md ("Deep links"); anything
outside it is a bug in this module.
"""

from __future__ import annotations

from typing import Final
from urllib.parse import quote

OS_ROOT: Final = "/os"
ACTIVITY: Final = f"{OS_ROOT}/activity"
CONTACTS: Final = f"{OS_ROOT}/contacts"
GOALS: Final = f"{OS_ROOT}/goals"
NOTES: Final = f"{OS_ROOT}/notes"
NOTIFICATIONS: Final = f"{OS_ROOT}/notifications"
PROJECTS: Final = f"{OS_ROOT}/projects"
SETTINGS: Final = f"{OS_ROOT}/settings"
TASKS: Final = f"{OS_ROOT}/tasks"

#: saved views of the task list (``/os/tasks?filter=overdue`` is the shape API.md shows)
TASKS_OVERDUE: Final = f"{TASKS}?filter=overdue"
TASKS_DUE_TODAY: Final = f"{TASKS}?filter=today"
TASKS_DUE_WEEK: Final = f"{TASKS}?filter=week"

#: entity type -> (its list page, the query parameter that selects one row there).
#: ``None`` as the parameter means the page cannot select a row: link to the list.
_LINKS: Final[dict[str, tuple[str, str | None]]] = {
    "activity": (ACTIVITY, None),
    "company": (CONTACTS, None),
    "contact": (CONTACTS, "contact"),
    "goal": (GOALS, None),
    "milestone": (PROJECTS, None),
    "note": (NOTES, "note"),
    "notification": (NOTIFICATIONS, None),
    "project": (PROJECTS, None),
    "reminder": (NOTIFICATIONS, None),
    "task": (TASKS, "task"),
    "workspace": (SETTINGS, None),
}

#: plural search group / table name -> the singular entity type it holds
_ALIASES: Final[dict[str, str]] = {
    "companies": "company",
    "contacts": "contact",
    "goals": "goal",
    "milestones": "milestone",
    "notes": "note",
    "notifications": "notification",
    "projects": "project",
    "reminders": "reminder",
    "tasks": "task",
    "users": "workspace",
    "workspaces": "workspace",
}


def _kind(name: str | None) -> str | None:
    key = str(name).strip().lower() if name else ""
    return _ALIASES.get(key, key) or None


def _id(entity_id: object) -> str | None:
    """An id we may put in a URL: ``None``, empty and the literal ``"None"`` may not."""
    if entity_id is None:
        return None
    text = str(entity_id).strip()
    return text if text and text != "None" else None


def href_for(
    entity_type: str | None, entity_id: str | None = None, *, project_id: str | None = None
) -> str | None:
    """In-app link for one entity, or ``None`` for an entity type we do not know.

    ``project_id`` is consulted only for milestones, which have no page of their own and
    open the project they belong to; with no project they open the project list.
    """
    kind = _kind(entity_type)
    entry = _LINKS.get(kind or "")
    if entry is None:
        return None
    page, parameter = entry
    if kind == "milestone":
        project = _id(project_id)
        return f"{PROJECTS}/{project}" if project else PROJECTS
    if kind == "project":
        project = _id(entity_id)
        return f"{PROJECTS}/{project}" if project else PROJECTS
    ident = _id(entity_id)
    if parameter is None or not ident:
        return page
    return f"{page}?{parameter}={ident}"


def search_href(page: str, query: str) -> str:
    """The "show me the whole list for this term" link every search group carries."""
    return f"{page}?q={quote((query or '').strip(), safe='')}"

"""Global search + dashboard response shapes (API.md "Search", "Dashboard")."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import DateOnly, ResponseModel
from app.schemas.notes import NoteSummaryOut
from app.schemas.projects import MilestoneOut, ProjectOut
from app.schemas.signals import ActivityOut, NotificationOut, ReminderOut
from app.schemas.tasks import TaskOut

#: group keys, in the order /search renders them
SEARCH_GROUP_ORDER: tuple[str, ...] = (
    "tasks",
    "projects",
    "notes",
    "milestones",
    "contacts",
    "companies",
)

SEARCH_GROUP_LABELS: dict[str, str] = {
    "tasks": "Tasks",
    "projects": "Projects",
    "notes": "Notes",
    "milestones": "Milestones",
    "contacts": "Contacts",
    "companies": "Companies",
}


class SearchItem(ResponseModel):
    id: str
    title: str
    subtitle: str | None = None
    href: str
    badge: str | None = None


class SearchGroup(ResponseModel):
    type: str
    label: str
    href: str
    items: list[SearchItem] = Field(default_factory=list)


class SearchOut(ResponseModel):
    query: str
    groups: list[SearchGroup] = Field(default_factory=list)
    total: int = 0


class DeadlineSoon(ResponseModel):
    id: str
    name: str
    target_date: DateOnly
    days_left: int


class DashboardTasks(ResponseModel):
    due_today: list[TaskOut] = Field(default_factory=list)
    overdue: list[TaskOut] = Field(default_factory=list)
    upcoming: list[TaskOut] = Field(default_factory=list)
    completed_this_week: int = 0
    open: int = 0


class DashboardProjects(ResponseModel):
    active: list[ProjectOut] = Field(default_factory=list)
    deadline_soon: list[DeadlineSoon] = Field(default_factory=list)


class DashboardPeople(ResponseModel):
    new_contacts_30d: int = 0


class DashboardNotes(ResponseModel):
    recent: list[NoteSummaryOut] = Field(default_factory=list)


class DashboardMilestones(ResponseModel):
    upcoming: list[MilestoneOut] = Field(default_factory=list)


class DashboardReminders(ResponseModel):
    due: list[ReminderOut] = Field(default_factory=list)


class DashboardNotifications(ResponseModel):
    unread: int = 0
    items: list[NotificationOut] = Field(default_factory=list)


class Insight(ResponseModel):
    kind: str
    severity: str
    text: str
    #: present for the entity-scoped insights so the UI can link straight to it
    href: str | None = None
    entity_id: str | None = None


class DashboardOut(ResponseModel):
    today: DateOnly
    tasks: DashboardTasks = Field(default_factory=DashboardTasks)
    projects: DashboardProjects = Field(default_factory=DashboardProjects)
    people: DashboardPeople = Field(default_factory=DashboardPeople)
    notes: DashboardNotes = Field(default_factory=DashboardNotes)
    milestones: DashboardMilestones = Field(default_factory=DashboardMilestones)
    reminders: DashboardReminders = Field(default_factory=DashboardReminders)
    notifications: DashboardNotifications = Field(default_factory=DashboardNotifications)
    activity: list[ActivityOut] = Field(default_factory=list)
    insights: list[Insight] = Field(default_factory=list)

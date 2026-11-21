"""Project and milestone schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import (
    Choice,
    DateIn,
    DateOnly,
    ListEnvelope,
    NextDue,
    OptionalStr,
    RequiredDateIn,
    RequiredStr,
    RequestModel,
    ResponseModel,
    TaskCounts,
    UtcDateTime,
)

PriorityIn = Choice("priority", "priority")


class ProjectOut(ResponseModel):
    """Project object: stored fields plus the four derived blocks from API.md."""

    id: str
    name: str
    description: str | None = None
    category: str | None = None
    status: str
    priority: str
    start_date: DateOnly | None = None
    target_date: DateOnly | None = None
    repository_url: str | None = None
    documentation_url: str | None = None
    next_action: str | None = None
    manual_progress: int = 0
    progress: int = 0
    task_counts: TaskCounts = Field(default_factory=TaskCounts)
    next_due: NextDue | None = None
    milestone_count: int = 0
    milestones_done: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ProjectCreate(RequestModel):
    """Required ``name``; everything else optional except the derived fields."""

    name: RequiredStr("name")
    description: str | None = None
    category: str | None = None
    status: Choice("project.status", "status") | None = None
    priority: PriorityIn | None = None
    start_date: DateIn = None
    target_date: DateIn = None
    repository_url: str | None = None
    documentation_url: str | None = None
    next_action: str | None = None
    manual_progress: int = Field(default=0, ge=0, le=100)


class ProjectUpdate(RequestModel):
    """Every field optional; an explicit ``null`` clears a nullable column."""

    name: OptionalStr("name") = None
    description: str | None = None
    category: str | None = None
    status: Choice("project.status", "status") | None = None
    priority: PriorityIn | None = None
    start_date: DateIn = None
    target_date: DateIn = None
    repository_url: str | None = None
    documentation_url: str | None = None
    next_action: str | None = None
    manual_progress: int | None = Field(default=None, ge=0, le=100)


class ProjectStatsOut(ResponseModel):
    """``GET /projects/{id}/stats``."""

    total: int
    done: int
    open: int
    overdue: int
    due_today: int
    pct: int
    next_due: NextDue | None = None
    by_status: dict[str, int] = Field(default_factory=dict)
    by_priority: dict[str, int] = Field(default_factory=dict)


class MilestoneOut(ResponseModel):
    id: str
    project_id: str
    title: str
    description: str | None = None
    date: DateOnly
    status: str
    completed_at: UtcDateTime | None = None
    days_away: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class MilestoneCreate(RequestModel):
    project_id: str
    title: RequiredStr("title")
    description: str | None = None
    date: RequiredDateIn
    status: Choice("milestone.status", "status") | None = None


class MilestoneUpdate(RequestModel):
    project_id: str | None = None
    title: OptionalStr("title") = None
    description: str | None = None
    date: DateIn = None
    status: Choice("milestone.status", "status") | None = None


class ProjectListOut(ListEnvelope[ProjectOut]):
    pass


class MilestoneListOut(ListEnvelope[MilestoneOut]):
    pass

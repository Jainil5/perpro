"""``GET /search`` ranking, grouping and matching rules."""

from __future__ import annotations

import datetime as dt

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import Company, Contact, Milestone, Note, Project, Task
from app.services import search
from tests.helpers import make_project, make_task, other_workspace

DAY = dt.date(2026, 11, 21)


def groups_by_type(payload: dict) -> dict[str, list[str]]:
    return {group["type"]: [item["title"] for item in group["items"]] for group in payload["groups"]}


# -------------------------------------------------------------------------- rank


@pytest.mark.parametrize(
    ("title", "needle", "expected"),
    [
        ("Postgres", "postgres", search.RANK_EXACT),
        ("Postgres upgrade", "postgres", search.RANK_PREFIX),
        ("Upgrade Postgres now", "postgres", search.RANK_SUBSTRING),
        ("", "anything", search.RANK_SUBSTRING),
    ],
)
def test_rank_levels(title: str, needle: str, expected: int) -> None:
    assert search.rank(title, needle) == expected


def test_exact_beats_prefix_beats_substring() -> None:
    ordered = sorted(
        ["Upgrade Postgres now", "Postgres upgrade", "Postgres"],
        key=lambda title: search.rank(title, "postgres"),
    )
    assert ordered == ["Postgres", "Postgres upgrade", "Upgrade Postgres now"]


# ----------------------------------------------------------------------- queries


def test_short_queries_answer_nothing(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "anything at all")
    for needle in ("", " ", "a", None):
        assert search.search(session, workspace_id, query=needle) == {
            "query": (needle or "").strip(),
            "groups": [],
            "total": 0,
        }


def test_search_is_case_insensitive_and_stripped(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Postgres upgrade")
    payload = search.search(session, workspace_id, query="  POSTGRES  ")
    assert payload["query"] == "POSTGRES"
    assert groups_by_type(payload)["tasks"] == ["Postgres upgrade"]


def test_groups_come_back_in_the_documented_order(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "Acme rollout")
    make_task(session, workspace_id, "Acme checklist", project_id=project["id"])
    make_task(session, workspace_id, "Unrelated")
    session.add(
        Note(
            workspace_id=workspace_id,
            title="Acme notes",
            content="Decisions about Acme rollout.",
            category="meeting",
            source="user",
        )
    )
    session.add(
        Contact(
            workspace_id=workspace_id,
            name="Acme Liaison",
            kind="client",
            source="user",
        )
    )
    session.add(
        Company(workspace_id=workspace_id, name="Acme Corp", industry="Retail", source="user")
    )
    session.add(
        Milestone(
            workspace_id=workspace_id,
            project_id=project["id"],
            title="Acme go live",
            date=DAY,
            status="open",
            source="user",
        )
    )
    session.flush()

    payload = search.search(session, workspace_id, query="acme", today=DAY)
    order = [group["type"] for group in payload["groups"]]
    assert order == list(search.SEARCH_GROUP_ORDER)
    assert set(order) == {"tasks", "projects", "notes", "milestones", "contacts", "companies"}
    assert payload["total"] == sum(len(group["items"]) for group in payload["groups"])


def test_items_carry_href_badge_and_subtitle(session: Session, workspace_id: str) -> None:
    project = make_project(session, workspace_id, "OrderBook", status="in_progress")
    overdue = make_task(
        session,
        workspace_id,
        "Order sync",
        project_id=project["id"],
        due_date=DAY - dt.timedelta(days=2),
    )
    payload = search.search(session, workspace_id, query="order", today=DAY)
    group = payload["groups"][0]
    assert group["label"] == "Tasks"
    assert group["href"] == "/tasks?q=order"
    item = group["items"][0]
    assert item["id"] == overdue["id"]
    assert item["href"] == f"/tasks?task={overdue['id']}"
    assert item["subtitle"] == "OrderBook"
    assert item["badge"] == "overdue"


def test_search_finds_text_in_body_columns_not_only_titles(
    session: Session, workspace_id: str
) -> None:
    make_task(session, workspace_id, "Silent", notes="mentions the ledger reconciliation loop")
    make_project(session, workspace_id, "Quiet", description="about the ledger")
    payload = search.search(session, workspace_id, query="ledger")
    grouped = groups_by_type(payload)
    assert grouped["tasks"] == ["Silent"]
    assert grouped["projects"] == ["Quiet"]


def test_per_group_limit_and_ranking(session: Session, workspace_id: str) -> None:
    for index in range(6):
        make_task(session, workspace_id, f"Inbox task {index}")
    make_task(session, workspace_id, "Inbox")
    make_task(session, workspace_id, "Inbox cleanup")

    payload = search.search(session, workspace_id, query="inbox", limit=3)
    items = payload["groups"][0]["items"]
    assert [item["title"] for item in items] == ["Inbox", "Inbox cleanup", "Inbox task 0"]
    assert payload["total"] == 3


def test_search_never_crosses_workspaces(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "Keep me")
    session.add(
        Task(
            workspace_id=other_workspace(session),
            title="Keep me too",
            status="todo",
            priority="low",
        )
    )
    session.flush()
    payload = search.search(session, workspace_id, query="keep me")
    assert [item["title"] for item in payload["groups"][0]["items"]] == ["Keep me"]


def test_like_metacharacters_are_escaped(session: Session, workspace_id: str) -> None:
    make_task(session, workspace_id, "100% coverage")
    make_task(session, workspace_id, "1000 percent")
    payload = search.search(session, workspace_id, query="100%")
    assert [item["title"] for item in payload["groups"][0]["items"]] == ["100% coverage"]

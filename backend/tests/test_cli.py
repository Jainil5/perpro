"""Tests for the operator entry points: ``python -m app.cli`` and Alembic.

The CLI runs in-process (:func:`app.cli.main`) against a scratch SQLite file, so a
command and a ``TestClient`` request in the same test talk to the same database - that
is the property ARCHITECTURE.md relies on ("the CLI can never point at a different
database than the API is serving").
"""

from __future__ import annotations

import datetime as dt
import json
import os
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app import cli
from app.core.config import reload_settings
from app.core.db import dispose_engines, get_engine, session_scope
from app.main import create_app
from app.models import Notification, Project, Task, Workspace, WorkspaceMember
from app.services import context
from tests.helpers import make_project, make_task

#: ``alembic upgrade head`` leaves exactly this revision behind
HEAD = "0002"


@pytest.fixture
def scratch(
    monkeypatch: pytest.MonkeyPatch, isolated_database: dict[str, str]
) -> Iterator[Callable[[str], Path]]:
    """Point the settings cache at a second, empty database file inside ``tmp_path``.

    Returns a factory taking the file name and giving back its path, so one test can
    try ``migrate`` on a virgin file and ``stamp`` on another.
    """
    original = os.environ["MYOS_DATABASE_URL"]
    directory = Path(isolated_database["file"]).parent

    def point_at(name: str) -> Path:
        path = directory / name
        assert not path.exists(), path
        monkeypatch.setenv("MYOS_DATABASE_URL", f"sqlite:///{path}")
        reload_settings()
        dispose_engines()
        return path

    yield point_at

    if os.environ["MYOS_DATABASE_URL"] != original:
        monkeypatch.setenv("MYOS_DATABASE_URL", original)
        reload_settings()
        dispose_engines()


@pytest.fixture
def run(capsys: pytest.CaptureFixture[str]) -> Callable[[list[str]], tuple[int, str, str]]:
    """``main(argv)`` plus its captured stdout/stderr."""

    def invoke(argv: list[str]) -> tuple[int, str, str]:
        code = cli.main(argv)
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return invoke


def tables() -> set[str]:
    return set(sa.inspect(get_engine()).get_table_names())


def _count(session: Session, model) -> int:
    return int(session.scalar(sa.select(sa.func.count()).select_from(model)) or 0)


def revision() -> str | None:
    with get_engine().connect() as connection:
        return connection.execute(sa.text("select version_num from alembic_version")).scalar()


# ----------------------------------------------------------------------- init-db


def test_init_db_creates_the_schema_and_the_workspace(run, isolated_database) -> None:
    code, out, err = run(["init-db"])
    assert code == 0 and err == ""
    assert out.strip() == f"schema ready at {isolated_database['url']} (workspace: default)"
    assert "tasks" in tables()
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        assert workspace.slug == "default"
        # the CLI is what gives a fresh install an owner
        assert workspace.currency == "INR" and workspace.timezone == "Asia/Kolkata"
        owner = session.scalar(
            sa.select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id)
        )
        assert owner is not None and owner.role == "owner"


def test_init_db_is_safe_to_repeat(run) -> None:
    assert run(["init-db"])[0] == 0
    assert run(["init-db"])[0] == 0
    assert run(["init-db"])[1].count("schema ready") == 1
    with session_scope() as session:
        assert len(list(session.scalars(sa.select(Workspace)))) == 1


def test_init_db_stamp_leaves_alembic_at_head(run) -> None:
    code, out, _ = run(["init-db", "--stamp"])
    assert code == 0
    assert out.strip().endswith("(workspace: default, stamped at head)")
    assert revision() == HEAD
    # ...so a later migrate has nothing left to do
    code, out, _ = run(["migrate"])
    assert code == 0 and out.strip().startswith("upgraded to head at")
    assert revision() == HEAD


# ----------------------------------------------------------------------- migrate


def test_migrate_builds_the_schema_on_an_empty_file(run, scratch) -> None:
    path = scratch("migrated.db")
    code, out, _ = run(["migrate"])
    assert code == 0
    assert out.strip() == f"upgraded to head at sqlite:///{path}"
    assert revision() == HEAD
    assert {
        "workspaces",
        "users",
        "workspace_members",
        "projects",
        "tasks",
        "task_dependencies",
        "tags",
        "task_tags",
        "notes",
        "note_relations",
        "note_tags",
        "companies",
        "contacts",
        "contact_tags",
        "milestones",
        "goals",
        "reminders",
        "notifications",
        "activity_logs",
        "alembic_version",
    } <= tables()


def test_a_migrated_database_serves_the_api_without_bootstrap(scratch) -> None:
    """``create_app(bootstrap=False)`` only works if the migration really created rows."""
    scratch("served.db")
    assert cli.main(["migrate"]) == 0
    dispose_engines()
    with TestClient(create_app(bootstrap=False)) as client:
        assert client.get("/api/v1/health").json()["status"] == "ok"
        created = client.post("/api/v1/tasks", json={"title": "Migrated"})
        assert created.status_code == 201, created.text
        assert client.get("/api/v1/tasks").json()["total"] == 1


def test_migrate_is_idempotent_and_accepts_a_revision(run, scratch) -> None:
    scratch("twice.db")
    assert run(["migrate"])[0] == 0
    second = run(["migrate"])[0]
    assert second == 0 and revision() == HEAD
    assert run(["migrate", HEAD])[0] == 0


def test_stamp_marks_without_creating_business_tables(run, scratch) -> None:
    scratch("stamped.db")
    code, out, _ = run(["stamp"])
    assert code == 0
    assert out.strip().startswith("stamped head at")
    assert tables() == {"alembic_version"}
    assert revision() == HEAD


# -------------------------------------------------------------------------- seed


def test_seed_prints_counts_then_skips(run) -> None:
    code, out, err = run(["seed"])
    assert code == 0 and err == ""
    created = json.loads(out.removeprefix("seeded: ").strip())
    assert created["projects"] == 8 and created["tasks"] == 49
    assert created["milestones"] == 10 and created["notes"] == 12
    assert created["notifications"] == 8 and created["activity_logs"] == 17

    code, out, _ = run(["seed"])
    assert code == 0
    assert out.strip() == "demo data already present - nothing to do"
    with session_scope() as session:
        assert len(list(session.scalars(sa.select(Task)))) == 49


def test_the_cli_seed_is_visible_to_the_api(run) -> None:
    """Same database, same rows: the CLI commits, the API reads."""
    assert run(["seed"])[0] == 0
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/projects").json()["total"] == 8
        board = client.get("/api/v1/dashboard", params={"today": "2026-11-21"}).json()
        assert board["tasks"]["open"] > 0


def test_seed_today_anchors_the_demo_dates(run) -> None:
    code, out, _ = run(["seed", "--today", "2027-03-03"])
    assert code == 0 and out.startswith("seeded:")
    with session_scope() as session:
        task = session.scalar(sa.select(Task).where(Task.title == "Design tenant schema"))
        assert task is not None
        assert task.due_date == dt.date(2027, 3, 3) - dt.timedelta(days=38)


def test_seed_can_skip_the_notification_refresh(run) -> None:
    code, out, _ = run(["seed", "--no-notify"])
    assert code == 0
    created = json.loads(out.removeprefix("seeded: ").strip())
    assert "notifications" not in created  # nothing created, so nothing counted
    with session_scope() as session:
        assert _count(session, Notification) == 0
        assert _count(session, Task) == 49


def test_seed_reset_is_guarded_then_allowed(run, monkeypatch: pytest.MonkeyPatch) -> None:
    assert run(["seed"])[0] == 0
    code, out, err = run(["seed", "--reset"])
    assert code == 2 and out == ""
    assert "MYOS_ALLOW_DEMO_RESET" in err
    with session_scope() as session:
        assert len(list(session.scalars(sa.select(Project)))) == 8  # refused before deleting

    # --force is the documented escape hatch
    assert run(["seed", "--reset", "--force"])[0] == 0
    with session_scope() as session:
        assert len(list(session.scalars(sa.select(Project)))) == 8

    monkeypatch.setenv("MYOS_ALLOW_DEMO_RESET", "1")
    reload_settings()
    code, out, _ = run(["seed", "--reset"])
    assert code == 0
    deleted = json.loads(out.split("deleted: ", 1)[1].strip())
    created = json.loads(out.removeprefix("seeded: ").split("deleted: ", 1)[0].strip())
    assert deleted["projects"] == 8 and created["projects"] == 8
    assert deleted["task_tags"] == 50 and deleted["note_relations"] == 8


def test_seed_reset_keeps_user_rows(run, monkeypatch: pytest.MonkeyPatch) -> None:
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        scope = workspace.id
        make_project(session, scope, "My own work")
        make_task(session, scope, "My own task")
        session.commit()

    monkeypatch.setenv("MYOS_ALLOW_DEMO_RESET", "1")
    reload_settings()
    assert run(["seed", "--reset"])[0] == 0

    with session_scope() as session:
        names = list(session.scalars(sa.select(Project.name).order_by(Project.name)))
        assert "My own work" in names
        assert "OrderBook CRM" in names and names.count("OrderBook CRM") == 1
        assert list(session.scalars(sa.select(Task.title).where(Task.title == "My own task")))


# ----------------------------------------------------------------------- notify


def test_notify_derives_then_settles(run) -> None:
    with session_scope() as session:
        scope = context.resolve_workspace(session).id
        make_task(session, scope, "Long overdue", due_date=dt.date(2026, 10, 1))
        session.commit()

    code, out, _ = run(["notify", "--today", "2026-11-21"])
    assert code == 0
    assert out.strip() == "notifications: 1 created, 0 resolved, 1 open"
    assert run(["notify", "--today", "2026-11-21"])[1].strip() == (
        "notifications: 0 created, 0 resolved, 1 open"
    )


def test_notify_accepts_the_injected_date(run) -> None:
    assert run(["notify"])[0] == 0
    assert run(["notify", "--today", "2026-11-21"])[0] == 0


# ------------------------------------------------------------------------ export


def test_export_writes_the_documented_dump(run, tmp_path: Path) -> None:
    assert run(["seed"])[0] == 0
    destination = tmp_path / "dump.json"
    code, out, _ = run(["export", str(destination)])
    assert code == 0
    assert out.startswith(f"wrote {destination} (")
    assert out.strip().endswith("rows across 19 tables)")

    body = json.loads(destination.read_text(encoding="utf-8"))
    assert set(body) == {"exported_at", "workspace", "tables"}
    assert body["exported_at"].endswith("Z")
    assert body["workspace"]["slug"] == "default"
    assert len(body["tables"]["tasks"]) == 49
    assert len(body["tables"]["workspaces"]) == 1


def test_export_creates_missing_directories_and_accepts_one(run, tmp_path: Path) -> None:
    directory = tmp_path / "exports"
    assert run(["export", str(directory / "deep" / "my.json")])[0] == 0
    assert (directory / "deep" / "my.json").exists()

    # a directory argument gets the dated file name
    code, out, _ = run(["export", str(directory)])
    assert code == 0
    written = sorted(path.name for path in directory.glob("*.json"))
    assert written == [f"myos-export-{dt.date.today().isoformat()}.json"]


def test_cli_export_matches_get_export(run, tmp_path: Path) -> None:
    destination = tmp_path / "dump.json"
    assert run(["seed", "--today", "2026-11-21"])[0] == 0
    assert run(["export", str(destination)])[0] == 0
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/export")
        assert response.status_code == 200
    assert json.loads(destination.read_text(encoding="utf-8"))["tables"] == response.json()["tables"]


# ------------------------------------------------------------------ meta and url


def test_meta_prints_counts_then_enums(run) -> None:
    with session_scope() as session:
        scope = context.resolve_workspace(session).id
        make_task(session, scope, "Counted", due_date=dt.date(2026, 10, 1))
        session.commit()

    code, out, _ = run(["meta"])
    assert code == 0
    lines = out.strip().splitlines()
    assert len(lines) == 2
    first, second = (json.loads(line) for line in lines)
    assert set(first) == {"workspace", "version", "counts"}
    assert first["workspace"] == "default" and first["version"].count(".") == 2
    assert first["counts"]["tasks"] == 1 and first["counts"]["tasks_overdue"] == 1
    assert set(second) == {"enums"}
    assert second["enums"]["task.status"] == ["todo", "in_progress", "blocked", "done", "dropped"]


def test_url_prints_the_resolved_configuration(run, isolated_database) -> None:
    code, out, _ = run(["url"])
    assert code == 0
    lines = out.strip().splitlines()
    assert lines == [
        isolated_database["url"],
        "ai: off (openai)",
        "demo reset: blocked",
    ]


def test_ai_and_reset_flags_show_up_in_url(run, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MYOS_AI_ENABLED", "1")
    monkeypatch.setenv("MYOS_AI_PROVIDER", "ollama")
    monkeypatch.setenv("MYOS_ALLOW_DEMO_RESET", "1")
    reload_settings()
    try:
        lines = run(["url"])[1].strip().splitlines()
    finally:
        monkeypatch.undo()
        reload_settings()
    assert lines[1:] == ["ai: on (ollama)", "demo reset: allowed"]


# ------------------------------------------------------------------- argparse io


def test_missing_or_unknown_commands_exit_with_status_two(run, capsys) -> None:
    for argv in ([], ["nope"], ["seed", "--nope"]):
        with pytest.raises(SystemExit) as info:
            cli.main(argv)
        assert info.value.code == 2, argv
        assert capsys.readouterr().err.strip()  # argparse usage went to stderr


def test_version_flag_prints_and_exits_zero(capsys) -> None:
    with pytest.raises(SystemExit) as info:
        cli.main(["--version"])
    assert info.value.code == 0
    assert capsys.readouterr().out.strip() == "MyOS backend 0.1.0"


def test_a_bad_today_is_rejected_before_touching_the_database(run) -> None:
    with pytest.raises(SystemExit) as info:
        cli.main(["seed", "--today", "21-11-2026"])
    assert "YYYY-MM-DD" in str(info.value)
    assert run(["seed"])[0] == 0  # the file is still usable

    with pytest.raises(SystemExit) as notify_info:
        cli.main(["notify", "--today", "not-a-date"])
    assert "YYYY-MM-DD" in str(notify_info.value)

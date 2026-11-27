"""Pytest fixtures.

Every test gets its own SQLite file: ``MYOS_DATABASE_URL`` is pointed at ``tmp_path``
before anything reads the settings, then the cached settings and engines are dropped so
the app, the services and Alembic all rebuild around it. Nothing writes to
``backend/data``, and the ``no_network`` guard makes an outbound connection fail the test
that attempts it - the suite is offline by construction, not by convention.

Dates follow one rule, because a derived value is only as reproducible as the day it was
measured on: either inject that day (``?today=``, ``today=DAY``) into *every* call the
assertion reads - including the read that returns the derived field - or build the fixture
from the day the server will use anyway (``helpers.clock_day``).  A test that mixes the two
passes only until the calendar moves.
"""

from __future__ import annotations

import datetime as dt
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any, NoReturn

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import reload_settings
from app.core.db import dispose_engines, init_db, session_scope
from app.services import context

#: the reference date the tests pin everything to (a Saturday).  Every date derived from
#: it has to be *read* with ``today=`` too - and a route that takes no override at all
#: (``POST /tasks``, ``GET /tasks/{id}``, ``GET /projects/{id}``, ``POST /milestones``,
#: ``meta``) has to be fed from the clock instead: see ``helpers.clock_day``.
TODAY = dt.date(2026, 11, 21)


@pytest.fixture(autouse=True)
def isolated_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[dict[str, str]]:
    """A private database file per test, with the caches rebuilt around it."""
    database = tmp_path / "myos-test.db"
    monkeypatch.setenv("MYOS_DATABASE_URL", f"sqlite:///{database}")
    monkeypatch.setenv("MYOS_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("MYOS_WORKSPACE", "default")
    monkeypatch.setenv("MYOS_TIMEZONE", "Asia/Kolkata")
    monkeypatch.setenv("MYOS_CURRENCY", "INR")
    monkeypatch.setenv("MYOS_AI_ENABLED", "0")
    monkeypatch.setenv("MYOS_ALLOW_DEMO_RESET", "0")
    monkeypatch.delenv("MYOS_AI_PROVIDER", raising=False)

    settings = reload_settings()
    dispose_engines()
    init_db()
    yield {"url": settings.resolved_database_url, "file": str(database)}
    dispose_engines()
    reload_settings()


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """``TestClient`` talks ASGI, so an actual socket in this suite would be a bug.

    Blocking ``socket.connect`` and ``getaddrinfo`` catches every outbound request
    (``httpx``, ``urllib``, a provider SDK) while leaving SQLite, ``tmp_path`` and
    capsys alone. A Phase 2 test that needs a fake upstream must opt out explicitly.
    """

    def blocked(*_args: Any, **_kwargs: Any) -> NoReturn:
        raise AssertionError("a test tried to open a network connection")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


@pytest.fixture
def session() -> Iterator[Session]:
    """One unit of work, rolled back implicitly by dropping the file with tmp_path."""
    with session_scope() as current:
        yield current


@pytest.fixture
def workspace_id(session: Session) -> str:
    """The workspace id, committed so a ``TestClient`` connection can see it."""
    workspace = context.resolve_workspace(session)
    session.commit()
    return workspace.id


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A TestClient over a freshly built app (lifespan creates the schema + workspace)."""
    from app.main import create_app

    with TestClient(create_app()) as current:
        yield current


@pytest.fixture
def today() -> dt.date:
    return TODAY

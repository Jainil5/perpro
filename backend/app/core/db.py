"""Database engine, session factory and the declarative Base.

Design notes
------------
* The engine is created lazily from :mod:`app.core.config` so tests (and the CLI)
  can point ``MYOS_DATABASE_URL`` at a temporary file and rebuild everything.
* SQLite gets ``PRAGMA foreign_keys=ON`` (real FK enforcement) and WAL journaling
  (concurrent reads while the Next.js proxy is polling) on every new connection.
* Only PostgreSQL-portable column types are used across the models
  (``sa.JSON``, ``sa.DateTime(timezone=True)``, ``sa.Numeric``, plain text/ints).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.event import listens_for
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core import json as zjson
from app.core.config import get_settings

NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base for every MyOS model.

    The ``MetaData`` carries a deterministic naming convention so that Alembic
    autogenerate, primary-key/FK/index/check names and therefore SQLite and
    PostgreSQL schemas stay identical.
    """

    metadata = sa.MetaData(naming_convention=NAMING_CONVENTION)


def _is_file_sqlite(url: str) -> bool:
    return url.startswith("sqlite") and ":memory:" not in url and url not in ("sqlite://", "sqlite+pysqlite://")


def _attach_sqlite_pragmas(engine: Engine, url: str) -> None:
    """FK enforcement + WAL on SQLite; a no-op on PostgreSQL/MySQL."""
    if not url.startswith("sqlite"):
        return
    wal = _is_file_sqlite(url)

    @listens_for(engine, "connect")
    def _set_pragmas(dbapi_connection, _record) -> None:  # pragma: no cover - driver callback
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            if wal:
                cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
        finally:
            cursor.close()


_engines: dict[str, Engine] = {}


def get_engine(url: str | None = None) -> Engine:
    """Engine for the current configuration (cached per URL)."""
    target = url if url is not None else get_settings().resolved_database_url
    engine = _engines.get(target)
    if engine is None:
        kwargs: dict = {
            "future": True,
            # sa.JSON columns (activity_logs.payload) go through the one encoder the
            # API uses, so dates/Decimals/Enums inside a payload never break an INSERT
            "json_serializer": zjson.dumps,
        }
        if target.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
            if ":memory:" in target:
                from sqlalchemy.pool import StaticPool

                kwargs["poolclass"] = StaticPool
        else:
            kwargs["pool_pre_ping"] = True
        engine = sa.create_engine(target, **kwargs)
        _attach_sqlite_pragmas(engine, target)
        _engines[target] = engine
    return engine


#: Not bound at import time: every session binds itself to the engine for the
#: *current* configuration, so a test fixture can swap ``MYOS_DATABASE_URL``
#: without re-importing anything. Use :func:`get_session` / :func:`session_scope`.
SessionLocal: sessionmaker[Session] = sessionmaker(
    class_=Session, autoflush=False, expire_on_commit=False
)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one unit of work per request."""
    session = SessionLocal(bind=get_engine())
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope(commit: bool = True) -> Iterator[Session]:
    """Session for services, the CLI and the tests (outside the request cycle)."""
    session = SessionLocal(bind=get_engine())
    try:
        yield session
        if commit:
            session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Bootstrap path for demos and tests: create any missing table.

    Alembic remains the documented production path (``python -m alembic upgrade head``);
    this is ``create_all(checkfirst=True)`` for local/demo use.
    """
    import app.models  # noqa: F401  - register every mapping on Base.metadata

    settings = get_settings()
    if settings.sqlite_file is not None:
        settings.sqlite_file.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(get_engine(), checkfirst=True)


def dispose_engines() -> None:
    """Close pooled connections and forget cached engines (tests / CLI)."""
    for engine in _engines.values():
        engine.dispose()
    _engines.clear()

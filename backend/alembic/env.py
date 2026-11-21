"""Alembic environment: one URL source for the app and the migrations.

``MYOS_DATABASE_URL`` (see :mod:`app.core.config`) decides the target, so
``python -m alembic upgrade head`` can never drift away from the running app. Relative
SQLite paths are anchored at ``backend/`` exactly like the engine is, which is why
``alembic upgrade head`` and ``uvicorn app.main:app`` open the same file.

Both modes work:

* **online** - migrations run on a real connection built by :func:`app.core.db.get_engine`,
  so the SQLite pragmas (``foreign_keys=ON``, WAL) apply to DDL as well as DML.
* **offline** - ``alembic upgrade head --sql`` prints the DDL instead of executing it,
  which is what you review before pointing this at PostgreSQL.

``-x url=postgresql+psycopg://...`` overrides everything for a one-off run.
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

import sqlalchemy as sa
from alembic import context
from sqlalchemy.engine import Connection

#: make ``app`` importable whatever the current working directory is
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core import db as app_db  # noqa: E402 - Base, metadata and the engine factory
from app.core.config import get_settings  # noqa: E402

import app.models  # noqa: E402,F401 - every model must be registered on the metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = app_db.Base.metadata


def database_url() -> str:
    """``-x url=...`` wins, otherwise the application's own resolved URL."""
    override = context.get_x_argument(as_dictionary=True).get("url")
    if override:
        return override
    return get_settings().resolved_database_url


def shared_options() -> dict[str, object]:
    """Dialect quirks, identical in offline and online mode."""
    url = database_url()
    return {
        "target_metadata": target_metadata,
        "naming_convention": app_db.NAMING_CONVENTION,
        "compare_type": True,
        # SQLite cannot ALTER columns in place, so migrations rebuild the table
        "render_as_batch": url.startswith("sqlite"),
    }


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **shared_options(),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = database_url()
    database = sa.make_url(url).database
    if url.startswith("sqlite") and database and ":memory:" not in database:
        # a fresh install: the directory has to exist before SQLite can open a file
        Path(database).expanduser().parent.mkdir(parents=True, exist_ok=True)
    engine = app_db.get_engine(url)
    connection: Connection
    with engine.connect() as connection:
        context.configure(connection=connection, **shared_options())
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

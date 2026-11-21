"""``python -m app.cli`` - the operator entry points (ARCHITECTURE.md §2).

::

    python -m app.cli init-db [--stamp]           create the schema (create_all bootstrap)
    python -m app.cli migrate [revision]          alembic upgrade head | <revision>
    python -m app.cli stamp [revision]            mark the schema without running migrations
    python -m app.cli seed [--today D] [--reset] [--no-notify]
    python -m app.cli notify [--today D]      refresh derived notifications
    python -m app.cli export PATH             write the JSON dump (same body as GET /export)
    python -m app.cli meta                    enums + counts (what GET /meta returns)
    python -m app.cli url                     the resolved database URL

Every command uses the same configuration as the server: ``MYOS_DATABASE_URL`` and
friends from the environment or ``backend/.env``, so the CLI can never point at a
different database than the API is serving.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.core.config import APP_VERSION, get_settings
from app.core.db import dispose_engines, init_db, session_scope
from app.core.json import dumps
from app.models.enums import ENUMS
from app.services import context, demo, export, notifications


def _parse_date(value: str | None) -> dt.date | None:
    if value in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:  # pragma: no cover - operator typo
        raise SystemExit(f"--today must be YYYY-MM-DD (got {value!r}): {exc}") from exc


def _alembic_config() -> Any:
    """alembic.ini + the script location, imported lazily.

    ``init-db``/``seed``/``notify``/``export`` must work without Alembic installed, so
    nothing at module level imports it. The URL does not go in the config: alembic/env.py
    reads :func:`app.core.config.get_settings`, which is what keeps migrations and the
    running server on the same file.
    """
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    return config


def cmd_init_db(args: argparse.Namespace) -> int:
    init_db()
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        context.resolve_owner(session, workspace)
    if args.stamp:
        # create_all + stamp: the bootstrap path stays consistent with `alembic upgrade`
        from alembic import command

        command.stamp(_alembic_config(), "head")
    print(
        f"schema ready at {get_settings().resolved_database_url} "
        f"(workspace: {workspace.slug}{', stamped at head' if args.stamp else ''})"
    )
    return 0


def cmd_migrate(args: argparse.Namespace) -> int:
    from alembic import command

    target = args.revision or "head"
    command.upgrade(_alembic_config(), target)
    print(f"upgraded to {target} at {get_settings().resolved_database_url}")
    return 0


def cmd_stamp(args: argparse.Namespace) -> int:
    from alembic import command

    command.stamp(_alembic_config(), args.revision)
    print(f"stamped {args.revision} at {get_settings().resolved_database_url}")
    return 0


def cmd_seed(args: argparse.Namespace) -> int:
    today = _parse_date(args.today)
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        if args.reset:
            if not get_settings().allow_demo_reset and not args.force:
                print(
                    "refusing: demo reset needs MYOS_ALLOW_DEMO_RESET=1 (or --force)",
                    file=sys.stderr,
                )
                return 2
            result: dict[str, Any] = demo.reset(session, workspace.id, today=today)
        else:
            result = demo.seed(
                session, workspace.id, today=today, refresh_notifications=not args.no_notify
            )
    if result.get("skipped"):
        print("demo data already present - nothing to do")
    else:
        print("seeded:", json.dumps(result["created"], sort_keys=True))
        deleted = result.get("deleted")
        if deleted:
            print("deleted:", json.dumps(deleted, sort_keys=True))
    return 0


def cmd_notify(args: argparse.Namespace) -> int:
    today = _parse_date(args.today)
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        result = notifications.refresh(session, workspace.id, today=today)
        open_rows = len(notifications.list_notifications(session, workspace.id, limit=200)["items"])
    print(
        f"notifications: {result['created']} created, {result['resolved']} resolved, "
        f"{open_rows} open"
    )
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    with session_scope() as session:
        # exactly what ``GET /export`` returns: the active workspace, nothing else
        payload = export.export_payload(session)
    destination = Path(args.path).expanduser()
    if destination.is_dir():
        destination = destination / f"myos-export-{dt.date.today().isoformat()}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(dumps(payload), encoding="utf-8")
    rows = sum(len(table) for table in payload["tables"].values())
    print(f"wrote {destination} ({rows} rows across {len(payload['tables'])} tables)")
    return 0


def cmd_meta(_: argparse.Namespace) -> int:
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        counts = context.workspace_counts(session, workspace.id)
    print(dumps({"workspace": workspace.slug, "version": APP_VERSION, "counts": counts}))
    print(dumps({"enums": ENUMS}))
    return 0


def cmd_url(_: argparse.Namespace) -> int:
    settings = get_settings()
    print(settings.resolved_database_url)
    print(f"ai: {'on' if settings.ai_enabled else 'off'} ({settings.ai_provider})")
    print(f"demo reset: {'allowed' if settings.allow_demo_reset else 'blocked'}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description="MyOS backend administration (Phase 1)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--version", action="version", version=f"MyOS backend {APP_VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser(
        "init-db",
        help="create the schema and the workspace row (bootstrap; see also migrate/stamp)",
    )
    init.add_argument(
        "--stamp",
        action="store_true",
        help="also mark the database as being at Alembic head, so a later `migrate` is a no-op",
    )
    init.set_defaults(handler=cmd_init_db)

    migrate = sub.add_parser("migrate", help="alembic upgrade (default: head)")
    migrate.add_argument("revision", nargs="?", default=None, help="revision, e.g. 'head' or '0001'")
    migrate.set_defaults(handler=cmd_migrate)

    stamp = sub.add_parser(
        "stamp", help="mark the current schema as a revision without running migrations"
    )
    stamp.add_argument("revision", nargs="?", default="head")
    stamp.set_defaults(handler=cmd_stamp)

    seed = sub.add_parser("seed", help="insert the idempotent demo dataset")
    seed.add_argument("--today", metavar="YYYY-MM-DD", help="anchor for the relative demo dates")
    seed.add_argument("--reset", action="store_true", help="delete demo rows first, then reseed")
    seed.add_argument("--force", action="store_true", help="override the MYOS_ALLOW_DEMO_RESET guard")
    seed.add_argument("--no-notify", action="store_true", help="skip the notification refresh")
    seed.set_defaults(handler=cmd_seed)

    notify = sub.add_parser("notify", help="re-derive notifications (idempotent)")
    notify.add_argument("--today", metavar="YYYY-MM-DD")
    notify.set_defaults(handler=cmd_notify)

    exporter = sub.add_parser(
        "export", help="write the JSON dump of this workspace to PATH (or a directory)"
    )
    exporter.add_argument("path")
    exporter.set_defaults(handler=cmd_export)

    meta = sub.add_parser("meta", help="print enums and counts")
    meta.set_defaults(handler=cmd_meta)

    url = sub.add_parser("url", help="print the resolved database URL")
    url.set_defaults(handler=cmd_url)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.handler(args))
    finally:
        dispose_engines()


if __name__ == "__main__":  # pragma: no cover - console entry point
    raise SystemExit(main())

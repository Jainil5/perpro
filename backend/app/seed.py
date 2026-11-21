"""``python -m app.seed`` - the idempotent demo dataset (ARCHITECTURE.md §2).

The dataset itself lives in :mod:`app.services.demo` (routers and the CLI both call it);
this module is the thin entry point the layout names, so a fresh install can be populated
with one command:

::

    python -m app.seed            # seed once, skip if demo rows already exist
    python -m app.seed --today 2026-11-21
    python -m app.seed --reset    # needs MYOS_ALLOW_DEMO_RESET=1
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from collections.abc import Sequence

from app.core.config import get_settings
from app.core.db import dispose_engines, init_db, session_scope
from app.services import context, demo


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.seed", description=__doc__ or "")
    parser.add_argument("--today", metavar="YYYY-MM-DD", help="anchor for relative demo dates")
    parser.add_argument("--reset", action="store_true", help="delete demo rows, then reseed")
    parser.add_argument(
        "--no-notify", action="store_true", help="skip the notification refresh after seeding"
    )
    args = parser.parse_args(argv)
    day = dt.date.fromisoformat(args.today) if args.today else None

    init_db()
    with session_scope() as session:
        workspace = context.resolve_workspace(session)
        if args.reset:
            if not get_settings().allow_demo_reset:
                print("refusing: demo reset needs MYOS_ALLOW_DEMO_RESET=1", flush=True)
                return 2
            result = demo.reset(session, workspace.id, today=day)
        else:
            result = demo.seed(
                session, workspace.id, today=day, refresh_notifications=not args.no_notify
            )
    print(json.dumps(result, sort_keys=True))
    dispose_engines()
    return 0


if __name__ == "__main__":  # pragma: no cover - console entry point
    raise SystemExit(main())

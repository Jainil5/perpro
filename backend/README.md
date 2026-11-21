# MyOS backend (Phase 1)

FastAPI + SQLAlchemy 2.0 service behind the Next.js proxy. The contract is
[`docs/MYOS/API.md`](../docs/MYOS/API.md); the layout is
[`docs/MYOS/ARCHITECTURE.md`](../docs/MYOS/ARCHITECTURE.md); the schema (including the
phases that are not built yet) is [`docs/MYOS/DATA_MODEL.md`](../docs/MYOS/DATA_MODEL.md).

67 operations, one SQLite file, no external services. AI is off by default and every
insight on the dashboard is a deterministic rule.

## Quickstart

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate      # optional
pip install -r requirements.txt                     # pinned runtime + pytest
cp .env.example .env                                # optional: defaults already work
python3 -m app.cli init-db                          # schema + the `default` workspace
python3 -m app.cli seed                             # demo data (idempotent)
python3 -m uvicorn app.main:app --reload            # http://127.0.0.1:8000/api/v1/health
```

`GET /docs` is Swagger UI. `GET /` answers with a pointer to the API. The frontend never
calls this origin directly: it goes through `/api/os/*`, which forwards to `MYOS_API_URL`.

## Configuration

All settings live in `app/core/config.py` (pydantic-settings, prefix `MYOS_`, `.env` in
this directory). Every variable is optional — the defaults make the app runnable from a
fresh checkout, and no credential is ever read from source.

| Variable | Default | Notes |
|---|---|---|
| `MYOS_DATABASE_URL` | `sqlite:///./data/myos.db` | relative SQLite paths are anchored at `backend/`, so uvicorn, the CLI and pytest open the same file |
| `MYOS_DATA_DIR` | `backend/data` | created on demand |
| `MYOS_WORKSPACE` | `default` | the single Phase 1 workspace slug |
| `MYOS_TIMEZONE` / `MYOS_CURRENCY` | `Asia/Kolkata` / `INR` | reported by `GET /workspace`, editable with `PATCH /workspace` |
| `MYOS_AI_ENABLED` | `0` | `GET /health` echoes it; the UI degrades to rule-based insights |
| `MYOS_AI_PROVIDER` | `openai` | `openai` \| `ollama`; nothing in Phase 1 calls a model |
| `MYOS_ALLOW_DEMO_RESET` | `0` | `POST /demo/reset` returns 409 while it is `0` |
| `MYOS_AUTO_CREATE` | `1` | dev/test bootstrap; set `0` when Alembic owns the schema |
| `MYOS_API_PREFIX` | `/api/v1` | |

## Migrations

Alembic is the production schema path (`alembic.ini` + `alembic/`). The URL is **not** in
`alembic.ini`: `alembic/env.py` reads the same settings object the app uses.

```bash
python3 -m alembic upgrade head          # or: python3 -m app.cli migrate
python3 -m app.cli init-db --stamp       # create_all + mark head (dev shortcut)
python3 -m app.cli stamp                 # mark head only — leaves the tables missing
```

`0001` creates the Phase 1 schema and works on an empty file database; `0002` adds
`goals.project_id`. Revisions are additive and chain forever - later phases add one per phase.
Any revision that alters a table uses `op.batch_alter_table`, because SQLite cannot `ALTER`
in place: batch mode rebuilds the table on SQLite and emits a plain `ALTER` on PostgreSQL, so
the same file serves both.

## CLI

```
python3 -m app.cli init-db [--stamp]
python3 -m app.cli migrate [revision]
python3 -m app.cli stamp [revision]
python3 -m app.cli seed [--today YYYY-MM-DD] [--reset [--force]] [--no-notify]
python3 -m app.cli notify [--today YYYY-MM-DD]
python3 -m app.cli export PATH
python3 -m app.cli meta
python3 -m app.cli url
```

`--today` anchors every relative demo date, which is what makes the dataset testable.
`seed --reset` refuses (exit `2`) unless `MYOS_ALLOW_DEMO_RESET=1` or `--force`; user rows
are never touched, only `source='demo'` rows. `export PATH` writes byte-for-byte what
`GET /export` returns; a directory argument gets the dated name `myos-export-YYYY-MM-DD.json`.

## Tests

```bash
cd backend && python3 -m pytest -q          # 370 tests, all offline
```

Each test gets its own SQLite file under `tmp_path` (`isolated_database` in
`tests/conftest.py`), so nothing writes into `data/`. HTTP tests use
`fastapi.testclient.TestClient` — no server is started, no socket is opened.

| module | tests | covers |
|---|---|---|
| `test_stats.py`, `test_recurrence.py`, `test_schemas.py`, `test_importer.py` | 116 | pure logic: aggregates, rollover, validation/trimming, the tolerant JSON importer |
| `test_dashboard.py`, `test_search.py`, `test_notifications.py` | 47 | derived widgets, grouped search, dedupe-key rules |
| `test_demo.py`, `test_export.py` | 32 | demo dataset contract, JSON dump |
| `test_api_tasks.py`, `test_api_projects.py`, `test_api_notes.py`, `test_api_people.py`, `test_api_signals.py` | 138 | every endpoint: happy path, `422` detail shape, `404`, `409`, bulk, complete→rollover, project-delete cascade |
| `test_links.py` | 13 | the deep-link contract: every entity mapping on its canonical route, the missing-project guard, no `None` and no retired prefix in any href |
| `test_cli.py` | 24 | `init-db`/`migrate`/`stamp`/`seed`/`notify`/`export`/`meta`/`url` in-process |

## Docker

The root [`docker-compose.yml`](../docker-compose.yml) builds this directory as the `api`
service (`myos-api`, port 8000, named volume at `/data`). The image is `python:3.12-slim`,
runs as uid 10001, and its command is `alembic upgrade head && uvicorn app.main:app`.

```bash
docker compose up --build          # API on :8000, web on :3000
docker compose exec api python -m app.cli seed
```

## Layout

```
app/core/      config, engine/session (SQLite WAL + PRAGMA foreign_keys), error envelope, "Z" JSON
app/models/    SQLAlchemy 2.0 typed mappings, one module per domain, enum CHECK constraints
app/schemas/   Pydantic v2 request/response models (`extra="forbid"`, tolerant input coercion)
app/api/v1/    thin routers: resolve → call a service → respond
app/services/  all business logic: stats, dashboard, search, links, activity, notifications, demo, export
app/seed.py    the idempotent demo dataset
app/cli.py     operator entry points
alembic/       migrations (0001 + 0002 = Phase 1)
tests/         unit + TestClient API tests
data/          SQLite file and exports (gitignored)
```

## Behaviour worth knowing

* Timestamps leave this process as `...Z`; dates are `YYYY-MM-DD` or `null`; ids are
  server-generated UUID4 strings (a client-supplied `id` in a body is a `422`).
* Lists are `{"items": [...], "total": n}`. The exceptions are the ones API.md names:
  `/tasks` adds `limit`/`offset`, `/notes` adds `categories`, `/notifications` returns
  `{"items", "unread"}`, `/note-tags` returns a bare array.
* `?today=YYYY-MM-DD` is accepted by every derived endpoint, so the whole API is
  date-injectable without mocking a clock.
* Every write appends an `activity_logs` row in the same transaction. `GET` requests never
  create notifications; that happens in `POST /notifications/refresh` (or `app.cli notify`).
* Errors always use `{"error": {"code", "message", "details"}}`. Statuses are limited to
  400/404/409/422/500, so a wrong HTTP method on a known path answers `404 not_found`
  (`"method not allowed"`) rather than a bare `405` — API.md's status table has no 405.
* A missing FK target is a `422` (`"project_id not found"`), never a silent `null`. Goals
  work the same way as tasks: `project_id` is optional, the response carries the trimmed
  `project` object, and deleting a project leaves the goal with `project_id: null`.
* Every `href` the API emits (activity, notifications, dashboard insights, search) comes from
  one function, `app/services/links.py::href_for`, which only ever returns routes the frontend
  actually has — see DATA_MODEL.md §6 "Deep links".
* `POST /demo/reset` returns the same body as `POST /demo/seed`
  (`{"created": {...}, "skipped": false}`); the per-table delete counts are printed by
  `python -m app.cli seed --reset`, which is where an operator needs them.

Phase 1 has no integrations and no model calls, so the files ARCHITECTURE.md §2 lists for
those phases — `app/core/security.py` (token vault) and `app/services/assistant.py` — are
deliberately not present yet. `MYOS_AI_*` is read, reported by `/health`, and otherwise
unused.

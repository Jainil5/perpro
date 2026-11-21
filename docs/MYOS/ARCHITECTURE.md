# MyOS — Architecture

MyOS is a modular personal + business operating system. It lives in this repository next to the
existing PerPro app and is reachable at `/os`.

## 1. Shape of the system

```
┌────────────────────────── browser ──────────────────────────┐
│  Next.js 15 App Router (TypeScript, Tailwind, shadcn/ui)    │
│  app/(os)/…  /os  /os/projects  /os/tasks  /os/notes  …     │
└───────────────┬───────────────────────────────┬─────────────┘
                │ typed client lib/os/*         │ route handlers
                ▼                               ▼
      app/api/os/[...path]/route.ts   (server-side proxy only)
                │  strips secrets, never forwards browser tokens
                ▼
        FastAPI (Python 3.12)  /api/v1
        └ routers → services → SQLAlchemy models → SQLite
```

* The frontend **never** talks to the Python server directly. Every request goes through the
  Next.js proxy at `/api/os/*`, which forwards to `MYOS_API_URL` (default
  `http://127.0.0.1:8000`). This keeps third-party credentials (Google, Stripe, database URLs)
  server-side forever, as required by the security section of the spec.
* One SQLite file per install under `backend/data/myos.db` (`MYOS_DATABASE_URL` overrides).
  Everything is accessed through SQLAlchemy 2.0 typed models, so PostgreSQL is a connection
  string change plus one Alembic migration.

## 2. Repository layout

```
app/(perpro)/…        existing PerPro routes, moved into a route group so MyOS can have its
                      own shell. URLs are unchanged (/, /tasks, /projects, /notes, …).
app/(os)/layout.tsx   MyOS shell: sidebar, top bar, global search, quick create, theme
app/(os)/os/page.tsx              dashboard (PERSONAL → Overview)
app/(os)/os/projects/page.tsx     project list
app/(os)/os/projects/[id]/page.tsx project detail: next action, tasks, milestones
app/(os)/os/tasks/page.tsx        all tasks: list + kanban, filters
app/(os)/os/notes/page.tsx        knowledge hub: categories, tags, markdown editor
app/(os)/os/contacts/page.tsx     contacts + companies (people directory)
app/(os)/os/search/page.tsx       global search results
app/(os)/os/notifications/page.tsx      unified notifications + reminders
app/(os)/os/settings/page.tsx     workspace, theme, demo data, export, API status
app/(os)/os/roadmap/page.tsx      honest phase tracker for not-yet-built modules
app/api/os/[...path]/route.ts     proxy to FastAPI

components/os/ui/*    shadcn/ui primitives (button, card, dialog, input, select, tabs, …)
components/os/*       MyOS app components (sidebar, topbar, task rows, modals, widgets)
lib/os/client.ts      typed fetch wrapper + error normalisation
lib/os/hooks.ts       useResources/useCreate/useUpdate/useDelete (loading/error/empty state)
lib/os/types.ts       TS mirrors of the API payloads
lib/os/format.ts      date/currency/relative-time helpers

backend/app/main.py   app factory, router registration, health
backend/app/core/     config (env), db engine/session, errors
                      (token vault for OAuth/DB credentials arrives with Phase 4 integrations)
backend/app/models/   SQLAlchemy declarative models (one module per domain)
backend/app/schemas/  Pydantic v2 request/response models
backend/app/api/v1/   thin routers: validate → call service → respond
backend/app/services/ business logic: stats, dashboard, search, activity, notifications, demo
backend/app/seed.py   idempotent demo data
backend/app/cli.py    init-db | migrate | stamp | seed | notify | export | meta | url
backend/alembic/      migrations (one per phase)
backend/tests/        pytest: unit (logic) + API (TestClient)
docs/MYOS/            ARCHITECTURE.md, API.md, DATA_MODEL.md
```

## 3. Conventions

**Backend**
* Pydantic v2 for every request body; unknown fields rejected. Datetimes are timezone-aware UTC
  ISO-8601 in JSON; dates are `YYYY-MM-DD` strings or `null`.
* IDs are UUID4 strings generated server-side, never by the client.
* Routers contain no business logic — logic lives in `services/` so it is unit-testable.
* Every mutating endpoint writes an `activity_logs` row in the same transaction.
* Errors: `{"error": {"code": "...", "message": "...", "details": [...]}}` with a correct HTTP
  status. Validation → 422, unknown id → 404, rule violation → 409.
* Money, dates and percentages are computed in Python, never in SQL string manipulation.

**Frontend**
* Client components under `app/(os)`; no server-side data fetching (the API is local-first and
  the same data must work offline-ish with instant revalidation).
* Every screen renders four states: loading, empty, error, data.
* Tailwind tokens come from CSS variables so light/dark is a class swap, not a rewrite.
* Reuse `components/os/ui/*`; never inline a one-off button style.

## 4. Theming

`app/(os)/layout.tsx` mounts `<div class="os-root">` (dark) or `<div class="os-root os-light">`
with the choice persisted in `localStorage` under `myos.theme` and initialised from
`prefers-color-scheme`. MyOS token variables (`--os-*`) are defined **inside** `.os-root`
(see `app/os.css`) so the PerPro design tokens in `app/globals.css` are untouched.
Tailwind maps the tokens to semantic utilities (`bg-card`, `text-muted-foreground`,
`border-os`, …) exactly like shadcn/ui does.

## 5. AI (optional by design)

`backend/app/services/assistant.py` talks to an OpenAI-compatible endpoint or Ollama chosen by
`MYOS_AI_PROVIDER`. If `MYOS_AI_ENABLED=0` (default) every AI affordance degrades to a
deterministic local fallback: the UI shows rule-based insights and the assistant panel explains
how to switch it on. No core screen depends on a model being available. When enabled, tool
calls operate through the same services the UI uses, so the assistant can only do what the
database already allows, and consequential actions require an explicit confirmation step.

## 6. Phasing

Phase 1 (this build) is implemented end to end: foundation, dashboard, tasks, projects, notes,
people, global search, notifications, activity, settings, demo data, tests, Docker.
Phases 2–6 (career, CRM, finance, integrations, business analytics, AI automation) are specified
in `docs/MYOS/DATA_MODEL.md` and surfaced in the sidebar as roadmap links rather than fake
screens.

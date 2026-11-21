# MyOS — Architecture

MyOS is a modular personal + business operating system. It is not a separate app: **PerPro *is*
the OS**, and the MyOS screens hold the canonical URLs (`/`, `/tasks`, `/projects`, `/notes`, …).
The original PerPro Supabase screens that those three engines duplicated are preserved, untouched,
under `/legacy/*`. There is one Next.js app, one shell and one route tree.

## 0. Route map

| URL | Screen | Store |
|---|---|---|
| `/` | Personal dashboard (MyOS `DashboardView`) | FastAPI + SQLite |
| `/tasks`, `/projects`, `/projects/[id]`, `/notes` | MyOS task / project / knowledge screens | FastAPI + SQLite |
| `/contacts`, `/goals` | People, Goals | FastAPI + SQLite |
| `/search`, `/notifications`, `/activity`, `/settings`, `/roadmap` | System screens | FastAPI + SQLite |
| `/inbox`, `/meetings`, `/news` | PerPro-only screens (never duplicated) | Supabase via `/api/db/*` |
| `/legacy` | Index of the preserved Supabase screens | Supabase |
| `/legacy/today`, `/legacy/tasks`, `/legacy/projects`, `/legacy/projects/[id]`, `/legacy/notes` | The five original PerPro screens | Supabase via `/api/db/*` |

`next.config.mjs` issues **308 redirects** for the retired prefix: `/os` → `/` and
`/os/:path*` → `/:path*`. No `app/(os)` route folder exists any more. Because rows already in
SQLite (and any backend that has not been redeployed) still carry stored `/os/…` hrefs,
`osHref()` in `lib/os/format.ts` normalises both forms at render time — that normaliser is
permanent, not a migration shim.

## 1. Shape of the system

```
┌────────────────────────── browser ──────────────────────────┐
│  Next.js 15 App Router (TypeScript, Tailwind, shadcn/ui)    │
│  app/(perpro)/…  /  /tasks  /projects  /notes  /legacy/…    │
│  components/Shell.tsx — the one chrome, nav from lib/os/nav │
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
app/layout.tsx        <html>/<body>, globals.css
app/(perpro)/layout.tsx  one layout for the whole app: theme script, os.css, metadata
app/(perpro)/page.tsx              dashboard (PERSONAL → Today), mounts DashboardView
app/(perpro)/DashboardView.tsx     the dashboard itself (not a route, just colocated)
app/(perpro)/projects/page.tsx     project list
app/(perpro)/projects/[id]/page.tsx project detail: next action, tasks, milestones
app/(perpro)/tasks/page.tsx        all tasks: list + kanban, filters
app/(perpro)/notes/page.tsx        knowledge hub: categories, tags, markdown editor
app/(perpro)/contacts/page.tsx     contacts + companies (people directory)
app/(perpro)/goals/page.tsx        goals
app/(perpro)/search/page.tsx       global search results
app/(perpro)/notifications/page.tsx      unified notifications + reminders
app/(perpro)/settings/page.tsx     workspace, theme, demo data, export, API status
app/(perpro)/roadmap/page.tsx      honest phase tracker for not-yet-built modules
app/(perpro)/inbox|meetings|news   PerPro screens, still Supabase, unchanged
app/(perpro)/legacy/page.tsx       index of the preserved Supabase screens
app/(perpro)/legacy/{today,tasks,projects,projects/[id],notes}
                      the five original PerPro Supabase screens; each carries a
                      LegacyBanner pointing at its live equivalent
app/api/os/[...path]/route.ts     proxy to FastAPI
app/os.css            the `.os-root` token contract (imported by the layout)

components/Shell.tsx  the single chrome: grouped sidebar (desktop) / top bar +
                      slide-over drawer (mobile), ⌘K palette, toasts, quick create
components/CommandPalette.tsx  ⌘K: destinations come from lib/os/nav, capture → Inbox
components/LegacyBanner.tsx    hairline notice on the /legacy/* screens
components/os/ui/*    shadcn/ui primitives (button, card, dialog, input, select, tabs, …)
components/os/*       MyOS app components (task rows, dialogs, widgets, search palette)
lib/os/nav.ts         the nav model: PERSONAL / FINANCE / BUSINESS / SYSTEM
lib/os/client.ts      typed fetch wrapper + error normalisation
lib/os/hooks.ts       useResources/useCreate/useUpdate/useDelete (loading/error/empty state)
lib/os/types.ts       TS mirrors of the API payloads
lib/os/format.ts      date/currency/relative-time helpers + osHref() link normaliser

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
* Client components under `app/(perpro)`; no server-side data fetching (the API is local-first and
  the same data must work offline-ish with instant revalidation). Each route folder keeps its
  `page.tsx` plus a colocated `<Name>View.tsx`; only `page.tsx` becomes a URL.
* One chrome only: `components/Shell.tsx`. It renders `lib/os/nav.ts` in the desktop sidebar and in
  the mobile slide-over drawer, mounts the ⌘K palette, the quick-create dialogs and the toast layer.
* Every screen renders four states: loading, empty, error, data.
* Tailwind tokens come from CSS variables so light/dark is a class swap, not a rewrite.
* Reuse `components/os/ui/*`; never inline a one-off button style.
* Never hard-code an `/os/...` href: routes are canonical (`/tasks`, `/projects/<id>`, …) and any
  href that arrives from the API goes through `osHref()`.

## 4. Theming

There is a single shell, so the token contract lives there: `app/(perpro)/layout.tsx` imports
`app/os.css` and renders the `OsThemeScript` before the markup, then `components/Shell.tsx` mounts
`<div class="os-root">` (dark) or `<div class="os-root os-light">` on the shell root, driven by
`useOsTheme()` in `components/os/os-bootstrap.tsx`. The choice is persisted in `localStorage` under
`myos.theme` and initialised from `prefers-color-scheme`; the same classes are mirrored onto `<html>`
before paint, so neither the MyOS screens nor the Supabase screens flash on load.

The language itself is specified in [docs/DESIGN.md](../DESIGN.md) — measured from the reference the
owner chose (near-black `#0F1012` canvas, white ink, hairlines instead of cards, 2px radius, no
shadows or blur, colour reserved for overdue / done / due-today, sentence-case display type, 11px
uppercase micro-labels, monospace for every number and date). Three things implement it:

* `app/os.css` — the `--os-*` variables plus the motif classes (`.os-grid`, `.os-disc`, `.os-dial`,
  `.os-dot`, `.os-panel`, `.os-label`, `.os-title`, `.os-display`, `.os-mono`, `.os-micro`).
* `tailwind.config.ts` — maps them to semantic utilities (`bg-card`, `text-muted-foreground`,
  `border-line`, `text-danger`, …) exactly like shadcn/ui does, pins the default `border`/`divide`
  colour to the hairline (so components never need `!border-*` hacks), and holds
  `rounded-os-lg`/`shadow-os` at the spec values so a leftover utility cannot reintroduce cards.
* `app/globals.css` — PerPro's original variable names and `.text-*` utilities, now resolving to the
  same tokens, so the Supabase screens inherit the language instead of competing with it.

`components/os/marks.tsx` is the single implementation of the three ornaments the design allows
(disc, bounded hairline grid, monospace corner micro-data, plus `Dial`/`HairlineBar`/`StatusDot`/
`Clock`). Screens compose from it; they do not hand-roll a disc, a grid, a dial or a clock.

## 5. AI (optional by design)

Phase 6 adds `backend/app/services/assistant.py`, talking to an OpenAI-compatible endpoint or Ollama
chosen by `MYOS_AI_PROVIDER`. Today `MYOS_AI_ENABLED=0` in every environment and no MyOS screen
depends on a model: the UI shows rule-based insights and the assistant panel explains how to switch
it on. When enabled, tool
calls operate through the same services the UI uses, so the assistant can only do what the
database already allows, and consequential actions require an explicit confirmation step.

## 6. Phasing

Phase 1 (this build) is implemented end to end: foundation, dashboard, tasks, projects, notes,
people, global search, notifications, activity, settings, demo data, tests, Docker.
Phases 2–6 (career, CRM, finance, integrations, business analytics, AI automation) are specified
in `docs/MYOS/DATA_MODEL.md` and surfaced in the sidebar as roadmap links rather than fake
screens.

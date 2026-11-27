# PerPro

One app. MyOS is not a second product — **PerPro *is* the OS**: the MyOS engine (FastAPI + SQLite
behind the `/api/os/*` proxy, described in [docs/MYOS/ARCHITECTURE.md](docs/MYOS/ARCHITECTURE.md))
runs the dashboard and the Tasks / Projects / Notes screens at their canonical URLs, with grouped
navigation in a single shell.

The screens that only ever existed on Supabase — **Inbox**, **Meetings**, **News** — stayed exactly
where they were. The five Supabase screens that MyOS duplicated are preserved, untouched, under
`/legacy/*` (each carries a banner pointing at its live equivalent):

- **PerPro screens on Supabase** (`Next.js + Tailwind + Supabase`, `DEMO_MODE` supported): `/inbox`,
  `/meetings`, `/news`, plus `/legacy/today`, `/legacy/tasks`, `/legacy/projects`,
  `/legacy/projects/[id]`, `/legacy/notes`.
- **MyOS screens** (`Next.js + shadcn/ui` frontend, **FastAPI** backend, **SQLite** via
  SQLAlchemy + Alembic): `/`, `/tasks`, `/projects`, `/projects/[id]`, `/notes`, `/contacts`,
  `/goals`, `/search`, `/notifications`, `/activity`, `/settings`, `/roadmap`, the seven
  `/finance/*` screens, and `/career`, `/crm`, `/customers`.

The old `/os/*` URLs are gone and answer **308** redirects to their canonical path
(`/os/tasks?task=1` → `/tasks?task=1`, `/os` → `/`).

Both screen sets wear one design language — the Studio—BA grammar specified in
[docs/DESIGN.md](docs/DESIGN.md): near-black canvas, white ink, hairlines instead of cards, 2px
radius, no shadows or blur, colour only for overdue / done / due-today, sentence-case display type,
uppercase micro-labels and monospace for every number and date. It lives in three places:
`app/os.css` (tokens + `.os-grid` / `.os-disc` / `.os-dial` / `.os-label` motifs),
`tailwind.config.ts` (semantic utilities, hairline as the default border colour) and
`components/os/marks.tsx` (the only implementation of the disc, grid, dial, status dot, clocks and
corner micro-data). `app/globals.css` keeps PerPro's variable names but resolves them to the same
tokens, so `/legacy/*`, `/inbox`, `/meetings` and `/news` look like the rest of the OS.

## MyOS quickstart

```bash
make setup     # pip install -r backend/requirements.txt + npm install
make dev       # FastAPI on :8000 (background) + Next.js on :3002
open http://localhost:3002/
```

Or step by step, without make:

```bash
cd backend && python3 -m pip install -r requirements.txt
python3 -m alembic upgrade head     # creates backend/data/myos.db and all 35 tables (19 Phase 1 + 10 Finance + 6 Career/CRM)
python3 -m app.cli seed             # idempotent demo data (relative dates, always "alive"); on a database that predates Phase 3 the same call backfills the Finance rows
python3 -m uvicorn app.main:app --port 8000
cd .. && npm install && npm run dev -- -p 3002
```

No credentials are required for anything in MyOS. The browser only ever talks to Next.js;
`app/api/os/[...path]/route.ts` proxies to FastAPI and strips `Authorization`, `Cookie` and
`X-API-Key` headers, so a future Google/Stripe/database credential can never leak to the client.

Container: `docker compose up` starts `api` (migrates then serves) and `web`, with the SQLite
file in a named volume.

### What is where

| Screen | Route | Store |
|---|---|---|
| Personal dashboard — agenda, today's/overdue tasks, active projects with next action, milestones, notifications, recent notes, activity, rule-based insights, a Money tile, reorderable/hideable widgets, quick actions | `/` | MyOS |
| Projects — filters, progress, create/edit, delete with type-to-confirm | `/projects` | MyOS |
| Project workspace — next action, kanban (drag) + table, milestones timeline, stats, project activity | `/projects/[id]` | MyOS |
| Tasks — status/priority/project/tag/due filters, search, sort, list + board, bulk actions, paging, recurring rollover, JSON import | `/tasks` | MyOS |
| Notes — category rail, tags, search, favourites, markdown editor + preview, relations and backlinks | `/notes` | MyOS |
| People — contacts with company join, tags, plus company CRUD | `/contacts` | MyOS |
| Goals — progress slider, target date, linked project | `/goals` | MyOS |
| Search — global, grouped and ranked | `/search` | MyOS |
| Notifications + reminders — derived, idempotent, mark read/dismiss, snooze | `/notifications` | MyOS |
| Activity — unified timeline grouped by day | `/activity` | MyOS |
| Settings — workspace defaults, theme, API health, demo seed/reset, full JSON export, data location | `/settings` | MyOS |
| Roadmap — what each later phase unlocks | `/roadmap` | MyOS |
| Career — the job funnel as a board and a table: eight stages with legal moves only, interview rounds with their own column, salary bands that answer one number or a range, the diary of what is scheduled, and stale applications called out by the server | `/career` | MyOS |
| Freelance CRM — leads on a ladder (`new → contacted → qualified → proposal → won`, parked as `dormant`, closed as `lost`), follow-up due rail, weighted value per currency, and a promote that opens the account in one transaction | `/crm` | MyOS |
| Customers — the account book: stage board, contract clock with the renewal warning window, MRR derived from live money (printed next to the stored figure, not instead of it), lifetime value, per-currency totals, tags | `/customers` | MyOS |
| Finance overview — net, runway, burn, MRR, receivables, renewals, currency exposure, stale rates; a `Read totals in` control names the currency for every figure | `/finance` | MyOS |
| Income calculator — gross → tax → take-home for `none`/`flat`/`slab`/`presumptive` regimes, two profiles side by side, plus the income ledger (expected → invoiced → paid, overdue days from the server, CSV export of the exact window you are looking at) | `/finance/income` | MyOS |
| Currency converter — convert at a stored rate, the rate ledger with age and staleness, mixed-currency totals per code, hand-added rates (`sync` is opt-in and offline-safe) | `/finance/currency` | MyOS |
| Subscriptions — recurring commitments from your own catalogue, renewal dates, monthly/annual normalisation, pause/resume/cancel | `/finance/subscriptions` | MyOS |
| Service catalogue — what you can sell, the unit it is sold in, the plans packaged on top, revenue earned per service | `/finance/services` | MyOS |
| Cost scenarios — a plan for the next N months, month-by-month curve, break-even month, runway, duplicate/activate, compare two plans | `/finance/scenarios` | MyOS |
| Expenses — spend by month/category/vendor, recurring share, bulk actions, CSV export | `/finance/expenses` | MyOS |
| Inbox — triage captures into tasks, notes or meetings | `/inbox` | Supabase |
| Meetings — agenda + notes, AI action items | `/meetings` | Supabase |
| News — AI + football feeds | `/news` | Supabase |
| Legacy index — the preserved Supabase screens, with an honest note each | `/legacy` | Supabase |
| Today / Tasks / Projects (+ project workspace) / Notes — the original PerPro screens, functionality untouched | `/legacy/today`, `/legacy/tasks`, `/legacy/projects`, `/legacy/projects/[id]`, `/legacy/notes` | Supabase |

`/os/*` no longer exists: every old URL answers **308** and lands on its canonical path.

MyOS meetings are not a screen of their own: a meeting hangs off the record it was about (a lead, a
client, a job application, a task), so it is created and read from that record's detail dialog and
the next few appear on the Career diary. `/meetings` above is still the Supabase screen, and no
Phase 2 link points at it — a meeting's `href` resolves to its owner, exactly like a milestone's
resolves to its project.

Task import is deliberately forgiving — it accepts a bare array or `{"tasks": […]}`, markdown
fences, prose around the JSON, trailing commas, `priority: "High"`, and aliases (`name`→title,
`deadline`/`due`→due_date, `done`/`status`→completed, `desc`→description). Ids are always
generated server-side, duplicate titles are skipped unless you ask otherwise, and the Import
dialog can copy both the expected JSON shape and a prompt to hand an agent that produces it.

### Verification

```bash
cd backend && python3 -m pytest -q   # 607 — services, API contract, migrations, CLI
npm test                             # 56 passed — PerPro import, brief logic, Phase 2/3 derived maths
npm run build                        # the one app type-checks and compiles
```

Derived logic that is unit-tested rather than eyeballed: project progress
(including the `manual_progress` and completed/archived rules), overdue and due-today boundaries,
recurrence rollover including month-end clamping, the tolerant importer, search ranking and
grouping, dashboard insight rules, notification dedupe across two refreshes, activity logging,
the deep-link target set, and the cascade rules on delete. Money gets the same treatment: slab /
flat / presumptive tax, 0-decimal currencies, half-cent rounding done once, monthly normalisation
of every interval, runway that returns `null` instead of infinity, a rate lookup that degrades to
the last known rate, one that refuses an unknown pair, a scenario curve whose totals equal the sum
of its own months, and the currency rule itself — a mixed book that has not been told which code
to answer in returns `null` for every figure that would need a rate, never a number whose currency
nobody named.

Phase 2 adds its own: `lib/os/career.test.ts` pins the application graph, what counts as closed,
the dot a row renders as, and both shapes a salary band can take; `lib/os/crm.test.ts` pins the lead
graph, `openLeadCount`, the per-currency tally merge (including figures that arrive with no code),
`sumMrrByCurrency`, the renewal buckets, tag counting and every sort/default pair the three screens
offer. Both graphs are asserted against the tables in `PHASE2_CAREER_CRM.md` §3, so a frontend that
offers an illegal move fails a test instead of a user.

### MyOS docs

[docs/DESIGN.md](docs/DESIGN.md) — the visual language, measured palette, token contract and component rules.
[docs/MYOS/ARCHITECTURE.md](docs/MYOS/ARCHITECTURE.md) — layout, boundaries, conventions, theming, AI posture.
[docs/MYOS/API.md](docs/MYOS/API.md) — the v1 contract every screen is built against.
[docs/MYOS/DATA_MODEL.md](docs/MYOS/DATA_MODEL.md) — table-by-table schema, delete matrix, derived
values, Postgres mapping, and the Phase 4–6 tables designed but not yet migrated.
[docs/MYOS/PHASE3_FINANCE.md](docs/MYOS/PHASE3_FINANCE.md) — the money contract: every endpoint,
every derivation, every deliberate deviation from §13.
[docs/MYOS/PHASE2_CAREER_CRM.md](docs/MYOS/PHASE2_CAREER_CRM.md) — the same for Career & CRM:
both state machines, the promote transaction, where each derived number comes from, and the deep
links the three screens read.

AI is optional and off by default (`MYOS_AI_ENABLED=0`); no MyOS screen needs a model to work.
Phase 3 — Finance — is in: money math runs on your own rows, offline first, with no paid rate
service and no bank connection. Phase 2 — Career & CRM — is next: `/career`, `/crm` and `/customers`
are real screens over the real API, their tables arrive with migration `0004` along with the two
`client_id` FKs Finance deferred, and `PHASE2_CAREER_CRM.md` is the contract they were built to.
Until that migration is applied and its routers served, the three tabs answer a 404 and say so in
words — "this API has no CRM endpoints yet" — rather than showing an empty board, and §10 of that
file lists exactly what still has to land. Phases 4–6
(Google/GitHub/Supabase integrations, business analytics, AI tool calling) are specified as
additive migrations — the sidebar shows them as roadmap entries rather than fake screens until
they exist.

---

## PerPro setup

1. **Database** — paste [`supabase/schema.sql`](supabase/schema.sql) into Supabase Dashboard → SQL Editor → Run. Creates `inbox`, `tasks`, `meetings`, `notes`, `news_items`, plus `projects`,
`project_tasks` and `project_milestones`. Safe to re-run.
2. **Env** — copy `.env.example` to `.env.local` and fill in the Supabase keys and AI provider
   config. `.env.local` is gitignored, so it does not exist in a fresh clone (`make setup` writes a
   minimal one for you).
3. **Run** — `npm install && npm run dev` (use `-p 3002` if 3000 is taken).

### Demo mode (no credentials needed)

Set `DEMO_MODE=1` in `.env.local` to run the whole app against an in-memory seed:
tasks, inbox, meetings, notes, news items, and three projects (OrderBook, Website
Refresh, Investor Data Room) with tasks and milestones are pre-filled, and the AI summarize /
action-item buttons return deterministic offline text instead of calling a provider.
Data resets when the server restarts. Live RSS refresh (`POST /api/news`) and the
football fixtures still use the network. Remove the flag to go back to Supabase + a real
AI provider.

If `DEMO_MODE` is off **and** there are no Supabase credentials, the data routes answer
`503` with a message naming exactly which variable is missing and how to fix it
(`lib/supabase-server.ts` → `dataConfigProblem()`, surfaced by `withData()` in
`lib/data-guard.ts`), and the screens show that text instead of a bare "failed to fetch".
This is why a fresh clone without `.env.local` is self-explanatory rather than broken.

## Supabase features

These are the original PerPro screens. The dashboard, task, project and note
screens at the canonical URLs are now the MyOS ones (table above); the versions below are
reachable at `/legacy/...` and still read and write Supabase.

- **Today** (`/legacy/today`) — overdue + due-today tasks, next meeting, inbox preview, pinned notes, quick-capture bar.
- **Cmd+K palette** — capture any thought to the Inbox from anywhere, or jump to any page / create new items.
- **Inbox** (`/inbox`) — triage captures into tasks, notes, or meetings; dismiss the rest.
- **Projects** (`/legacy/projects`) — one card per project with completion, overdue count and next due date; click through for the project workspace. `/legacy/projects/[id]` holds tasks (grouped by category, filterable by status/category, sortable by due date/priority/category/added), a **Schedule** panel of dated milestones with late/in-N-days markers, a per-category progress breakdown, and stats for progress, open, overdue and the next milestone. Add tasks by hand or **Import JSON**. Every task row has a **Prompt** button that copies a
complete implementation brief for it — project context, the task, its full notes, sibling
tasks and the milestone it serves — ready to paste into any coding agent.
- **Tasks** (`/legacy/tasks`) — priority, due dates, tags, search, all/open/done filters.
- **Meetings** (`/meetings`) — agenda + notes; AI extracts action items straight into linked tasks.
- **Notes** (`/legacy/notes`) — markdown with preview, tags, pinning, AI summarize and action-item extraction.
- **News** (`/news`) — two categories. **AI News**: server-side RSS aggregation from OpenAI, Google DeepMind, Hugging Face, TechCrunch AI, The Verge AI, Ars Technica AI, and Hacker News; cached + deduped in Supabase, auto-refreshes when older than 1 hour, filter by source, star or save items to notes. **Football**: opens seeded with the UCL top 10 (PSG, Barcelona, Real Madrid, Liverpool, Man City, Arsenal, Bayern, Inter, Dortmund, Atlético); follow/unfollow any club via search, see upcoming fixtures grouped by day and recent results with scores, via the free TheSportsDB API (`/api/football`, 5-minute server cache). Followed teams persist in the browser's localStorage.

## Project task import

`POST /api/projects/import` with `{ project_id, raw, allow_duplicates }` (the Import JSON
dialog in `/legacy/projects/[id]` calls it, and validates the same payload client-side before
sending). The expected shape:

```json
{
  "tasks": [
    {
      "title": "OrderBook: Configure Supabase RLS & brand isolation policies",
      "category": "Database & Security",
      "notes": "Ensure brand_id is enforced across all tables using Row Level Security.",
      "completed": false,
      "priority": "High",
      "due_date": "2026-11-03"
    }
  ]
}
```

- `title` is required; everything else is optional.
- `priority` is case-insensitive and understands `critical`/`asap` → urgent, `normal` → medium.
- `completed` accepts a boolean, `done`, or `status: "done"` / `"open"`.
- `due_date` accepts `YYYY-MM-DD` or a full timestamp.
- `notes` can be long (capped at 20k characters) and may be an array — it is stringified.
- Ids are always generated server-side, so the same JSON can be re-imported into another project.
- Duplicate titles inside one payload, or already present in the project, are skipped unless
  `allow_duplicates` is set.
- A bare array of tasks works, as do markdown fences, prose around the JSON, and trailing commas.

The dialog has **Copy JSON format** and **Copy prompt for an agent** buttons — the second one
gives an agent everything it needs to produce a payload this importer accepts.

The per-task implementation brief (the **Prompt** button on a task row, or **Copy implement
prompt** in the task dialog) closes the loop the other way: it asks the agent to answer with
follow-up work in the import shape above, using brand-new titles so it lands as new tasks
rather than colliding with the existing one. Built by `lib/task-prompt.ts`.
Notes are copied verbatim and untruncated — they are the spec.

Deleting a project (`DELETE /api/projects/[id]`) removes its tasks and milestones too.

## AI assist

`/api/ai` uses `DEFAULT_AI_PROVIDER` (freellm → local proxy at `FREELLM_BASE_URL`, falling back to OpenAI). If summaries fail, check the proxy is running on :3001.

## Scheduled news refresh (optional)

`GET /api/cron/news` with `Authorization: Bearer $CRON_SECRET` refreshes feeds. Point a GitHub Action or Vercel Cron at it (the old `.github/workflows/queue-worker.yml` targets the retired queue API and can be repurposed or deleted).

## Security note

No auth and no RLS — this is a single-user personal app. **Do not deploy publicly without adding Supabase auth + RLS first.** The publishable key in the browser bundle can read/write all tables.

## Legacy files

`schema.sql` (root), `extension.crx`, `extension.pem`, and the queue-worker workflow belong to the retired capture/outreach project. The live schema is `supabase/schema.sql`.
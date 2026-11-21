# PerPro + MyOS

One repository, two surfaces:

- **PerPro — Founder Command Center** (root `/`): quick capture, tasks, projects with JSON import, meetings, markdown notes with AI assist, aggregated AI news. Next.js + Tailwind + Supabase.
- **MyOS — Personal & Business Operating System** (`/os`): the modular local-first command centre described in [docs/MYOS/ARCHITECTURE.md](docs/MYOS/ARCHITECTURE.md). Next.js + shadcn/ui frontend, **FastAPI** backend, **SQLite** via SQLAlchemy + Alembic.

Both share one Next.js app. `app/(perpro)` and `app/(os)` are route groups, so every existing
PerPro URL (`/`, `/tasks`, `/projects/…`, `/notes`, `/inbox`, `/meetings`, `/news`) is unchanged;
MyOS lives under `/os` with its own shell, sidebar and light/dark theme.

## MyOS quickstart

```bash
make setup     # pip install -r backend/requirements.txt + npm install
make dev       # FastAPI on :8000 (background) + Next.js on :3002
open http://localhost:3002/os
```

Or step by step, without make:

```bash
cd backend && python3 -m pip install -r requirements.txt
python3 -m alembic upgrade head     # creates backend/data/myos.db and all 19 Phase-1 tables
python3 -m app.cli seed             # idempotent demo data (relative dates, always "alive")
python3 -m uvicorn app.main:app --port 8000
cd .. && npm install && npm run dev -- -p 3002
```

No credentials are required for anything in MyOS. The browser only ever talks to Next.js;
`app/api/os/[...path]/route.ts` proxies to FastAPI and strips `Authorization`, `Cookie` and
`X-API-Key` headers, so a future Google/Stripe/database credential can never leak to the client.

Container: `docker compose up` starts `api` (migrates then serves) and `web`, with the SQLite
file in a named volume.

### What Phase 1 does

| Screen | Route |
|---|---|
| Personal dashboard — agenda, today's/overdue tasks, active projects with next action, milestones, notifications, recent notes, activity, rule-based insights, reorderable/hideable widgets, quick actions | `/os` |
| Projects — filters, progress, create/edit, delete with type-to-confirm | `/os/projects` |
| Project workspace — next action, kanban (drag) + table, milestones timeline, stats, project activity | `/os/projects/[id]` |
| Tasks — status/priority/project/tag/due filters, search, sort, list + board, bulk actions, paging, recurring rollover, JSON import | `/os/tasks` |
| Notes — category rail, tags, search, favourites, markdown editor + preview, relations and backlinks | `/os/notes` |
| People — contacts with company join, tags, plus company CRUD | `/os/contacts` |
| Goals — progress slider, target date, linked project | `/os/goals` |
| Search — global, grouped and ranked (also ⌘K everywhere) | `/os/search` |
| Notifications + reminders — derived, idempotent, mark read/dismiss, snooze | `/os/notifications` |
| Activity — unified timeline grouped by day | `/os/activity` |
| Settings — workspace defaults, theme, API health, demo seed/reset, full JSON export, data location | `/os/settings` |
| Roadmap — what each later phase unlocks | `/os/roadmap` |

Task import is deliberately forgiving — it accepts a bare array or `{"tasks": […]}`, markdown
fences, prose around the JSON, trailing commas, `priority: "High"`, and aliases (`name`→title,
`deadline`/`due`→due_date, `done`/`status`→completed, `desc`→description). Ids are always
generated server-side, duplicate titles are skipped unless you ask otherwise, and the Import
dialog can copy both the expected JSON shape and a prompt to hand an agent that produces it.

### Verification

```bash
cd backend && python3 -m pytest -q   # 368 passed — services, API contract, migrations, CLI
npm test                             # 13 passed — PerPro import + implementation-brief logic
npm run build                        # both apps type-check and compile
```

Derived logic that is unit-tested rather than eyeballed: project progress
(including the `manual_progress` and completed/archived rules), overdue and due-today boundaries,
recurrence rollover including month-end clamping, the tolerant importer, search ranking and
grouping, dashboard insight rules, notification dedupe across two refreshes, activity logging,
the deep-link target set, and the cascade rules on delete.

### MyOS docs

[docs/MYOS/ARCHITECTURE.md](docs/MYOS/ARCHITECTURE.md) — layout, boundaries, conventions, theming, AI posture.
[docs/MYOS/API.md](docs/MYOS/API.md) — the v1 contract every screen is built against.
[docs/MYOS/DATA_MODEL.md](docs/MYOS/DATA_MODEL.md) — table-by-table schema, delete matrix, derived
values, Postgres mapping, and the Phase 2–6 tables designed but not yet migrated.

AI is optional and off by default (`MYOS_AI_ENABLED=0`); nothing in `/os` needs a model to work.
Phases 2–6 (career pipeline, freelance CRM, finance and cost scenarios, Google/GitHub/Supabase
integrations, business analytics, AI tool calling) are specified as additive migrations — the
sidebar shows them as roadmap entries rather than fake screens until they exist.

---

## PerPro setup

1. **Database** — paste [`supabase/schema.sql`](supabase/schema.sql) into Supabase Dashboard → SQL Editor → Run. Creates `inbox`, `tasks`, `meetings`, `notes`, `news_items`, plus `projects`,
`project_tasks` and `project_milestones`. Safe to re-run.
2. **Env** — `.env.local` already has the Supabase keys and AI provider config.
3. **Run** — `npm install && npm run dev` (use `-p 3002` if 3000 is taken).

### Demo mode (no credentials needed)

Set `DEMO_MODE=1` in `.env.local` to run the whole app against an in-memory seed:
tasks, inbox, meetings, notes, news items, and three projects (OrderBook, Website
Refresh, Investor Data Room) with tasks and milestones are pre-filled, and the AI summarize /
action-item buttons return deterministic offline text instead of calling a provider.
Data resets when the server restarts. Live RSS refresh (`POST /api/news`) and the
football fixtures still use the network. Remove the flag to go back to Supabase + a real
AI provider.

## Features

- **Today** (`/`) — overdue + due-today tasks, next meeting, inbox preview, pinned notes, quick-capture bar.
- **Cmd+K palette** — capture any thought to the Inbox from anywhere, or jump to any page / create new items.
- **Inbox** (`/inbox`) — triage captures into tasks, notes, or meetings; dismiss the rest.
- **Projects** (`/projects`) — one card per project with completion, overdue count and next due date; click through for the project workspace. `/projects/[id]` holds tasks (grouped by category, filterable by status/category, sortable by due date/priority/category/added), a **Schedule** panel of dated milestones with late/in-N-days markers, a per-category progress breakdown, and stats for progress, open, overdue and the next milestone. Add tasks by hand or **Import JSON**. Every task row has a **Prompt** button that copies a
complete implementation brief for it — project context, the task, its full notes, sibling
tasks and the milestone it serves — ready to paste into any coding agent.
- **Tasks** (`/tasks`) — priority, due dates, tags, search, all/open/done filters.
- **Meetings** (`/meetings`) — agenda + notes; AI extracts action items straight into linked tasks.
- **Notes** (`/notes`) — markdown with preview, tags, pinning, AI summarize and action-item extraction.
- **News** (`/news`) — two categories. **AI News**: server-side RSS aggregation from OpenAI, Google DeepMind, Hugging Face, TechCrunch AI, The Verge AI, Ars Technica AI, and Hacker News; cached + deduped in Supabase, auto-refreshes when older than 1 hour, filter by source, star or save items to notes. **Football**: opens seeded with the UCL top 10 (PSG, Barcelona, Real Madrid, Liverpool, Man City, Arsenal, Bayern, Inter, Dortmund, Atlético); follow/unfollow any club via search, see upcoming fixtures grouped by day and recent results with scores, via the free TheSportsDB API (`/api/football`, 5-minute server cache). Followed teams persist in the browser's localStorage.

## Project task import

`POST /api/projects/import` with `{ project_id, raw, allow_duplicates }` (the Import JSON
dialog in the project view calls it, and validates the same payload client-side before
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
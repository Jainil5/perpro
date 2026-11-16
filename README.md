# PerPro — Founder Command Center

Personal productivity app for a developer / AI startup founder: quick capture, tasks, projects with JSON import, meetings, markdown notes with AI assist, and an aggregated AI news feed. Next.js 15 + Tailwind + Supabase.

## Setup

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
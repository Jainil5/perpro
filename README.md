# PerPro — Founder Command Center

Personal productivity app for a developer / AI startup founder: quick capture, tasks, meetings, markdown notes with AI assist, and an aggregated AI news feed. Next.js 15 + Tailwind + Supabase.

## Setup

1. **Database** — paste [`supabase/schema.sql`](supabase/schema.sql) into Supabase Dashboard → SQL Editor → Run. Creates `inbox`, `tasks`, `meetings`, `notes`, `news_items`. Safe to re-run.
2. **Env** — `.env.local` already has the Supabase keys and AI provider config.
3. **Run** — `npm install && npm run dev` (use `-p 3002` if 3000 is taken).

### Demo mode (no credentials needed)

Set `DEMO_MODE=1` in `.env.local` to run the whole app against an in-memory seed:
tasks, inbox, meetings, notes and news items are pre-filled, and the AI summarize /
action-item buttons return deterministic offline text instead of calling a provider.
Data resets when the server restarts. Live RSS refresh (`POST /api/news`) and the
football fixtures still use the network. Remove the flag to go back to Supabase + a real
AI provider.

## Features

- **Today** (`/`) — overdue + due-today tasks, next meeting, inbox preview, pinned notes, quick-capture bar.
- **Cmd+K palette** — capture any thought to the Inbox from anywhere, or jump to any page / create new items.
- **Inbox** (`/inbox`) — triage captures into tasks, notes, or meetings; dismiss the rest.
- **Tasks** (`/tasks`) — priority, due dates, tags, search, all/open/done filters.
- **Meetings** (`/meetings`) — agenda + notes; AI extracts action items straight into linked tasks.
- **Notes** (`/notes`) — markdown with preview, tags, pinning, AI summarize and action-item extraction.
- **News** (`/news`) — two categories. **AI News**: server-side RSS aggregation from OpenAI, Google DeepMind, Hugging Face, TechCrunch AI, The Verge AI, Ars Technica AI, and Hacker News; cached + deduped in Supabase, auto-refreshes when older than 1 hour, filter by source, star or save items to notes. **Football**: opens seeded with the UCL top 10 (PSG, Barcelona, Real Madrid, Liverpool, Man City, Arsenal, Bayern, Inter, Dortmund, Atlético); follow/unfollow any club via search, see upcoming fixtures grouped by day and recent results with scores, via the free TheSportsDB API (`/api/football`, 5-minute server cache). Followed teams persist in the browser's localStorage.

## AI assist

`/api/ai` uses `DEFAULT_AI_PROVIDER` (freellm → local proxy at `FREELLM_BASE_URL`, falling back to OpenAI). If summaries fail, check the proxy is running on :3001.

## Scheduled news refresh (optional)

`GET /api/cron/news` with `Authorization: Bearer $CRON_SECRET` refreshes feeds. Point a GitHub Action or Vercel Cron at it (the old `.github/workflows/queue-worker.yml` targets the retired queue API and can be repurposed or deleted).

## Security note

No auth and no RLS — this is a single-user personal app. **Do not deploy publicly without adding Supabase auth + RLS first.** The publishable key in the browser bundle can read/write all tables.

## Legacy files

`schema.sql` (root), `extension.crx`, `extension.pem`, and the queue-worker workflow belong to the retired capture/outreach project. The live schema is `supabase/schema.sql`.
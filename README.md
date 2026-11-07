# PerPro — Founder Command Center

Personal productivity app for a developer / AI startup founder: quick capture, tasks, meetings, markdown notes with AI assist, and an aggregated AI news feed. Next.js 15 + Tailwind + Supabase.

## Setup

1. **Database** — paste [`supabase/schema.sql`](supabase/schema.sql) into Supabase Dashboard → SQL Editor → Run. Creates `inbox`, `tasks`, `meetings`, `notes`, `news_items`. Safe to re-run.
2. **Env** — `.env.local` already has the Supabase keys and AI provider config.
3. **Run** — `npm install && npm run dev` (use `-p 3002` if 3000 is taken).

## Features

- **Today** (`/`) — overdue + due-today tasks, next meeting, inbox preview, pinned notes, quick-capture bar.
- **Cmd+K palette** — capture any thought to the Inbox from anywhere, or jump to any page / create new items.
- **Inbox** (`/inbox`) — triage captures into tasks, notes, or meetings; dismiss the rest.
- **Tasks** (`/tasks`) — priority, due dates, tags, search, all/open/done filters.
- **Meetings** (`/meetings`) — agenda + notes; AI extracts action items straight into linked tasks.
- **Notes** (`/notes`) — markdown with preview, tags, pinning, AI summarize and action-item extraction.
- **AI News** (`/news`) — server-side RSS aggregation from OpenAI, Google DeepMind, Hugging Face, TechCrunch AI, The Verge AI, Ars Technica AI, and Hacker News. Cached + deduped in Supabase, auto-refreshes when older than 1 hour, filter by source, star or save items to notes.

## AI assist

`/api/ai` uses `DEFAULT_AI_PROVIDER` (freellm → local proxy at `FREELLM_BASE_URL`, falling back to OpenAI). If summaries fail, check the proxy is running on :3001.

## Scheduled news refresh (optional)

`GET /api/cron/news` with `Authorization: Bearer $CRON_SECRET` refreshes feeds. Point a GitHub Action or Vercel Cron at it (the old `.github/workflows/queue-worker.yml` targets the retired queue API and can be repurposed or deleted).

## Security note

No auth and no RLS — this is a single-user personal app. **Do not deploy publicly without adding Supabase auth + RLS first.** The publishable key in the browser bundle can read/write all tables.

## Legacy files

`schema.sql` (root), `extension.crx`, `extension.pem`, and the queue-worker workflow belong to the retired capture/outreach project. The live schema is `supabase/schema.sql`.
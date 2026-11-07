-- PerPro v2 — personal productivity schema
-- Paste into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run (if not exists). No RLS: personal single-user app, do not deploy publicly without auth.

create table if not exists public.inbox (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.meetings (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  attendees text,
  location text,
  agenda text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  notes text,
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'open' check (status in ('open','done')),
  due_date date,
  tags text[] not null default '{}',
  meeting_id uuid references public.meetings(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_status_due_idx on public.tasks (status, due_date);

create table if not exists public.notes (
  id uuid default gen_random_uuid() primary key,
  title text not null default 'Untitled',
  body text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.news_items (
  id uuid default gen_random_uuid() primary key,
  url text not null unique,
  title text not null,
  source text not null,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  saved boolean not null default false
);

create index if not exists news_items_published_idx on public.news_items (published_at desc);

-- RLS stays ENABLED (Supabase default). All app access goes through server
-- routes using the secret key, which bypasses RLS; the browser never talks to
-- Supabase directly. Add real policies before introducing auth.
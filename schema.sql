create table public.outreach_leads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  brand_name text not null,
  website_url text not null,
  initial_notes text,
  status text default 'identified',
  target_meeting_date timestamptz,
  analysis_status text default 'pending',
  missing_opportunities jsonb default '[]'::jsonb,
  products_to_pitch jsonb default '[]'::jsonb,
  cold_pitch_draft text,
  created_at timestamptz default now()
);

create table public.ai_quota_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null default 'claude',
  account_email text not null,
  expired_at timestamptz default now() not null,
  resets_at timestamptz not null,
  is_notified boolean default false
);

create table public.saved_jobs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  url text not null,
  title text not null,
  company text,
  analysis jsonb,
  status text default 'saved',
  created_at timestamptz default now()
);

-- =============================================================================
-- Capture spine (sub-project 1)
-- =============================================================================
-- Two independent lifecycles, deliberately two columns:
--   status = PROCESSING state, owned by the audit engine (sub-project 2)
--            new -> queued -> analyzing -> ready | failed
--   stage  = CRM pipeline, owned by sub-project 3, meaningful only for
--            kind = 'outreach'
-- The legacy design overloaded one column, and capture wrote
-- analysis_status='completed' immediately, which made the queue worker's
-- 'pending' branch unreachable forever.
--
-- detail jsonb holds kind-specific fields:
--   outreach { business_name, target_meeting_date }
--   job      { company, stack[] }
--   video    { channel }
--   project  { deploy_url, db_url, dns }
-- Sub-project 2 writes pitch_draft / opportunities[] / products[] in here
-- rather than adding columns.

create table public.captures (
  id uuid default gen_random_uuid() primary key,
  kind text not null check (kind in ('outreach','job','video','project','link')),
  url text,
  title text not null,
  note text,
  status text not null default 'new' check (status in ('new','queued','analyzing','ready','failed')),
  stage text check (stage in ('identified','pitched','demo_scheduled','won','lost')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index captures_kind_created_at_idx on public.captures (kind, created_at desc);
create index captures_status_idx on public.captures (status);

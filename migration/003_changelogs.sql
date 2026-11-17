-- 003_changelogs.sql
-- Per-script changelogs. The script owner writes one when they push an update; players see the newest
-- one once, right after key verification and before the script starts.
-- Safe to re-run. Same security model as 001/002: RLS on, no policies, service_role only.

create table if not exists public.script_changelogs (
  id          uuid primary key default gen_random_uuid(),
  script_id   uuid not null references public.scripts(id) on delete cascade,
  title       text check (title is null or char_length(title) <= 60),
  entries     jsonb not null
                check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) between 1 and 30),
  created_at  timestamptz not null default now()
);
create index if not exists script_changelogs_script_idx on public.script_changelogs (script_id, created_at desc);

alter table public.script_changelogs enable row level security;
revoke all on public.script_changelogs from anon, authenticated;
grant all on public.script_changelogs to service_role;

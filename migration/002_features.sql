-- =====================================================================================
-- 002_features.sql — run AFTER 001_schema.sql, in the Supabase SQL Editor.
-- Safe to re-run (idempotent). Adds: HWID licensing, key IP history, 2FA storage,
-- status page, script version history, analytics functions.
-- Same security model as 001: RLS on, zero policies, anon/authenticated get nothing,
-- functions are SECURITY INVOKER and executable only by service_role.
-- =====================================================================================

begin;

-- ---------------------------------------------------------------------------------
-- HWID licensing (+ IP kept as a tracked second signal)
-- ---------------------------------------------------------------------------------
alter table public.keys add column if not exists bound_hwid    text;
alter table public.keys add column if not exists hwid_bound_at timestamptz;
alter table public.keys add column if not exists hwid_reset_at timestamptz;
alter table public.keys add column if not exists last_ip       text;
alter table public.keys add column if not exists last_seen_at  timestamptz;
do $$ begin
  alter table public.keys add constraint keys_bound_hwid_format
    check (bound_hwid is null or bound_hwid ~ '^[a-f0-9]{16}_[!-~]{1,40}$');
exception when duplicate_object then null; end $$;
create index if not exists keys_bound_hwid_idx on public.keys (bound_hwid) where bound_hwid is not null;
create index if not exists keys_last_seen_idx  on public.keys (last_seen_at) where last_seen_at is not null;

create table if not exists public.key_ip_history (
  key_id      uuid not null references public.keys(id) on delete cascade,
  ip          text not null,
  country     text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  uses        integer not null default 1,
  primary key (key_id, ip)
);
create index if not exists key_ip_history_recent_idx on public.key_ip_history (key_id, last_seen desc);

-- Trust-on-first-use: binds the HWID only if the key has none yet. Returns the row if it bound.
create or replace function public.bind_key_hwid(p_key_id uuid, p_hwid text)
returns setof public.keys
language sql
security invoker
set search_path = ''
as $$
  update public.keys
     set bound_hwid = p_hwid, hwid_bound_at = now()
   where id = p_key_id and bound_hwid is null
  returning *;
$$;

-- Clears the HWID binding, enforcing a cooldown (pass 0 for admin resets). Returns ok + retry time.
create or replace function public.reset_key_hwid(p_key_id uuid, p_cooldown_hours integer)
returns json
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_last timestamptz;
  v_rows integer;
begin
  update public.keys
     set bound_hwid = null, hwid_bound_at = null, hwid_reset_at = now()
   where id = p_key_id
     and (p_cooldown_hours <= 0 or hwid_reset_at is null
          or hwid_reset_at < now() - make_interval(hours => p_cooldown_hours));
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return json_build_object('ok', true);
  end if;
  select hwid_reset_at into v_last from public.keys where id = p_key_id;
  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;
  return json_build_object('ok', false, 'reason', 'cooldown',
                           'retry_at', v_last + make_interval(hours => p_cooldown_hours));
end;
$$;

-- Records a successful use from an IP; returns distinct IPs / countries seen for this key in 24h.
create or replace function public.record_key_ip(p_key_id uuid, p_ip text, p_country text)
returns json
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ips integer;
  v_countries integer;
begin
  insert into public.key_ip_history as h (key_id, ip, country)
  values (p_key_id, p_ip, nullif(p_country, ''))
  on conflict (key_id, ip) do update
     set last_seen = now(), uses = h.uses + 1, country = coalesce(excluded.country, h.country);
  update public.keys set last_ip = p_ip, last_seen_at = now() where id = p_key_id;
  select count(distinct ip), count(distinct country)
    into v_ips, v_countries
    from public.key_ip_history
   where key_id = p_key_id and last_seen >= now() - interval '24 hours';
  return json_build_object('ips_24h', v_ips, 'countries_24h', v_countries);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Player session commands (kick / message / announcement / remote code)
-- These used to be queued in each server instance's memory, so on Vercel an admin's kick or
-- message usually never reached the player. Now they're appended atomically in the database.
-- ---------------------------------------------------------------------------------
create or replace function public.push_session_command(p_session_id uuid, p_command jsonb, p_kick boolean)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.sessions
     set pending_commands = coalesce(pending_commands, '[]'::jsonb) || jsonb_build_array(p_command),
         status = case when p_kick then 'kicked' else status end
   where id = p_session_id
  returning true;
$$;

-- Queues a command for every session that pinged within p_max_age_seconds (optionally one script).
create or replace function public.push_command_to_active(p_command jsonb, p_script text, p_max_age_seconds integer, p_kick boolean)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare n integer;
begin
  update public.sessions
     set pending_commands = coalesce(pending_commands, '[]'::jsonb) || jsonb_build_array(p_command),
         status = case when p_kick then 'kicked' else status end
   where status = 'active'
     and last_heartbeat >= now() - make_interval(secs => p_max_age_seconds)
     and (p_script is null or p_script = 'all' or script_id = p_script);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Returns and clears a session's queued commands in one step (no command is delivered twice or lost).
create or replace function public.take_session_commands(p_session_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare v jsonb;
begin
  select pending_commands into v from public.sessions where id = p_session_id for update;
  if not found then
    return '[]'::jsonb;
  end if;
  if v is not null and jsonb_array_length(v) > 0 then
    update public.sessions set pending_commands = '[]'::jsonb where id = p_session_id;
  end if;
  return coalesce(v, '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------------
-- Admin 2FA (Authy / any TOTP app). Secret is AES-256-GCM encrypted by the app.
-- ---------------------------------------------------------------------------------
create table if not exists public.admin_totp (
  id           integer primary key default 1 check (id = 1),
  secret_enc   text not null,
  enabled      boolean not null default false,
  enrolled_at  timestamptz,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Status page
-- ---------------------------------------------------------------------------------
create table if not exists public.status_components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 80),
  kind        text not null default 'service' check (kind in ('website','script','service')),
  script_id   uuid unique references public.scripts(id) on delete cascade,
  status      text not null default 'operational'
                check (status in ('operational','degraded','partial_outage','major_outage','maintenance')),
  message     text check (message is null or char_length(message) <= 500),
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);
create unique index if not exists status_components_one_website on public.status_components (kind) where kind = 'website';

create table if not exists public.status_incidents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 1 and 160),
  body         text check (body is null or char_length(body) <= 4000),
  severity     text not null default 'minor' check (severity in ('minor','major','critical','maintenance')),
  state        text not null default 'investigating'
                 check (state in ('investigating','identified','monitoring','resolved')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists status_incidents_recent_idx on public.status_incidents (created_at desc);

-- ---------------------------------------------------------------------------------
-- Script version history (build contents live in the private Storage bucket)
-- ---------------------------------------------------------------------------------
create table if not exists public.script_versions (
  id                 uuid primary key default gen_random_uuid(),
  script_id          uuid not null references public.scripts(id) on delete cascade,
  version            integer not null,
  storage_path       text not null,
  entry_file         text,
  vm_preset          text,
  obfuscation_stats  jsonb,
  size_bytes         integer,
  note               text check (note is null or char_length(note) <= 200),
  created_at         timestamptz not null default now(),
  unique (script_id, version)
);
create index if not exists script_versions_script_idx on public.script_versions (script_id, version desc);

-- Allocates the next version number atomically (per-script advisory lock) and inserts the row.
create or replace function public.create_script_version(
  p_script_id uuid, p_storage_path text, p_entry_file text, p_vm_preset text,
  p_stats jsonb, p_size integer, p_note text
) returns public.script_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.script_versions;
begin
  perform pg_advisory_xact_lock(hashtext('script_versions:' || p_script_id::text));
  insert into public.script_versions
    (script_id, version, storage_path, entry_file, vm_preset, obfuscation_stats, size_bytes, note)
  values
    (p_script_id,
     coalesce((select max(version) from public.script_versions where script_id = p_script_id), 0) + 1,
     p_storage_path, p_entry_file, p_vm_preset, p_stats, p_size, p_note)
  returning * into v_row;
  return v_row;
end;
$$;

-- Deletes all but the newest p_keep versions; returns the storage paths the app must delete.
create or replace function public.prune_script_versions(p_script_id uuid, p_keep integer)
returns setof text
language sql
security invoker
set search_path = ''
as $$
  delete from public.script_versions v
   where v.script_id = p_script_id
     and v.version not in (
       select version from public.script_versions
        where script_id = p_script_id
        order by version desc
        limit greatest(p_keep, 1))
  returning v.storage_path;
$$;

-- Private bucket for build snapshots (no public access; only the service role can read/write).
do $$ begin
  insert into storage.buckets (id, name, public) values ('script-builds', 'script-builds', false)
  on conflict (id) do nothing;
exception when undefined_table then
  raise notice 'storage.buckets not found — create a private bucket named script-builds in the dashboard';
end $$;

-- ---------------------------------------------------------------------------------
-- Analytics (aggregations run in Postgres instead of shipping rows to the app)
-- A "player" is the Roblox user id when known, otherwise the IP.
-- ---------------------------------------------------------------------------------
create index if not exists execution_logs_player_idx on public.execution_logs (roblox_user_id, created_at) where status = 'success';

create or replace function public.analytics_daily_active(p_from timestamptz, p_script text)
returns table (day date, players integer, executions integer)
language sql stable
security invoker
set search_path = ''
as $$
  select (e.created_at at time zone 'utc')::date,
         count(distinct coalesce(nullif(e.roblox_user_id, ''), e.ip_address))::int,
         count(*)::int
    from public.execution_logs e
   where e.status = 'success' and e.created_at >= p_from
     and (p_script is null or e.script_id = p_script)
   group by 1
   order by 1;
$$;

create or replace function public.analytics_retention(p_from timestamptz, p_script text)
returns json
language sql stable
security invoker
set search_path = ''
as $$
  with ev as (
    select coalesce(nullif(roblox_user_id, ''), ip_address) as u, (created_at at time zone 'utc')::date as d
      from public.execution_logs
     where status = 'success' and (p_script is null or script_id = p_script)
  ),
  firsts as (select u, min(d) as f from ev group by u),
  cohort as (select * from firsts where f >= (p_from at time zone 'utc')::date),
  r as (
    select c.u, c.f,
           bool_or(e.d = c.f + 1)                       as d1,
           bool_or(e.d between c.f + 1 and c.f + 7)     as d7
      from cohort c join ev e on e.u = c.u
     group by c.u, c.f
  )
  select json_build_object(
    'new_players',  count(*),
    'eligible_d1',  count(*) filter (where f <= current_date - 1),
    'returned_d1',  count(*) filter (where f <= current_date - 1 and d1),
    'eligible_d7',  count(*) filter (where f <= current_date - 7),
    'returned_d7',  count(*) filter (where f <= current_date - 7 and d7)
  ) from r;
$$;

-- Distinct players per executor / OS / country over the whole period (not summed per day, which
-- would count a returning player once per day).
drop function if exists public.analytics_breakdown(timestamptz, text, text);
create or replace function public.analytics_breakdown(p_from timestamptz, p_script text, p_dimension text)
returns table (label text, players integer)
language sql stable
security invoker
set search_path = ''
as $$
  select coalesce(nullif(case p_dimension
                           when 'executor' then e.executor
                           when 'os'       then e.os
                           when 'country'  then e.country
                         end, ''), 'Unknown'),
         count(distinct coalesce(nullif(e.roblox_user_id, ''), e.ip_address))::int
    from public.execution_logs e
   where e.status = 'success' and e.created_at >= p_from
     and (p_script is null or e.script_id = p_script)
     and p_dimension in ('executor','os','country')
   group by 1
   order by 2 desc
   limit 12;
$$;

create or replace function public.analytics_checkpoint_funnel(p_from timestamptz, p_script text)
returns json
language sql stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'started',   (select count(distinct session_id) from public.checkpoint_logs
                   where stage = 'started' and session_id is not null and created_at >= p_from
                     and (p_script is null or script_id = p_script)),
    'steps',     coalesce((select json_agg(json_build_object('step', step_index, 'sessions', n) order by step_index)
                   from (select step_index, count(distinct session_id) as n from public.checkpoint_logs
                          where stage = 'step_completed' and session_id is not null and step_index is not null
                            and created_at >= p_from and (p_script is null or script_id = p_script)
                          group by step_index) s), '[]'::json),
    'completed', (select count(distinct session_id) from public.checkpoint_logs
                   where stage = 'completed' and session_id is not null and created_at >= p_from
                     and (p_script is null or script_id = p_script)),
    'claimed',   (select count(*) from public.keys
                   where claimed_at >= p_from and (p_script is null or script_id = p_script))
  );
$$;

create or replace function public.analytics_key_usage(p_script text)
returns json
language sql stable
security invoker
set search_path = ''
as $$
  select json_build_object(
    'total',      count(*),
    'unclaimed',  count(*) filter (where status = 'unclaimed'),
    'claimed',    count(*) filter (where status = 'claimed'),
    'active',     count(*) filter (where status = 'active'),
    'banned',     count(*) filter (where status = 'banned'),
    'activated',  count(*) filter (where activated_at is not null),
    'used_7d',    count(*) filter (where last_seen_at >= now() - interval '7 days'),
    'expired',    count(*) filter (where expires_at is not null and expires_at < now()),
    'hwid_bound', count(*) filter (where bound_hwid is not null)
  )
  from public.keys
  where (p_script is null or script_id = p_script);
$$;

-- ---------------------------------------------------------------------------------
-- Lockdown (re-applied so the new tables/functions get the same treatment)
-- ---------------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;

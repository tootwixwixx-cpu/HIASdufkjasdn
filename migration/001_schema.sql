-- =====================================================================================
-- 001_schema.sql  —  Hardened schema for the NEW Supabase project
-- Run the whole file once in the new project's SQL Editor (it runs as a single
-- transaction: if any statement fails, nothing is applied — fix and re-run).
--
-- Design goals vs. the old database
--   1. NO direct API access. Every table has RLS enabled with ZERO policies, and
--      anon/authenticated have all privileges revoked. The old DB had `FOR ALL TO public
--      USING (true)` on every table, i.e. anyone with the (public) anon key could read/write/
--      delete keys, script source, sessions and settings straight through the REST API.
--      The app talks to the DB only with the server-side secret/service_role key.
--   2. Column names stay compatible with the current app code (lib/store.ts), so the app
--      works unchanged against this schema.
--   3. Real constraints + indexes (the old DB had almost no indexes beyond PKs; the app's
--      hot queries were sequential scans).
--   4. Server-side atomic functions for the things that were racy or per-instance memory:
--      key claiming, rate limiting, nonce/replay protection, probe challenge sessions.
--   5. Audit log + retention helpers.
-- =====================================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_stat_statements with schema extensions;

-- ---------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------
-- Core: loader configs, scripts
-- ---------------------------------------------------------------------------------
create table public.loader_configs (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 120),
  brand_name           text not null default 'ATOMPROTECT',
  title                text not null default 'Script Authentication',
  accent_color         text not null default '#00a2ff',
  background_color     text not null default '#16161e',
  card_color           text not null default '#21222e',
  text_color           text not null default '#ffffff',
  subtext_color        text not null default '#9ca3af',
  corner_radius        integer not null default 10 check (corner_radius between 0 and 200),
  frame_width          integer not null default 360 check (frame_width between 50 and 4000),
  frame_height         integer not null default 250 check (frame_height between 50 and 4000),
  font_face            text not null default 'GothamMedium',
  show_brand_icon      boolean not null default true,
  custom_subtitle      text not null default 'Enter your license key below',
  key_placeholder      text default 'Paste your license key here...',
  verify_button_text   text default 'VERIFY KEY',
  claim_button_text    text default 'CLAIM YOUR KEY (COPY LINK)',
  show_discord_button  boolean default false,
  discord_button_text  text default 'JOIN DISCORD',
  discord_invite_url   text default '',
  show_watermark       boolean default true,
  watermark_text       text default 'ATOMPROTECT',
  status_verifying     text default 'Checking license key...',
  status_verified      text default 'Access Granted! Loading script...',
  status_expired       text default 'License key expired or invalid.',
  status_error         text default 'Verification failed. Check network or key.',
  logo_url             text default '',
  show_logo            boolean default false,
  layout_positions     jsonb default '{}'::jsonb,
  webhook_enabled      boolean not null default false,
  -- Only Discord webhooks are accepted (stops this being used as a generic server-side request target).
  webhook_url          text default '' check (
                         webhook_url is null or webhook_url = ''
                         or webhook_url ~ '^https://((ptb|canary)\.)?(discord|discordapp)\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+(\?[A-Za-z0-9_=&-]*)?$'
                       ),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.scripts (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(name) between 1 and 120),
  slug                   text not null unique check (slug ~ '^[a-z0-9_-]{1,64}$'),
  entry_file             text not null default 'main.lua',
  modules                jsonb not null default '{}'::jsonb,
  loader_config_id       uuid references public.loader_configs(id) on delete set null,
  watermark_text         text not null default 'ATOMPROTECT',
  show_watermark         boolean not null default true,
  is_active              boolean not null default true,
  use_auth               boolean not null default true,
  is_maintenance         boolean not null default false,
  maintenance_message    text,
  lua_code               text default '',
  github_repo            text,
  github_branch          text default 'main',
  github_directory       text,
  -- NOTE: stored as plain text today. Encrypt at the application layer before storing (see SECURITY_REVIEW.md).
  github_token           text,
  github_auto_pull       boolean not null default false,
  github_last_commit     text,
  github_last_pulled_at  timestamptz,
  is_obfuscated          boolean not null default true,
  obfuscated_at          timestamptz,
  obfuscation_stats      jsonb,
  vm_preset              text default 'balanced' check (vm_preset in ('balanced','maximum','ultra','debug')),
  obfuscated_payload     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index scripts_active_idx on public.scripts (is_active);
create index scripts_loader_config_idx on public.scripts (loader_config_id);
create trigger scripts_set_updated_at before update on public.scripts
  for each row execute function public.set_updated_at();
create trigger loader_configs_set_updated_at before update on public.loader_configs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------
-- Licensing
-- ---------------------------------------------------------------------------------
create table public.keys (
  id                    uuid primary key default gen_random_uuid(),
  key_string            text not null unique check (key_string ~ '^[A-Za-z0-9_-]{6,64}$'),
  -- 'all' = universal key, otherwise a scripts.id. (Kept as text because the app uses the 'all' sentinel.)
  script_id             text not null default 'all'
                          check (script_id = 'all' or script_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  status                text not null default 'unclaimed' check (status in ('unclaimed','claimed','active','banned')),
  duration_hours        integer check (duration_hours is null or duration_hours > 0),
  claimed_ip            text,
  claimed_discord_id    text,
  claimed_discord_tag   text,
  claimed_at            timestamptz,
  activated_at          timestamptz,
  expires_at            timestamptz,
  is_staff_review       boolean not null default false,
  notes                 text,
  ip_reset_at           timestamptz,   -- last self-service IP re-bind (12h cooldown); was a tag inside `notes`
  created_at            timestamptz not null default now()
);
-- hot paths: claim the oldest unclaimed key; find a key bound to an IP; per-script listing
create index keys_unclaimed_idx   on public.keys (created_at) where status = 'unclaimed';
create index keys_claimed_ip_idx  on public.keys (claimed_ip) where status in ('claimed','active');
create index keys_script_idx      on public.keys (script_id);
create index keys_expires_idx     on public.keys (expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------------
-- Runtime: sessions, commands, staff review
-- ---------------------------------------------------------------------------------
create table public.sessions (
  id                uuid primary key default gen_random_uuid(),
  key_id            text,
  script_id         text,
  ip_address        text not null,
  hwid              text,
  roblox_username   text,
  roblox_user_id    text,
  avatar_url        text,
  place_id          text,
  place_name        text,
  job_id            text,
  status            text not null default 'active'
                      check (status in ('loading','active','kicked','tampered','expired','disconnected')),
  loader_token      text,
  executor          text,
  tamper_flags      jsonb not null default '[]'::jsonb,
  pending_commands  jsonb not null default '[]'::jsonb,
  country           text,
  city              text,
  latitude          double precision,
  longitude         double precision,
  session_started   timestamptz not null default now(),
  last_heartbeat    timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index sessions_active_idx        on public.sessions (last_heartbeat desc) where status = 'active';
create index sessions_heartbeat_idx     on public.sessions (last_heartbeat desc);
create index sessions_loader_token_idx  on public.sessions (loader_token) where loader_token is not null;
create index sessions_ip_idx            on public.sessions (ip_address);
create index sessions_user_idx          on public.sessions (roblox_user_id) where roblox_user_id is not null;

create table public.session_commands (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid references public.sessions(id) on delete cascade,
  command_type text not null check (command_type in ('kick','message','announcement','execute_code','teleport')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending','delivered','executed','failed')),
  created_by   text not null default 'admin',
  executed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index session_commands_session_idx on public.session_commands (session_id, status);

create table public.staff_reviews (
  id                text primary key,
  key_id            text not null,
  script_id         text not null,
  script_name       text not null,
  key_label         text not null default 'Staff Key',
  status            text not null default 'reviewing',
  review_started    timestamptz not null default now(),
  last_heartbeat    timestamptz not null default now(),
  duration_seconds  integer not null default 0,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Logs & analytics
-- ---------------------------------------------------------------------------------
create table public.execution_logs (
  id               uuid primary key default gen_random_uuid(),
  script_id        text,
  script_name      text not null,
  roblox_username  text,
  roblox_user_id   text,
  avatar_url       text,
  place_id         text,
  place_name       text,
  job_id           text,
  ip_address       text not null,
  isp              text,
  os               text,
  executor         text,
  key_last4        text,
  status           text not null check (status in ('success','failed')),
  failure_reason   text,
  country          text,
  city             text,
  latitude         double precision,
  longitude        double precision,
  created_at       timestamptz not null default now()
);
create index execution_logs_created_idx on public.execution_logs (created_at desc);
create index execution_logs_script_idx  on public.execution_logs (script_id, created_at desc);
create index execution_logs_status_idx  on public.execution_logs (status, created_at desc);

create table public.client_errors (
  id               text primary key,
  session_id       text,
  script_id        text,
  script_name      text,
  roblox_username  text,
  roblox_user_id   text,
  executor         text,
  os               text,
  error_message    text not null check (char_length(error_message) <= 2000),
  stack_trace      text check (stack_trace is null or char_length(stack_trace) <= 6000),
  created_at       timestamptz not null default now()
);
create index client_errors_created_idx on public.client_errors (created_at desc);

create table public.checkpoints (
  id               text primary key,
  script_id        text not null default 'all',
  title            text not null,
  url              text not null check (url ~* '^https?://'),
  duration_seconds integer not null default 5 check (duration_seconds >= 0),
  "order"          integer not null default 1,
  created_at       timestamptz not null default now()
);
create index checkpoints_script_order_idx on public.checkpoints (script_id, "order");

create table public.checkpoint_logs (
  id                uuid primary key default gen_random_uuid(),
  script_id         text,
  ip_address        text not null,
  stage             text not null,
  step_index        integer,
  checkpoint_title  text,
  session_id        text,
  created_at        timestamptz not null default now()
);
create index checkpoint_logs_created_idx on public.checkpoint_logs (created_at desc);
-- used by the server-side "steps must be completed in order" check
create index checkpoint_logs_session_idx on public.checkpoint_logs (session_id, stage, step_index) where session_id is not null;

create table public.bypass_attempts (
  id          uuid primary key default gen_random_uuid(),
  ip_address  text not null,
  hwid        text,
  script_id   text,
  step_index  integer,
  reason      text not null,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index bypass_attempts_ip_idx      on public.bypass_attempts (ip_address);
create index bypass_attempts_hwid_idx    on public.bypass_attempts (hwid) where hwid is not null;
create index bypass_attempts_created_idx on public.bypass_attempts (created_at desc);

-- ---------------------------------------------------------------------------------
-- Bans
-- ---------------------------------------------------------------------------------
create table public.banned_ips (
  ip_address text primary key,
  reason     text not null default 'Manual ban or tamper detection',
  banned_at  timestamptz not null default now()
);
create table public.banned_hwids (
  hwid       text primary key,
  ip_address text,
  reason     text not null default 'Bypass attempts exceeded threshold (3x)',
  banned_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Settings / profile / content
-- ---------------------------------------------------------------------------------
create table public.system_settings (
  id                        integer primary key default 1 check (id = 1),
  claim_method              text not null default 'checkpoints' check (claim_method in ('checkpoints','discord_oauth')),
  checkpoint_delay_seconds  integer not null default 5 check (checkpoint_delay_seconds between 0 and 600),
  discord_guild_id          text default '',
  -- Do NOT store the bot token here; keep it in the DISCORD_BOT_TOKEN env var. Column kept only
  -- because the current app code selects/upserts it; the migration script blanks it.
  discord_bot_token         text default '',
  discord_invite_url        text default '',
  vpn_detection_enabled     boolean not null default true,
  chatroom_cooldown_seconds integer not null default 3 check (chatroom_cooldown_seconds between 0 and 3600),
  tos_content               text default '',
  updated_at                timestamptz not null default now()
);
create trigger system_settings_set_updated_at before update on public.system_settings
  for each row execute function public.set_updated_at();

create table public.creator_profile (
  id              integer primary key default 1 check (id = 1),
  display_name    text not null default 'Creator',
  bio             text default '',
  avatar_url      text default '',
  raw_avatar_url  text,
  accent_color    text default '#00a2ff',
  emblems         jsonb not null default '[]'::jsonb,
  socials         jsonb not null default '{}'::jsonb,
  social_toggles  jsonb not null default '{}'::jsonb,
  badge_toggles   jsonb not null default '{}'::jsonb,
  updated_at      timestamptz not null default now()
);
create trigger creator_profile_set_updated_at before update on public.creator_profile
  for each row execute function public.set_updated_at();

create table public.global_announcements (
  id                uuid primary key default gen_random_uuid(),
  script_id         text not null default 'all',
  title             text not null,
  message           text not null,
  duration_seconds  integer not null default 10 check (duration_seconds between 1 and 600),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------
-- Chat / DMs
-- ---------------------------------------------------------------------------------
create table public.chatroom_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  username      text not null,
  display_name  text,
  avatar_url    text,
  message       text not null check (char_length(message) between 1 and 1000),
  is_dev        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index chatroom_messages_created_idx on public.chatroom_messages (created_at desc);
create index chatroom_messages_user_idx    on public.chatroom_messages (user_id, created_at desc);

create table public.chatroom_blacklist (
  id          uuid primary key default gen_random_uuid(),
  word        text not null unique,
  created_at  timestamptz not null default now()
);

create table public.dev_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  username      text not null,
  display_name  text,
  avatar_url    text,
  sender_type   text not null check (sender_type in ('user','dev')),
  message       text not null check (char_length(message) between 1 and 2000),
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index dev_messages_thread_idx on public.dev_messages (user_id, created_at);
create index dev_messages_unread_idx on public.dev_messages (read) where read = false;

-- ---------------------------------------------------------------------------------
-- Auth / mobile (tables the app and mobile client already reference)
-- ---------------------------------------------------------------------------------
create table public.auth_probe_tokens (
  token           text primary key,
  script_slug     text not null,
  ip_address      text not null,
  hwid            text,
  challenge_seed  text not null,
  is_used         boolean not null default false,
  expires_at      timestamptz not null,
  created_at      timestamptz not null default now()
);
create index auth_probe_tokens_expires_idx on public.auth_probe_tokens (expires_at);

create table public.admin_sessions (
  id               uuid primary key default gen_random_uuid(),
  token_hash       text not null unique,
  admin_username   text not null,
  device_info      text,
  ip_address       text,
  is_active        boolean not null default true,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  last_active_at   timestamptz not null default now()
);
create index admin_sessions_expires_idx on public.admin_sessions (expires_at);

create table public.mobile_devices (
  id                     uuid primary key default gen_random_uuid(),
  admin_id               text not null default 'admin',
  device_token           text not null unique,
  device_name            text,
  platform               text not null default 'android' check (platform in ('android','ios','web')),
  fcm_push_token         text,
  notifications_enabled  boolean not null default true,
  notify_on_bypass       boolean not null default true,
  notify_on_alt_farm     boolean not null default true,
  notify_on_new_dm       boolean not null default true,
  notify_on_error        boolean not null default false,
  last_seen_at           timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create table public.admin_notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('tamper_alert','bypass_lockout','alt_farm_detected','new_dm','client_error','system_event')),
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index admin_notifications_unread_idx on public.admin_notifications (created_at desc) where read = false;

-- ---------------------------------------------------------------------------------
-- NEW: shared security state (replaces per-process in-memory Maps that don't work on serverless)
-- ---------------------------------------------------------------------------------
create table public.rate_limits (
  bucket        text not null,
  key           text not null,
  window_start  timestamptz not null,
  count         integer not null default 0,
  primary key (bucket, key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);

create table public.used_nonces (
  nonce       text primary key,
  expires_at  timestamptz not null
);
create index used_nonces_expires_idx on public.used_nonces (expires_at);

create table public.probe_sessions (
  session_id  text primary key,
  slug        text not null,
  salt        text not null,
  expected    integer not null,
  ip          text not null,
  expires_at  timestamptz not null
);
create index probe_sessions_expires_idx on public.probe_sessions (expires_at);

-- Append-only record of privileged admin actions (wire into the admin routes as a follow-up).
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor       text not null default 'admin',
  action      text not null,
  target      text,
  ip_address  text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------------
-- Atomic / server-side functions (callable ONLY by the service role; SECURITY INVOKER, so they run
-- with service_role's own privileges — no privilege elevation)
-- ---------------------------------------------------------------------------------

-- Fixed-window rate limiter. Returns TRUE if the call is within the limit, FALSE if it should be blocked.
create or replace function public.rate_limit_hit(
  p_bucket text, p_key text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  if p_window_seconds < 1 then p_window_seconds := 1; end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (bucket, key, window_start, count)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  return v_count <= p_limit;
end;
$$;

-- TRUE the first time a nonce is seen within its TTL, FALSE on replay.
create or replace function public.consume_nonce(p_nonce text, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows integer;
begin
  delete from public.used_nonces where nonce = p_nonce and expires_at < now();
  insert into public.used_nonces (nonce, expires_at)
  values (p_nonce, now() + make_interval(secs => p_ttl_seconds))
  on conflict (nonce) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function public.create_probe_session(
  p_session_id text, p_slug text, p_salt text, p_expected integer, p_ip text, p_ttl_seconds integer
) returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.probe_sessions (session_id, slug, salt, expected, ip, expires_at)
  values (p_session_id, p_slug, p_salt, p_expected, p_ip, now() + make_interval(secs => p_ttl_seconds));
$$;

-- Single-use: returns and deletes the session, or no row if missing/expired.
create or replace function public.consume_probe_session(p_session_id text)
returns table (slug text, salt text, expected integer, ip text)
language sql
security invoker
set search_path = ''
as $$
  delete from public.probe_sessions p
  where p.session_id = p_session_id and p.expires_at > now()
  returning p.slug, p.salt, p.expected, p.ip;
$$;

-- Atomically claim ONE unclaimed, non-staff, non-lifetime key. FOR UPDATE SKIP LOCKED means two
-- concurrent claimants can never receive the same key (the old select-then-update could).
create or replace function public.claim_key(
  p_script_id text, p_ip text, p_discord_id text, p_discord_tag text
) returns setof public.keys
language sql
security invoker
set search_path = ''
as $$
  with picked as (
    select k.id
    from public.keys k
    where k.status = 'unclaimed'
      and k.is_staff_review = false
      and k.duration_hours is not null
      and coalesce(k.claimed_discord_tag, '') <> 'STAFF_REVIEW'
      and coalesce(k.claimed_discord_id, '')  <> 'STAFF_REVIEW'
      and (
        k.script_id = 'all'
        or coalesce(p_script_id, 'all') = 'all'
        or k.script_id = p_script_id
      )
    order by (k.script_id = p_script_id) desc, k.created_at asc
    limit 1
    for update skip locked
  )
  update public.keys k
  set status = 'claimed',
      claimed_ip = p_ip,
      claimed_at = now(),
      expires_at = null,
      activated_at = null,
      script_id = case
        when coalesce(p_script_id, 'all') <> 'all' and k.script_id = 'all' then p_script_id
        else k.script_id
      end,
      claimed_discord_id  = coalesce(p_discord_id,  k.claimed_discord_id),
      claimed_discord_tag = coalesce(p_discord_tag, k.claimed_discord_tag)
  from picked
  where k.id = picked.id
  returning k.*;
$$;

-- Retention for the security tables. Scheduled below when pg_cron is available.
create or replace function public.prune_security_tables()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.rate_limits       where window_start < now() - interval '1 day';
  delete from public.used_nonces       where expires_at   < now();
  delete from public.probe_sessions    where expires_at   < now();
  delete from public.auth_probe_tokens where expires_at   < now() - interval '1 day';
  delete from public.admin_sessions    where expires_at   < now();
$$;

-- ---------------------------------------------------------------------------------
-- LOCKDOWN: RLS on, no policies, no anon/authenticated access to anything.
-- (The service_role / secret key bypasses RLS by design — that is the only key the server uses.)
-- RLS is deliberately NOT forced: forcing would also apply it to the table owner (postgres), which
-- would block pg_cron jobs and make the dashboard Table Editor show empty tables.
-- ---------------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end
$$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

commit;

-- ---------------------------------------------------------------------------------
-- Optional (run separately, AFTER the commit above): schedule retention with pg_cron.
-- Enable the extension first in Dashboard → Database → Extensions → pg_cron.
-- ---------------------------------------------------------------------------------
-- select cron.schedule('prune-security-tables', '*/15 * * * *', $$select public.prune_security_tables()$$);

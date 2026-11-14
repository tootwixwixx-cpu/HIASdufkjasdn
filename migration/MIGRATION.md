# Migration runbook: old Supabase → new hardened project

Do the steps in order. **Do not delete the old project until step 9.** Everything here is
re-runnable, so you can stop and resume.

## 0. Do this first (2 minutes): close the hole in the OLD database

The old DB lets anyone with the public anon key read/write every table through the REST API
(`FOR ALL TO public USING (true)` on every table). Your server uses the service-role key, which is
unaffected by this, so it is safe to run **right now** in the old project's SQL Editor:

```sql
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
```

## 1. Create the new project

Supabase dashboard → New project. Pick the region closest to your Vercel region (check
Vercel → Settings → Functions → Region), set a strong database password, and note the **project ref**.
Use at least a Small compute size — the old database was starved (timeouts, pool exhaustion),
which is partly a size problem.

## 2. Apply the schema

New project → SQL Editor → paste all of `migration/001_schema.sql` → Run. It is one transaction:
either everything applies or nothing does. (I could only test against a read-only connection to the
old project, so if it errors, paste me the message and I'll fix it.)

Then (optional but recommended) Database → Extensions → enable **pg_cron**, and run:

```sql
select cron.schedule('prune-security-tables', '*/15 * * * *', $$select public.prune_security_tables()$$);
```

## 3. Get the new keys

Project Settings → API Keys. The server needs the **service_role** (or new "secret") key.
Never put it in a `NEXT_PUBLIC_*` variable and never commit it.

## 4. Dry-run, then copy the data

```powershell
$env:OLD_SUPABASE_URL = "https://oklrhdhwuffkzumssayu.supabase.co"
$env:OLD_SUPABASE_KEY = "<old service_role key>"
$env:NEW_SUPABASE_URL = "https://<new-ref>.supabase.co"
$env:NEW_SUPABASE_KEY = "<new service_role key>"

node migration/migrate-data.mjs --dry-run     # reads old DB only; prints counts
node migration/migrate-data.mjs               # copies + verifies row counts
```

Expected counts from the old DB: loader_configs 1, scripts 4, keys 146, checkpoints 12,
bypass_attempts 36, chatroom_blacklist 65, chatroom_messages 83, dev_messages 27, staff_reviews 6,
execution_logs 182, checkpoint_logs 677, banned_ips 7, banned_hwids 1.

Not copied on purpose: `sessions` (live players simply re-ping), `auth_probe_tokens`,
`session_commands`, `admin_sessions`. The stored `discord_bot_token` is blanked.
One key points at a script that was deleted; it is reported and left as-is.

## 5. Rotate secrets and set the new env vars

Generate fresh values (PowerShell): `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`

| Variable | Action |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | new project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | new project key |
| `AUTH_SECRET` | **new** (also logs out every admin session) |
| `ANTI_BYPASS_SECRET` | **new** (invalidates in-flight claim tokens — fine) |
| `CRON_SECRET` | **new** |
| `ADMIN_PASSWORD` | **new**, long and unique |
| `DISCORD_BOT_TOKEN` | **new** — the old one lived in a DB anyone could read |
| `WORKINK_API_KEY` | keep, or regenerate to be safe |
| `TRUSTED_PROXY` | leave unset on Vercel (it uses `x-vercel-forwarded-for` automatically) |
| `HUB_TELEMETRY_WEBHOOK_URL` | **new** Discord webhook for hub telemetry (the old one was public in client Lua) |
| `ADMIN_TOTP_SECRET` | optional 2FA — `node migration/make-totp-secret.mjs`. Leave unset until the mobile app supports codes |
| `ADMIN_SESSION_HOURS` | optional, default 24 |
| `ALLOWED_ORIGINS` | optional; only if a browser app on another domain calls the API |

Set them in Vercel → Project → Settings → Environment Variables (Production), and in your local
`.env.local`. See `.env.example` for the full list.

## 6. Deploy the code

The security fixes are already in this working tree but **not committed**. Review with
`git diff`, then commit and push. The app falls back to in-memory behavior if the new SQL
functions are missing, so deploy the schema (step 2) **before** or together with the code.

## 7. Verify (10 minutes)

1. Log in to the dashboard; Scripts, Keys, Players, Analytics load.
2. Open a script's loader URL from an executor → Stage 0 loads → key prompt appears.
3. Claim flow end to end with checkpoints; claim a key; verify it in-game; confirm the player
   shows on the Players page and heartbeats keep it alive.
4. **Anon-key lockout test** (should FAIL with permission denied — that is the pass condition):
   ```powershell
   curl "https://<new-ref>.supabase.co/rest/v1/keys?select=*" -H "apikey: <new ANON key>" -H "Authorization: Bearer <new ANON key>"
   ```
5. Dashboard → Advisors → Security: no "RLS disabled" / "policy always true" findings.
6. In the old project you can confirm the improvement: `select count(*) from keys` via the
   Supabase query tool with the old anon key should now be denied too (after step 0).

## 8. Final delta before you stop using the old DB

Right after switching the env vars, re-run `node migration/migrate-data.mjs` once more. It is
idempotent and picks up keys claimed / logs written on the old DB since the first copy.

## 9. Decommission

1. Keep the old project **paused, not deleted**, for about a week as a rollback.
2. Then delete it. Also delete / rotate the *other* project, ref `ikreiagzqwzzihnfhooy` — its
   service-role key (valid until 2036) was committed in this repo's first commit.
3. Revoke the personal access tokens you pasted into chat (Supabase `sbp_…` and GitHub `ghp_…`).
4. Delete and recreate the Discord webhook that is embedded in `hub/**/*.lua`.

## Rollback

Point `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` back at the old project and
redeploy. No data was deleted from it.

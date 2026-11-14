# Security & performance review

Scope: the Next.js app (`app/`, `lib/`, `proxy.ts`), the Supabase database, and the files that ship
to clients (`hub/`, `scripts/`, `tools/`). `npm audit --omit=dev` reports 0 vulnerabilities.

Status legend: **FIXED (code)** = changed in this working tree · **FIXED (schema)** = fixed by
`001_schema.sql` · **YOU** = needs an action only you can take · **OPEN** = not fixed yet, see notes.

## Critical

| # | Finding | Status |
|---|---|---|
| 1 | **Every table was world-readable/writable.** All 22 tables had `FOR ALL TO public USING (true)`, and `anon` held full grants. Anyone with the public anon key could read, edit or delete keys, script source, sessions, bans and settings (incl. the stored Discord bot token) through `/rest/v1/*`. `auth_probe_tokens` had RLS off entirely. | **FIXED (schema)**: RLS enabled + forced, no policies, anon/authenticated revoked. Interim fix for the old DB: `MIGRATION.md` step 0. |
| 2 | **Auth bypass on module download.** `GET /api/loader/<slug>/<module>?session=staff_review` (or `x-session-id: staff_review`) was authorized on the string prefix alone → anyone could download the raw, unobfuscated source of every module of every script. | **FIXED (code)**: must be a real `staff_review_<uuid>` row. |
| 3 | **Service-role key committed to git.** `tools/{test_bundle,reproduce_error,inspect_bundle,find_line_1562}.js` hardcoded a Supabase `service_role` JWT for project `ikreiagzqwzzihnfhooy` (expires 2036) in the first commit. | Scrubbed from files (**FIXED (code)**) but it is still in git history → **YOU**: delete/rotate that project (if the repo is or was public, assume the key is compromised). |
| 4 | **Secrets shipped to clients / stored in DB.** A live Discord webhook URL is embedded in `hub/**/*.lua` (every user can read it and spam/delete it); the Discord bot token was stored in `system_settings` (readable via #1). | **FIXED (code)**: the hub now posts to `/api/telemetry/webhook`, a validating, rate-limited relay; the real URL lives only in the `HUB_TELEMETRY_WEBHOOK_URL` env var. **YOU**: delete + recreate the old webhook (it is still in git history and in any already-uploaded script payload — re-upload the hub script so users get the new Lua). Bot token is no longer migrated (use the env var). |

## High

| # | Finding | Status |
|---|---|---|
| 5 | **Reflected XSS** on `/api/loader/<slug>` (and `/loader/<slug>`): the URL slug was printed unescaped into the "protected" HTML page, and into generated Lua. Any link could run script on your origin (same-origin requests carry the admin cookie). | **FIXED (code)**: slugs must match `[a-z0-9_-]{1,64}`; maintenance message properly escaped for Lua. |
| 6 | **Checkpoint chain could be skipped.** All step tokens were issued up front and steps weren't chained, so a client could verify only the last step (4096 hashes of PoW + the dwell time) and get a claim token. Work.ink verification also trusted client-supplied `totalSteps`/`stepIndex`/`script_id` (one valid token + `totalSteps:1` = claim token). | **FIXED (code)**: step N requires step N-1 recorded server-side for that session; totals/script derived on the server; claim tokens bound to their script and single-use across instances. PoW difficulty raised 3 → 4 (**FIXED (code)**); the server-side dwell time and step ordering are the real controls. |
| 7 | **`discord_oauth` claim mode was an honor system.** It trusted a client-supplied `discord_user` object (the page sends whatever name is typed). Anyone could claim unlimited keys. Not exploitable today (`claim_method` is `checkpoints`) but one dashboard toggle away. | **FIXED (code)**: server refuses that mode (501) until real OAuth exists. |
| 8 | **Security state lived in process memory.** Rate limits, replay-nonce cache, used claim tokens and the probe challenge sessions were `Map`s. On Vercel every instance has its own, so limits/replay protection mostly didn't apply, and a probe `GET` and its `POST` landing on different instances **failed for honest users**; the in-memory "3 strikes" bypass counter could also ban real users. | **FIXED (schema + code)**: Postgres-backed `rate_limit_hit`, `consume_nonce`, `*_probe_session`. Deploy the schema first. |
| 9 | **Admin login had no brute-force protection**; 500 responses echoed internal error text. | **FIXED (code)**: 8 attempts / 15 min / IP, generic errors. |
| 10 | **Admin auth model is weak.** One shared static password, stateless 7-day bearer token that cannot be revoked, no 2FA — and the admin API can push arbitrary Lua (`execute_code`) to every connected player. Admin compromise = code execution on all your users. | **FIXED (code)**: server-side revocable sessions (`admin_sessions`; logout now truly invalidates, plus "sign out everywhere"), 24h lifetime (`ADMIN_SESSION_HOURS`), optional TOTP 2FA (`ADMIN_TOTP_SECRET`, enforced when set; codes are single-use), and an `audit_log` trail for logins, key/script/settings changes, bans and `execute_code`. **YOU**: turn 2FA on (`node migration/make-totp-secret.mjs`) — but the mobile app login has no code field yet. **OPEN (optional)**: IP allow-list for the dashboard. |
| 11 | **Key claim race.** Select-then-update let two concurrent claimants get the same key. | **FIXED (schema + code)**: atomic `claim_key()` with `FOR UPDATE SKIP LOCKED`. |
| 12 | **Heartbeat revived unknown sessions.** Pinging any random UUID created a new ACTIVE session with no key → unlimited fake online players. | **FIXED (code)**: unknown sessions are ignored (fails open for real players). |
| 13 | **`createHmac` with an empty secret still signs** — "fails closed" in `anti-bypass.ts` wasn't true; a missing `ANTI_BYPASS_SECRET` let anyone forge tokens. | **FIXED (code)**: throws / rejects. |
| 14 | `lib/supabase.ts` silently fell back to the **anon** key when the service key was unset. | **FIXED (code)**: no fallback. |

## Medium / hardening

| # | Finding | Status |
|---|---|---|
| 15 | `GET /api/claim` returns the full license key to **anyone sharing the claimant's IP** (CGNAT, dorms, VPN exits). | **FIXED (code)**: the full key is only returned to the browser that claimed it (signed per-key cookie); anyone else on the IP gets a masked key and must complete the checkpoints again. |
| 16 | `reset_ip` lets anyone who has a key string re-bind it to their own IP (12h cooldown); the cooldown is stored as a `[IP_RESET:…]` tag inside the free-text `notes` field. | Rate limited and the cooldown now lives in a dedicated `ip_reset_at` column (**FIXED (code + schema)**; legacy tag still honoured). **OPEN (optional)**: notify/confirm on re-bind. |
| 17 | **DM / chat IDOR.** `GET /api/chatroom/dms?userId=<any roblox id>` returns that player's whole thread; anyone can post/mark-read for any `userId`; chat `userId`/`username`/`avatarUrl` are client-supplied. | **FIXED (code)**: reading/writing a DM thread or posting in chat now requires an authenticated key session for that exact Roblox user **from the same IP**; the identity stored comes from the session, not the request body (no widget change needed). Length caps added. Residual: someone on the same network (same IP) who is also an authenticated player could still act as another authenticated player on that IP. |
| 18 | `github_token` (per-script GitHub PAT) stored and returned to the dashboard in plaintext. | **OPEN**: encrypt at rest (AES-GCM with an env key) and never return it to the browser. |
| 19 | Unauthenticated write endpoints (`loader-ping`, `telemetry/errors`) could be used to bloat the DB. | **FIXED (code)**: rate limits + size caps. |
| 20 | Public `GET /api/scripts` loaded every script's multi-MB payload for anonymous callers (DoS amplifier). | **FIXED (code)**: metadata-only for non-admins. |
| 21 | VPN/ISP lookup calls `http://ip-api.com` (plain HTTP, free tier 45 req/min, fails open) on the request path, sending visitor IPs to a third party. | **OPEN**: use a paid/HTTPS provider and cache results. |
| 22 | CORS `*` on every API route, including admin routes (token-based, so not directly exploitable). | **FIXED (code)**: wildcard removed; same-origin + `ALLOWED_ORIGINS` allowlist, plus baseline security headers (HSTS, nosniff, referrer policy, frame protection). |
| 23 | `avatar-proxy` followed redirects, allowed plain http and had no size/type cap. | **FIXED (code)**: https only, no redirects, image content-types only, 2 MB cap, sandboxing CSP. |
| 24 | `lib/store.ts` keeps a second "local JSON DB" next to Supabase and merges the two (stale/divergent state, extra FS work). | **OPEN**: remove after migration; make Supabase the only source of truth. |
| 25 | Many routes return `err.message` to callers on 500. | **FIXED (code)** on all public routes via `lib/http-errors.ts` (admin-only routes still return detail to authenticated admins). |
| 26 | The probe "attestation" is computed by the client, so any script can solve it. It is anti-casual-scraping only; real protection is the key + IP binding + payload only released after `/verify`. | Informational. |

## Performance findings (cause of the overload)

- `ilike` on `scripts.slug` can't use the btree index → sequential scans (28,736 on a 4-row table) **and** `select=*` pulled ~1.7 MB rows each time. **FIXED (code)** in the earlier commit, plus 5 s cache.
- `session/heartbeat` (every player, every ~15–30 s) loaded the **entire keys table** and up to 200 session rows. **FIXED (code)**: one PK lookup + a cached COUNT.
- `loader/[slug]/[...modulePath]` loaded the entire keys table per module request. **FIXED (code)**.
- No secondary indexes at all in the old DB; stale-session cleanup `PATCH` on every dashboard poll. **FIXED (schema)** indexes; cleanup throttling **OPEN**.
- `pg_stat_statements` was not enabled; **FIXED (schema)**.

## Not changed by me (needs your decision)

- Whether to keep Work.ink checkpoints as the only claim method (the Discord path is now disabled).
- The in-game widgets (`hub/modules/chatroom_widget.lua`, `scripts/rivals/chatroom_widget.lua`) need a small change for #17.
- The `claim` page change for #15.

#!/usr/bin/env node
/**
 * migrate-data.mjs — copy data from the OLD Supabase project to the NEW (hardened) one.
 *
 * Usage (PowerShell), from the repo root:
 *   $env:OLD_SUPABASE_URL="https://<old-ref>.supabase.co"
 *   $env:OLD_SUPABASE_KEY="<old service_role / secret key>"
 *   $env:NEW_SUPABASE_URL="https://<new-ref>.supabase.co"
 *   $env:NEW_SUPABASE_KEY="<new service_role / secret key>"
 *   node migration/migrate-data.mjs --dry-run     # read old DB + show counts, writes nothing
 *   node migration/migrate-data.mjs               # copy
 *
 * Properties
 *   - Idempotent: rows are upserted by primary key, so it is safe to re-run (e.g. a final delta
 *     right before cutover to pick up keys claimed since the first run).
 *   - Never prints key values, tokens or script contents — only table names and row counts.
 *   - Skips ephemeral tables that should NOT be carried over: sessions, session_commands,
 *     auth_probe_tokens, admin_sessions (everyone just re-authenticates / re-pings).
 *   - Blanks system_settings.discord_bot_token (keep the bot token in the DISCORD_BOT_TOKEN env var).
 *   - Scripts are copied one row per request because each row carries multi-MB payload columns.
 */
import { createClient } from "@supabase/supabase-js";

const need = (n) => {
  const v = process.env[n];
  if (!v) {
    console.error(`Missing env var ${n}`);
    process.exit(1);
  }
  return v;
};

const DRY = process.argv.includes("--dry-run");
const SKIP_LOGS = process.argv.includes("--skip-logs");

const oldDb = createClient(need("OLD_SUPABASE_URL"), need("OLD_SUPABASE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const newDb = DRY
  ? null
  : createClient(need("NEW_SUPABASE_URL"), need("NEW_SUPABASE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

// Order matters: parents before children (FKs).
// [table, primary-key column(s) for upsert, page size, optional row transform, isLog]
const TABLES = [
  ["loader_configs", "id", 50],
  ["scripts", "id", 1],
  ["keys", "id", 200],
  ["checkpoints", "id", 200],
  [
    "system_settings",
    "id",
    10,
    (r) => ({ ...r, discord_bot_token: "" }), // never carry the bot token into the DB
  ],
  ["creator_profile", "id", 10],
  ["banned_ips", "ip_address", 200],
  ["banned_hwids", "hwid", 200],
  ["bypass_attempts", "id", 200],
  ["chatroom_blacklist", "id", 200],
  ["chatroom_messages", "id", 200],
  ["dev_messages", "id", 200],
  ["staff_reviews", "id", 200],
  ["global_announcements", "id", 200],
  ["mobile_devices", "id", 200],
  ["admin_notifications", "id", 200],
  ["execution_logs", "id", 200, null, true],
  ["checkpoint_logs", "id", 200, null, true],
  ["client_errors", "id", 200, null, true],
];

async function fetchAll(table, pageSize) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await oldDb
      .from(table)
      .select("*")
      .order("created_at", { ascending: true, nullsFirst: true })
      .range(from, from + pageSize - 1);
    if (error) {
      // Some tables (system_settings, creator_profile, banned_*) have no created_at: retry unordered.
      const retry = await oldDb.from(table).select("*").range(from, from + pageSize - 1);
      if (retry.error) throw new Error(`read ${table}: ${retry.error.message}`);
      if (!retry.data.length) break;
      rows.push(...retry.data);
      if (retry.data.length < pageSize) break;
      continue;
    }
    if (!data.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function count(db, table) {
  const { count: c, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return c ?? 0;
}

let failed = false;
const summary = [];

for (const [table, pk, pageSize, transform, isLog] of TABLES) {
  if (isLog && SKIP_LOGS) {
    summary.push([table, "skipped (--skip-logs)", ""]);
    continue;
  }
  try {
    let rows = await fetchAll(table, pageSize);
    if (transform) rows = rows.map(transform);

    if (DRY) {
      summary.push([table, rows.length, "(dry run)"]);
      continue;
    }

    // Write in chunks; scripts go one at a time (multi-MB rows).
    const chunk = table === "scripts" ? 1 : 200;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      const { error } = await newDb.from(table).upsert(slice, { onConflict: pk });
      if (error) throw new Error(`write ${table}: ${error.message}`);
    }
    const n = await count(newDb, table);
    const o = rows.length;
    summary.push([table, o, n === o ? "OK" : `MISMATCH (new has ${n})`]);
    if (n !== o) failed = true;
  } catch (e) {
    failed = true;
    summary.push([table, "ERROR", e.message]);
  }
}

// Sanity report: script-scoped keys/checkpoints pointing at scripts that no longer exist.
try {
  const scripts = await fetchAll("scripts", 1);
  const ids = new Set(scripts.map((s) => s.id));
  const keys = await fetchAll("keys", 200);
  const orphanKeys = keys.filter((k) => k.script_id && k.script_id !== "all" && !ids.has(k.script_id)).length;
  if (orphanKeys) summary.push(["(report) keys bound to a deleted script", orphanKeys, "left as-is; review/delete in dashboard"]);
} catch {
  /* report only */
}

console.log("\n" + "table".padEnd(44) + "rows".padEnd(14) + "status");
console.log("-".repeat(78));
for (const [t, r, s] of summary) console.log(String(t).padEnd(44) + String(r).padEnd(14) + s);
console.log(
  DRY
    ? "\nDry run complete — nothing was written."
    : failed
    ? "\nFinished WITH PROBLEMS — fix the rows above and re-run (it is safe to re-run)."
    : "\nAll tables copied and row counts verified."
);
process.exit(failed ? 1 : 0);

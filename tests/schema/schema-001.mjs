// Real-Postgres (PGlite) checks for the Supabase migrations. Run: npm run test:schema
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const schemaPath = process.argv[2] || new URL("../../migration/001_schema.sql", import.meta.url);
let sql = fs.readFileSync(schemaPath, "utf8");
// PGlite doesn't ship these two extensions; everything else runs exactly as written.
sql = sql
  .replace(/create extension if not exists pgcrypto;/i, "")
  .replace(/create extension if not exists pg_stat_statements with schema extensions;/i, "");

const db = new PGlite();
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
async function expectError(name, q, re) {
  try { await db.exec(q); check(name, false, "no error raised"); }
  catch (e) { check(name, re ? re.test(e.message) : true, e.message.split("\n")[0]); }
}

// Supabase's built-in roles
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists extensions;
`);

try { await db.exec(sql); check("schema applies cleanly", true); }
catch (e) { check("schema applies cleanly", false, e.message); console.log(results.join("\n")); process.exit(1); }

// ---- seed (as service_role, like the app) ----
await db.exec(`set role service_role;`);
const lc = (await db.query(`insert into public.loader_configs (name) values ('Default') returning id`)).rows[0].id;
const sc = (await db.query(`insert into public.scripts (name, slug, loader_config_id) values ('Rivals','rivals',$1) returning id`, [lc])).rows[0].id;
await db.query(`insert into public.keys (key_string, script_id, duration_hours, created_at) values
  ('KEY-AAAA-0001', 'all', 24, now() - interval '3 hours'),
  ('KEY-SPEC-0002', $1, 24, now() - interval '1 hour'),
  ('KEY-LIFE-0003', 'all', null, now() - interval '5 hours'),
  ('STAFF-REV-0004', 'all', 24, now() - interval '6 hours')`, [sc]);
await db.exec(`update public.keys set is_staff_review = true where key_string = 'STAFF-REV-0004'`);

// claim_key: prefers script-specific, then universal; never lifetime or staff
const c1 = (await db.query(`select key_string, script_id, status, claimed_ip from public.claim_key($1,'1.2.3.4',null,null)`, [sc])).rows[0];
check("claim_key prefers script-specific key", c1?.key_string === "KEY-SPEC-0002" && c1.status === "claimed" && c1.claimed_ip === "1.2.3.4", JSON.stringify(c1));
const c2 = (await db.query(`select key_string, script_id from public.claim_key($1,'5.6.7.8',null,null)`, [sc])).rows[0];
check("claim_key falls back to universal and binds it to the script", c2?.key_string === "KEY-AAAA-0001" && c2.script_id === sc, JSON.stringify(c2));
const c3 = (await db.query(`select * from public.claim_key($1,'9.9.9.9',null,null)`, [sc])).rows;
check("claim_key never hands out lifetime or staff keys (pool empty)", c3.length === 0, `${c3.length} rows`);

// rate limiter: limit 2 -> true, true, false
const rl = [];
for (let i = 0; i < 3; i++) rl.push((await db.query(`select public.rate_limit_hit('t','1.1.1.1',2,60) as ok`)).rows[0].ok);
check("rate_limit_hit allows N then blocks", JSON.stringify(rl) === "[true,true,false]", JSON.stringify(rl));

// nonce: first use true, replay false
const n1 = (await db.query(`select public.consume_nonce('abc',300) as ok`)).rows[0].ok;
const n2 = (await db.query(`select public.consume_nonce('abc',300) as ok`)).rows[0].ok;
check("consume_nonce rejects replay", n1 === true && n2 === false, `${n1},${n2}`);

// probe session: single use
await db.query(`select public.create_probe_session('ps_1','rivals','salt',12345,'1.2.3.4',60)`);
const p1 = (await db.query(`select * from public.consume_probe_session('ps_1')`)).rows;
const p2 = (await db.query(`select * from public.consume_probe_session('ps_1')`)).rows;
check("probe session is returned once then gone", p1.length === 1 && p1[0].expected === 12345 && p2.length === 0, JSON.stringify(p1));
await db.query(`select public.create_probe_session('ps_2','rivals','salt',1,'1.2.3.4',-5)`);
const p3 = (await db.query(`select * from public.consume_probe_session('ps_2')`)).rows;
check("expired probe session is rejected", p3.length === 0);

// prune + updated_at trigger
try { await db.query(`select public.prune_security_tables()`); check("prune_security_tables runs", true); } catch (e) { check("prune_security_tables runs", false, e.message); }
const before = (await db.query(`select updated_at from public.scripts where id=$1`, [sc])).rows[0].updated_at;
await new Promise((r) => setTimeout(r, 20));
await db.query(`update public.scripts set name='Rivals 2' where id=$1`, [sc]);
const after = (await db.query(`select updated_at from public.scripts where id=$1`, [sc])).rows[0].updated_at;
check("updated_at trigger fires for service_role", after > before);
await db.exec(`insert into public.audit_log (action) values ('test')`);
check("service_role can write audit_log", true);

// ---- constraints ----
await expectError("bad slug rejected", `insert into public.scripts (name, slug) values ('x','Bad Slug!')`, /check/i);
await expectError("bad key format rejected", `insert into public.keys (key_string) values ('has space here')`, /check/i);
await expectError("bad key script_id rejected", `insert into public.keys (key_string, script_id) values ('KEY-ZZZZ-9999','not-a-uuid')`, /check/i);
await expectError("bad key status rejected", `insert into public.keys (key_string, status) values ('KEY-ZZZZ-9998','hacked')`, /check/i);
await expectError("non-Discord webhook rejected", `insert into public.loader_configs (name, webhook_url) values ('x','https://evil.example.com/hook')`, /check/i);
try { await db.exec(`insert into public.loader_configs (name, webhook_url) values ('x','https://ptb.discord.com/api/webhooks/123/abc_DEF-1?wait=true')`); check("ptb Discord webhook with ?wait accepted", true); } catch (e) { check("ptb Discord webhook with ?wait accepted", false, e.message); }
await expectError("second system_settings row rejected", `insert into public.system_settings (id) values (2)`, /check/i);

// ---- lockdown: anon / authenticated get NOTHING ----
for (const role of ["anon", "authenticated"]) {
  await db.exec(`reset role; set role ${role};`);
  await expectError(`${role}: cannot read keys`, `select * from public.keys`, /permission denied/i);
  await expectError(`${role}: cannot read scripts`, `select * from public.scripts`, /permission denied/i);
  await expectError(`${role}: cannot insert keys`, `insert into public.keys (key_string) values ('KEY-HACK-0001')`, /permission denied/i);
  await expectError(`${role}: cannot call claim_key`, `select * from public.claim_key('all','6.6.6.6',null,null)`, /permission denied/i);
  await expectError(`${role}: cannot call rate_limit_hit`, `select public.rate_limit_hit('x','y',1,1)`, /permission denied/i);
}
await db.exec(`reset role;`);

// every public table has RLS enabled with zero policies
const rls = (await db.query(`
  select c.relname, c.relrowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'`)).rows;
const noRls = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
const withPolicies = rls.filter((r) => r.policies > 0).map((r) => r.relname);
check(`RLS enabled on all ${rls.length} tables`, noRls.length === 0, noRls.join(","));
check("zero RLS policies anywhere", withPolicies.length === 0, withPolicies.join(","));

// table owner (dashboard / pg_cron) still sees data because RLS is not forced
const ownerCount = (await db.query(`select count(*)::int as n from public.keys`)).rows[0].n;
check("owner (dashboard/pg_cron) can still see rows", ownerCount === 4, `${ownerCount} rows`);

// a table created LATER (e.g. in the dashboard) must not be readable by anon by default
await db.exec(`create table public.future_table (id int); `);
await db.exec(`set role anon;`);
await expectError("future tables: anon gets no default access", `select * from public.future_table`, /permission denied/i);
await db.exec(`reset role;`);

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);

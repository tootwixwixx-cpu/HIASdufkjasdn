// Real-Postgres (PGlite) checks for the Supabase migrations. Run: npm run test:schema
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const s1 = process.argv[2] || new URL("../../migration/001_schema.sql", import.meta.url);
const s2 = process.argv[3] || new URL("../../migration/002_features.sql", import.meta.url);
const strip = (s) => s.replace(/create extension if not exists pgcrypto;/i, "").replace(/create extension if not exists pg_stat_statements with schema extensions;/i, "");
const db = new PGlite();
const out = [];
const check = (n, ok, x = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`);
async function expectError(n, q, re) {
  try { await db.exec(q); check(n, false, "no error"); } catch (e) { check(n, re ? re.test(e.message) : true, e.message.split("\n")[0]); }
}

await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema if not exists extensions;
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean);`);
await db.exec(strip(fs.readFileSync(s1, "utf8")));
try { await db.exec(fs.readFileSync(s2, "utf8")); check("002 applies on top of 001", true); }
catch (e) { check("002 applies on top of 001", false, e.message); console.log(out.join("\n")); process.exit(1); }
try { await db.exec(fs.readFileSync(s2, "utf8")); check("002 is idempotent (second run)", true); }
catch (e) { check("002 is idempotent (second run)", false, e.message); }
const bucket = (await db.query(`select public from storage.buckets where id='script-builds'`)).rows[0];
check("private script-builds bucket created", bucket && bucket.public === false);

await db.exec(`set role service_role;`);
const sc = (await db.query(`insert into public.scripts (name, slug) values ('Rivals','rivals') returning id`)).rows[0].id;
const k = (await db.query(`insert into public.keys (key_string, script_id, duration_hours, status) values ('KEY-HWID-0001',$1,24,'active') returning id`, [sc])).rows[0].id;
const H1 = "0123456789abcdef_ABC-123", H2 = "fedcba9876543210_99887766";

// HWID trust-on-first-use
let r = (await db.query(`select bound_hwid from public.bind_key_hwid($1,$2)`, [k, H1])).rows;
check("first bind succeeds", r.length === 1 && r[0].bound_hwid === H1);
r = (await db.query(`select * from public.bind_key_hwid($1,$2)`, [k, H2])).rows;
check("second bind with other HWID is refused (no overwrite)", r.length === 0);
const still = (await db.query(`select bound_hwid from public.keys where id=$1`, [k])).rows[0].bound_hwid;
check("binding unchanged after refused bind", still === H1);
await expectError("malformed HWID rejected by constraint", `update public.keys set bound_hwid='not a hwid' where id='${k}'`, /check/i);

// reset with cooldown
let j = (await db.query(`select public.reset_key_hwid($1, 12) as j`, [k])).rows[0].j;
check("self-service reset works the first time", j.ok === true);
j = (await db.query(`select public.reset_key_hwid($1, 12) as j`, [k])).rows[0].j;
check("second reset within 12h is blocked with retry time", j.ok === false && j.reason === "cooldown" && !!j.retry_at, JSON.stringify(j));
j = (await db.query(`select public.reset_key_hwid($1, 0) as j`, [k])).rows[0].j;
check("admin reset (cooldown 0) always works", j.ok === true);

// IP history
await db.query(`select public.record_key_ip($1,'1.1.1.1','US')`, [k]);
await db.query(`select public.record_key_ip($1,'1.1.1.1','US')`, [k]);
j = (await db.query(`select public.record_key_ip($1,'2.2.2.2','US') as j`, [k])).rows[0].j;
check("record_key_ip counts distinct IPs", j.ips_24h === 2 && j.countries_24h === 1, JSON.stringify(j));
j = (await db.query(`select public.record_key_ip($1,'3.3.3.3','DE') as j`, [k])).rows[0].j;
check("3rd IP / 2nd country detected (sharing signal)", j.ips_24h === 3 && j.countries_24h === 2, JSON.stringify(j));
const uses = (await db.query(`select uses from public.key_ip_history where key_id=$1 and ip='1.1.1.1'`, [k])).rows[0].uses;
check("repeat IP increments uses, no duplicate row", uses === 2);
const kl = (await db.query(`select last_ip, last_seen_at from public.keys where id=$1`, [k])).rows[0];
check("key last_ip/last_seen updated", kl.last_ip === "3.3.3.3" && !!kl.last_seen_at);

// script versions
for (let i = 0; i < 4; i++) await db.query(`select * from public.create_script_version($1,$2,'init.lua','balanced','{}'::jsonb,100,null)`, [sc, `${sc}/v${i + 1}.json`]);
const vs = (await db.query(`select version from public.script_versions where script_id=$1 order by version`, [sc])).rows.map((x) => x.version);
check("versions numbered 1..4", JSON.stringify(vs) === "[1,2,3,4]", JSON.stringify(vs));
const pruned = (await db.query(`select * from public.prune_script_versions($1, 2)`, [sc])).rows.map((x) => Object.values(x)[0]);
const left = (await db.query(`select version from public.script_versions where script_id=$1 order by version`, [sc])).rows.map((x) => x.version);
check("prune keeps newest N and returns deleted paths", JSON.stringify(left) === "[3,4]" && pruned.length === 2, JSON.stringify({ left, pruned }));
const v5 = (await db.query(`select version from public.create_script_version($1,'p','init.lua',null,null,1,null)`, [sc])).rows[0].version;
check("numbering continues after prune", v5 === 5);

// status
await db.exec(`insert into public.status_components (name, kind) values ('Website','website')`);
await expectError("only one website component", `insert into public.status_components (name, kind) values ('Site 2','website')`, /duplicate|unique/i);
await expectError("bad status value rejected", `insert into public.status_components (name, status) values ('x','on fire')`, /check/i);
await db.exec(`insert into public.status_incidents (title) values ('Loader slow')`);

// analytics
await db.exec(`insert into public.execution_logs (script_id, script_name, roblox_user_id, ip_address, executor, os, country, status, created_at) values
  ('${sc}','Rivals','1','9.9.9.1','Wave','Windows','US','success', now() - interval '3 days'),
  ('${sc}','Rivals','1','9.9.9.1','Wave','Windows','US','success', now() - interval '2 days'),
  ('${sc}','Rivals','2','9.9.9.2','Delta','Android','GB','success', now() - interval '2 days'),
  ('${sc}','Rivals','3','9.9.9.3','Wave','Windows','US','failed',  now() - interval '1 days')`);
const da = (await db.query(`select * from public.analytics_daily_active(now() - interval '30 days', null)`)).rows;
check("daily active players aggregates by day", da.length === 2 && da.reduce((a, x) => a + x.players, 0) === 3, JSON.stringify(da));
const ret = (await db.query(`select public.analytics_retention(now() - interval '30 days', $1) as j`, [sc])).rows[0].j;
check("retention computes D1 cohort", ret.new_players === 2 && ret.returned_d1 === 1, JSON.stringify(ret));
const br = (await db.query(`select * from public.analytics_breakdown(now() - interval '30 days', null, 'executor')`)).rows;
check("executor breakdown counts distinct players over the period", br.find((x) => x.label === "Wave")?.players === 1 && br.find((x) => x.label === "Delta")?.players === 1, JSON.stringify(br));
const bad = (await db.query(`select * from public.analytics_breakdown(now() - interval '30 days', null, 'ip_address')`)).rows;
check("breakdown refuses arbitrary columns", bad.length === 0);
await db.exec(`insert into public.checkpoint_logs (ip_address, stage, step_index, session_id) values
  ('1','started',0,'s1'),('1','step_completed',0,'s1'),('1','completed',1,'s1'),('2','started',0,'s2')`);
const fn = (await db.query(`select public.analytics_checkpoint_funnel(now() - interval '1 day', null) as j`)).rows[0].j;
check("checkpoint funnel", fn.started === 2 && fn.completed === 1 && fn.steps[0].sessions === 1, JSON.stringify(fn));
const ku = (await db.query(`select public.analytics_key_usage(null) as j`)).rows[0].j;
check("key usage summary", ku.total === 1 && ku.active === 1, JSON.stringify(ku));

// session commands
const sess1 = (await db.query(`insert into public.sessions (ip_address, status, script_id) values ('1.1.1.1','active',$1) returning id`, [sc])).rows[0].id;
const sess2 = (await db.query(`insert into public.sessions (ip_address, status, script_id, last_heartbeat) values ('2.2.2.2','active','other', now() - interval '5 minutes') returning id`)).rows[0].id;
await db.query(`select public.push_session_command($1, '{"id":"a","type":"message","message":"hi"}'::jsonb, false)`, [sess1]);
await db.query(`select public.push_session_command($1, '{"id":"b","type":"kick"}'::jsonb, true)`, [sess1]);
const st = (await db.query(`select status, jsonb_array_length(pending_commands) n from public.sessions where id=$1`, [sess1])).rows[0];
check("commands append (not overwrite) and kick sets status", st.n === 2 && st.status === "kicked", JSON.stringify(st));
const taken = (await db.query(`select public.take_session_commands($1) as c`, [sess1])).rows[0].c;
const again = (await db.query(`select public.take_session_commands($1) as c`, [sess1])).rows[0].c;
check("take_session_commands returns all once, then empty", taken.length === 2 && again.length === 0);
await db.exec(`update public.sessions set status='active' where id='${sess1}'`);
const nb = (await db.query(`select public.push_command_to_active('{"id":"c","type":"announcement"}'::jsonb, $1, 15, false) as n`, [sc])).rows[0].n;
check("broadcast reaches only fresh sessions of that script", nb === 1, String(nb));
const missing = (await db.query(`select public.push_session_command('00000000-0000-0000-0000-000000000000', '{}'::jsonb, false) as r`)).rows[0].r;
check("push to unknown session reports nothing queued", missing === null);
void sess2;

// lockdown on new objects
await db.exec(`reset role; set role anon;`);
for (const t of ["key_ip_history", "admin_totp", "status_components", "status_incidents", "script_versions"]) {
  await expectError(`anon cannot read ${t}`, `select * from public.${t}`, /permission denied/i);
}
await expectError("anon cannot call bind_key_hwid", `select * from public.bind_key_hwid('${k}','${H1}')`, /permission denied/i);
await expectError("anon cannot call analytics", `select * from public.analytics_daily_active(now(), null)`, /permission denied/i);
await db.exec(`reset role; set role authenticated;`);
await expectError("authenticated cannot read admin_totp", `select * from public.admin_totp`, /permission denied/i);
await db.exec(`reset role;`);
const rls = (await db.query(`select count(*) filter (where not c.relrowsecurity)::int as off, count(*)::int as n,
   (select count(*) from pg_policy p join pg_class c2 on c2.oid=p.polrelid join pg_namespace n2 on n2.oid=c2.relnamespace where n2.nspname='public')::int as pol
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`)).rows[0];
check(`RLS on all ${rls.n} tables, zero policies`, rls.off === 0 && rls.pol === 0, JSON.stringify(rls));

console.log(out.join("\n"));
const failed = out.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} checks passed`);
process.exit(failed ? 1 : 0);

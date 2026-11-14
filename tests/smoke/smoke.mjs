// Attack-style smoke checks against a running build (started by tests/smoke/run-smoke.mjs).
const B = process.env.SMOKE_URL || "http://localhost:3999";
const out = [];
const check = (n, ok, extra = "") => out.push(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  -> " + extra : ""}`);

// wait for server
for (let i = 0; i < 60; i++) {
  try { await fetch(B + "/login"); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}
const UA = { "User-Agent": "Roblox/WinInet" };

// 1. Reflected XSS via loader slug is rejected before any HTML is rendered
let r = await fetch(B + "/api/loader/%3Cscript%3Ealert(1)%3C%2Fscript%3E", { headers: { ...UA, Accept: "text/html" } });
let t = await r.text();
check("XSS slug rejected (400, not reflected)", r.status === 400 && !t.includes("<script>"), `${r.status}`);
r = await fetch(B + "/loader/%3Cimg%20src%3Dx%3E", { headers: UA });
check("XSS slug rejected on /loader alias too", r.status === 400, `${r.status}`);

// 2. staff_review prefix no longer unlocks module source
r = await fetch(B + "/api/loader/rivals/main.lua?session=staff_review", { headers: UA });
t = await r.text();
check("?session=staff_review does NOT return module source", r.status !== 200, `${r.status} ${t.slice(0, 60).replace(/\n/g, " ")}`);
r = await fetch(B + "/api/loader/rivals/main.lua", { headers: { ...UA, "x-session-id": "staff_review_00000000-0000-0000-0000-000000000000" } });
check("forged staff_review_<uuid> does NOT return module source", r.status !== 200, `${r.status}`);

// 3. CORS: foreign origin gets no CORS grant; same origin does
r = await fetch(B + "/api/settings", { headers: { Origin: "https://evil.example.com" } });
check("foreign Origin gets no Access-Control-Allow-Origin", !r.headers.get("access-control-allow-origin"), String(r.headers.get("access-control-allow-origin")));
r = await fetch(B + "/api/keys", { method: "OPTIONS", headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "DELETE" } });
check("preflight from foreign origin not granted", !r.headers.get("access-control-allow-origin"), `${r.status}`);
r = await fetch(B + "/api/settings", { headers: { Origin: B } });
check("same-origin request still gets CORS echo", r.headers.get("access-control-allow-origin") === B);

// 4. Security headers
r = await fetch(B + "/login");
check("security headers present", r.headers.get("x-content-type-options") === "nosniff" && !!r.headers.get("strict-transport-security") && r.headers.get("x-frame-options") === "SAMEORIGIN" && !r.headers.get("x-powered-by"));

// 5. Admin API blocked without / with forged token
r = await fetch(B + "/api/keys");
check("admin API 401 without token", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/keys", { headers: { Authorization: "Bearer 1700000000000.deadbeef" } });
check("old 2-part token format rejected", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/keys", { headers: { Authorization: "Bearer " + Date.now() + ".0123456789abcdef0123456789abcdef.forgedsig" } });
check("forged-signature token rejected", r.status === 401, `${r.status}`);

// 6. Login: correct creds -> 3-part token that works; brute force -> 429
r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "smoke", password: "smoke-pass" }) });
let j = await r.json();
const tok = j.token || "";
check("valid login issues 3-part session token", r.status === 200 && tok.split(".").length === 3, `${r.status}`);
check("session cookie is HttpOnly", (r.headers.get("set-cookie") || "").toLowerCase().includes("httponly"));
r = await fetch(B + "/api/keys", { headers: { Authorization: "Bearer " + tok } });
check("issued token authorizes admin API", r.status === 200, `${r.status}`);
let codes = [];
for (let i = 0; i < 9; i++) {
  r = await fetch(B + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "smoke", password: "wrong" + i }) });
  codes.push(r.status);
}
check("login brute force throttled (429)", codes.includes(429), codes.join(","));
j = await (await fetch(B + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "x", password: "y" }) })).json();
check("login errors don't leak internals", !/at |Error:|supabase|stack/i.test(JSON.stringify(j)), JSON.stringify(j));

// 7. DMs: reading/posting as an arbitrary Roblox user is refused
r = await fetch(B + "/api/chatroom/dms?userId=1");
check("DM thread of arbitrary userId is not readable", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/chatroom/dms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "1", message: "hi", senderType: "user" }) });
check("posting into arbitrary DM thread refused", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/chatroom/dms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "1", message: "hi", senderType: "dev" }) });
check("spoofing a dev reply refused", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/chatroom/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "1", username: "Roblox", message: "spoof" }) });
check("chat impersonation refused", r.status === 401, `${r.status}`);
r = await fetch(B + "/api/chatroom/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "1", message: "x", isDev: true }) });
check("fake isDev badge refused", r.status === 401, `${r.status}`);

// 8. Claim without completing checkpoints is refused
r = await fetch(B + "/api/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ script_slug: "rivals", session_id: "x", claim_token: "forged.token" }) });
check("forged claim token refused", r.status === 403 || r.status === 404, `${r.status}`);

// 9. Checkpoint step skipping: forged gateway token / Work.ink with fake session refused
r = await fetch(B + "/api/checkpoints/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify_workink", token: "fake", sessionId: "never-started", stepIndex: 0, totalSteps: 1 }) });
check("Work.ink step without a real checkpoint session refused", r.status === 400, `${r.status}`);

// 10. Avatar proxy: no http, no foreign host
r = await fetch(B + "/api/avatar-proxy?url=" + encodeURIComponent("http://tr.rbxcdn.com/x.png"));
check("avatar proxy refuses plain http", r.status === 400, `${r.status}`);
r = await fetch(B + "/api/avatar-proxy?url=" + encodeURIComponent("https://169.254.169.254/latest/meta-data"));
check("avatar proxy refuses non-allowlisted host (SSRF)", r.status === 400, `${r.status}`);

// 11. Telemetry relay never echoes a webhook URL and is inert when unconfigured
r = await fetch(B + "/api/telemetry/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ embeds: [{ title: "@everyone" }] }) });
j = await r.json();
check("telemetry relay inert without env var", r.status === 200 && j.delivered === false, JSON.stringify(j));

// 12. Public scripts listing never exposes payload/secret fields
r = await fetch(B + "/api/scripts");
t = await r.text();
check("public /api/scripts exposes no modules/payload/github_token", !/modules|obfuscated_payload|github_token|lua_code/.test(t), `${r.status}`);

console.log(out.join("\n"));
const failed = out.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} smoke checks passed`);
process.exit(failed ? 1 : 0);

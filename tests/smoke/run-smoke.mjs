// Starts the production build with NO database (local mode), runs tests/smoke/smoke.mjs, stops it.
// Usage: npm run build && npm run test:smoke
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = process.env.SMOKE_PORT || "3999";
const env = {
  ...process.env,
  NODE_ENV: "test", // Next.js does not load .env.local in test mode → no real database/secrets
  NEXT_TELEMETRY_DISABLED: "1",
  ADMIN_USERNAME: "smoke",
  ADMIN_PASSWORD: "smoke-pass",
  AUTH_SECRET: "smoke-auth-secret-0123456789abcdef",
  ANTI_BYPASS_SECRET: "smoke-ab-secret-0123456789abcdef",
};
for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_REST_URL", "KV_REST_API_URL", "SENTRY_DSN", "ADMIN_ALERT_WEBHOOK_URL", "ADMIN_TOTP_SECRET"]) delete env[k];

const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", PORT], { cwd: root, env, stdio: "ignore" });
const stop = () => { try { server.kill(); } catch {} };
process.on("exit", stop);

const checks = spawn(process.execPath, [path.join(root, "tests/smoke/smoke.mjs")], {
  cwd: root,
  env: { ...process.env, SMOKE_URL: `http://localhost:${PORT}` },
  stdio: "inherit",
});
checks.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});

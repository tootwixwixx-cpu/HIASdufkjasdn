// lib/auth-token.ts
// Pure, dependency-free admin session token helpers (safe to import from proxy.ts).
// Token format: <issuedAtMs>.<sessionId>.<hmac>
// The HMAC proves the token was issued by this server; whether the session is still *live*
// (not revoked / not expired in the database) is checked separately in lib/auth.ts.
import { hmacSha256, constantTimeEquals } from "@/lib/crypto-util";

export const AUTH_COOKIE_NAME = "aero_admin_session";

const AUTH_SECRET = process.env.AUTH_SECRET || "";

const configuredHours = Number(process.env.ADMIN_SESSION_HOURS);
/** Absolute admin session lifetime. Default 24h (was 7 days). Override with ADMIN_SESSION_HOURS. */
export const SESSION_HOURS = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 24;
export const SESSION_MAX_AGE_MS = SESSION_HOURS * 60 * 60 * 1000;

/** Database lookup key for a session id (never store the raw id). */
export function sessionHash(sid: string): string {
  return hmacSha256(AUTH_SECRET, "sid:" + sid);
}

export function signSessionToken(sid: string): string {
  if (!AUTH_SECRET) throw new Error("AUTH_SECRET is not configured");
  const ts = Date.now().toString();
  const sig = hmacSha256(AUTH_SECRET, `aero_admin:${ts}:${sid}`);
  return `${ts}.${sid}.${sig}`;
}

/** Verifies signature + age. Returns the session id, or null if the token is invalid/expired. */
export function parseSessionToken(token: string | undefined | null): { sid: string; issuedAt: number } | null {
  if (!token || typeof token !== "string" || !AUTH_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [tsStr, sid, sig] = parts;
  if (!/^\d{10,16}$/.test(tsStr) || !/^[a-f0-9]{32}$/.test(sid)) return null;
  const issuedAt = parseInt(tsStr, 10);
  const now = Date.now();
  if (now - issuedAt > SESSION_MAX_AGE_MS || now < issuedAt - 60000) return null;
  const expected = hmacSha256(AUTH_SECRET, `aero_admin:${tsStr}:${sid}`);
  if (!constantTimeEquals(sig, expected)) return null;
  return { sid, issuedAt };
}

export function isValidSessionToken(token: string | undefined | null): boolean {
  return parseSessionToken(token) !== null;
}

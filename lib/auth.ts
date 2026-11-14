// lib/auth.ts
import { cookies, headers } from "next/headers";
import { constantTimeEquals } from "@/lib/crypto-util";
import { dbService } from "@/lib/store";
import {
  AUTH_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_HOURS,
  isValidSessionToken,
  parseSessionToken,
  sessionHash,
  signSessionToken,
} from "@/lib/auth-token";

export { AUTH_COOKIE_NAME, SESSION_HOURS, isValidSessionToken };

// SECURITY: these must come from the environment. There is deliberately no hardcoded
// fallback here — if any are missing, auth fails closed.
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const AUTH_SECRET = process.env.AUTH_SECRET || "";

function secretsConfigured(): boolean {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !AUTH_SECRET) {
    console.error(
      "[auth] ADMIN_USERNAME, ADMIN_PASSWORD, and AUTH_SECRET must all be set in the environment. " +
        "Refusing all admin authentication until they are configured."
    );
    return false;
  }
  return true;
}

/** Validates admin username and password against environment-configured credentials (constant time). */
export function verifyCredentials(user: string, pass: string): boolean {
  if (!secretsConfigured()) return false;
  if (!user || !pass) return false;
  const userOk = constantTimeEquals(user, ADMIN_USERNAME);
  const passOk = constantTimeEquals(pass, ADMIN_PASSWORD);
  return userOk && passOk;
}

/**
 * Creates a server-side, revocable admin session and returns its signed token.
 * The session row lives in `admin_sessions`; deleting/deactivating it logs that device out immediately.
 */
export async function createAdminSession(meta: { ip?: string; userAgent?: string }): Promise<{ token: string }> {
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await dbService.createAdminSession({
    token_hash: sessionHash(sid),
    admin_username: ADMIN_USERNAME,
    ip_address: meta.ip || null,
    device_info: (meta.userAgent || "").slice(0, 200) || null,
    expires_at: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
  });
  return { token: signSessionToken(sid) };
}

/** Revokes the session that owns `token` (no-op if the token is invalid). */
export async function revokeSessionToken(token: string | undefined | null): Promise<void> {
  const parsed = parseSessionToken(token);
  if (parsed) await dbService.revokeAdminSession(sessionHash(parsed.sid));
}

async function tokenIsLive(token: string | undefined | null): Promise<boolean> {
  const parsed = parseSessionToken(token);
  if (!parsed) return false;
  return dbService.isAdminSessionLive(sessionHash(parsed.sid));
}

/**
 * Checks whether the current request is an authenticated, non-revoked admin via Authorization header
 * or cookie. All call sites must `await` it.
 */
export async function isAuthenticated(req?: Request): Promise<boolean> {
  try {
    if (req) {
      const authHeader = req.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        if (await tokenIsLive(authHeader.substring(7).trim())) return true;
      }
    }

    try {
      const headerStore = await headers();
      const authHeader = headerStore.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        if (await tokenIsLive(authHeader.substring(7).trim())) return true;
      }
    } catch {
      // headers() may throw if called outside request context
    }

    const cookieStore = await cookies();
    return await tokenIsLive(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  } catch {
    return false;
  }
}

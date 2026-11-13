// lib/auth.ts
import { cookies, headers } from "next/headers";
import { hmacSha256, constantTimeEquals } from "@/lib/crypto-util";

// SECURITY: these must come from the environment. There is deliberately no hardcoded
// fallback here anymore — a previous version of this file fell back to a known,
// hardcoded admin username/password/HMAC secret (and a permanent legacy bypass token)
// whenever the env vars were unset, which meant anyone with this source code could log
// in as admin or forge a valid session. If any of these are missing, auth fails closed.
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export const AUTH_COOKIE_NAME = "aero_admin_session";

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

/**
 * Validates admin username and password against environment-configured credentials.
 * Fails closed (returns false) if the required env vars aren't set.
 */
export function verifyCredentials(user: string, pass: string): boolean {
  if (!secretsConfigured()) return false;
  if (!user || !pass) return false;
  return constantTimeEquals(user, ADMIN_USERNAME) && constantTimeEquals(pass, ADMIN_PASSWORD);
}

/**
 * Generates a cryptographically signed admin session token with timestamp.
 * Token format: <timestamp>.<signature>
 */
export function createSessionToken(): string {
  const timestamp = Date.now().toString();
  const signature = hmacSha256(AUTH_SECRET, `aero_admin:${timestamp}`);
  return `${timestamp}.${signature}`;
}

/**
 * Verifies if a given token is a valid, unexpired session token.
 * Max token age: 7 days. Fails closed if AUTH_SECRET isn't configured.
 */
export function isValidSessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== "string") return false;
  if (!AUTH_SECRET) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampStr, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - timestamp > SEVEN_DAYS_MS || Date.now() < timestamp - 60000) {
    return false;
  }

  const expectedSignature = hmacSha256(AUTH_SECRET, `aero_admin:${timestampStr}`);

  return constantTimeEquals(signature, expectedSignature);
}

/**
 * Checks whether the current request is authenticated as admin via Authorization header or cookies.
 * Next.js 15+/16 made `headers()`/`cookies()` async, so this is now async too — all call sites
 * must `await` it.
 */
export async function isAuthenticated(req?: Request): Promise<boolean> {
  try {
    // 1. Direct request parameter check
    if (req) {
      const authHeader = req.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring(7).trim();
        if (isValidSessionToken(token)) return true;
      }
    }

    // 2. Next.js headers() check
    try {
      const headerStore = await headers();
      const authHeader = headerStore.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring(7).trim();
        if (isValidSessionToken(token)) return true;
      }
    } catch {
      // headers() may throw if called outside request context
    }

    // 3. Fallback to session cookie
    const cookieStore = await cookies();
    const session = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    return isValidSessionToken(session);
  } catch {
    return false;
  }
}

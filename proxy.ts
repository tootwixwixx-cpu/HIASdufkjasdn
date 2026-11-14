// proxy.ts (Next.js 16 renamed this from middleware.ts; function renamed middleware -> proxy)
// NOTE: per Next.js guidance (and CVE-2025-29927, the historical middleware-auth-bypass
// vulnerability), this proxy layer is NOT the sole authorization boundary. Every
// sensitive API route also calls isAuthenticated() itself (which additionally checks the session
// hasn't been revoked), so a future proxy/runtime bug can't become a full auth bypass on its own.
import { NextRequest, NextResponse } from "next/server";
// Pure token module only (no DB) — the proxy does the cheap signature check.
import { AUTH_COOKIE_NAME, isValidSessionToken } from "@/lib/auth-token";

// CORS: browsers only. Roblox executors and the same-origin website don't need CORS at all, so the
// old blanket `Access-Control-Allow-Origin: *` (on every route, admin ones included) is gone.
// Cross-origin browser callers (e.g. a web build of the mobile app) must be listed in the
// ALLOWED_ORIGINS env var (comma separated, e.g. "https://admin.example.com").
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean)
);

function applyCors(request: NextRequest, res: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && (origin === request.nextUrl.origin || ALLOWED_ORIGINS.has(origin))) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.headers.set("Access-Control-Max-Age", "600");
  }
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // CORS preflight
  if (request.method === "OPTIONS") {
    return applyCors(request, new NextResponse(null, { status: 204 }));
  }

  // Check authentication via cookie OR Authorization Bearer header
  const session = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  let isAuthed = isValidSessionToken(session);

  if (!isAuthed) {
    const authHeader = request.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.substring(7).trim();
      isAuthed = isValidSessionToken(bearerToken);
    }
  }

  // Protect /dashboard routes
  if (pathname.startsWith("/dashboard")) {
    if (!isAuthed) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Protect sensitive management APIs (except public execution/loader/claim/login endpoints)
  const isProtectedApi =
    pathname.startsWith("/api/keys") ||
    pathname.startsWith("/api/players") ||
    pathname.startsWith("/api/loader-configs") ||
    pathname.startsWith("/api/analytics") ||
    (pathname.startsWith("/api/scripts") && request.method !== "GET") ||
    (pathname.startsWith("/api/settings") && request.method !== "GET") ||
    (pathname === "/api/checkpoints" && request.method !== "GET") ||
    (pathname.startsWith("/api/checkpoints/bypass-attempts") && request.method === "GET") ||
    (pathname.startsWith("/api/creator-profile") && request.method !== "GET");

  if (isProtectedApi && !isAuthed) {
    return applyCors(
      request,
      NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 })
    );
  }

  const res = NextResponse.next();
  if (pathname.startsWith("/api/")) {
    applyCors(request, res);
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};

// app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthenticated, revokeSessionToken } from "@/lib/auth";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cookieToken = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const bearer = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.substring(7).trim()
    : undefined;

  // Optional { "all": true } = sign out every device (requires being signed in).
  let revokeAll = false;
  try {
    const body = await req.json();
    revokeAll = body?.all === true;
  } catch {
    // no body
  }

  if (revokeAll && (await isAuthenticated(req))) {
    await dbService.revokeAllAdminSessions();
    void dbService.audit("admin.logout_all", { ip: getClientIp(req) });
  } else {
    // Actually invalidate the session server-side (the old route only cleared the browser cookie,
    // leaving the token valid for 7 days if it had been copied/leaked).
    await revokeSessionToken(cookieToken);
    await revokeSessionToken(bearer);
  }

  const response = NextResponse.json({ success: true, redirect: "/login" });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}

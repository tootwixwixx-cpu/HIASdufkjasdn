import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, AUTH_COOKIE_NAME, SESSION_HOURS, createAdminSession } from "@/lib/auth";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";
import { isTotpConfigured, verifyTotp } from "@/lib/totp";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // Brute-force protection: 8 attempts per IP per 15 minutes (Postgres-backed, holds across instances).
    const ip = getClientIp(req);
    if (!(await dbService.rateLimit("admin-login", ip, 8, 15 * 60))) {
      return NextResponse.json(
        { error: "Too many login attempts. Try again in 15 minutes." },
        { status: 429, headers: { "Retry-After": "900" } }
      );
    }

    const body = await req.json();
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const totp = typeof body?.totp === "string" ? body.totp.replace(/\s+/g, "") : "";

    if (!username || !password || username.length > 128 || password.length > 256) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    if (!verifyCredentials(username.trim(), password.trim())) {
      void dbService.audit("admin.login_failed", { ip, details: { reason: "bad_credentials" } });
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // Optional second factor: enforced whenever ADMIN_TOTP_SECRET is set.
    if (isTotpConfigured()) {
      if (!totp) {
        return NextResponse.json({ error: "Authentication code required", totp_required: true }, { status: 401 });
      }
      const step = verifyTotp(totp);
      if (step === null) {
        void dbService.audit("admin.login_failed", { ip, details: { reason: "bad_totp" } });
        return NextResponse.json({ error: "Invalid authentication code", totp_required: true }, { status: 401 });
      }
      // A TOTP code is single-use within its validity window.
      if (!(await dbService.consumeNonce("totp:" + step, 120))) {
        return NextResponse.json(
          { error: "That code was already used. Wait for the next one.", totp_required: true },
          { status: 401 }
        );
      }
    }

    const { token: sessionToken } = await createAdminSession({
      ip,
      userAgent: req.headers.get("user-agent") || "",
    });
    void dbService.audit("admin.login", { ip });

    const response = NextResponse.json({
      success: true,
      token: sessionToken,
      redirect: "/dashboard/scripts",
    });
    const isHttps = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: sessionToken,
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_HOURS * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error("Login route error:", err);
    // Don't echo internal error text to an unauthenticated caller.
    return NextResponse.json({ error: "Authentication error" }, { status: 500 });
  }
}

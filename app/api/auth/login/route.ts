import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials, AUTH_COOKIE_NAME, SESSION_HOURS, createAdminSession } from "@/lib/auth";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";
import { verifyTotpWithSecret } from "@/lib/totp";
import { getActiveTotpSecret } from "@/lib/admin-2fa";
import { adminAlert } from "@/lib/alerts";

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
      // 3rd failure from the same IP within 15 minutes → alert
      if (!(await dbService.rateLimit("admin-login-fail", ip, 2, 15 * 60))) {
        void adminAlert(
          "admin_login_failures",
          "Repeated failed admin logins",
          { IP: ip, Device: (req.headers.get("user-agent") || "").slice(0, 120) },
          { dedupKey: ip, windowSec: 15 * 60 }
        );
      }
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    // The mobile app signs in without 2FA (owner's choice). Trade-off: anyone with the password can use
    // this path, so every mobile login alerts Discord, the session is labelled "mobile", and the whole
    // path can be switched off with MOBILE_LOGIN_ENABLED=false.
    const isMobile = body?.client === "mobile";
    if (isMobile && process.env.MOBILE_LOGIN_ENABLED === "false") {
      return NextResponse.json({ error: "Mobile app sign-in is disabled." }, { status: 403 });
    }

    // Second factor for web logins: enrolled from the dashboard (or ADMIN_TOTP_SECRET env override).
    let totpSecret: string | null = null;
    if (!isMobile) {
      try {
        totpSecret = await getActiveTotpSecret();
      } catch (e) {
        console.error("2FA state error:", e);
        return NextResponse.json({ error: "Two-factor authentication is misconfigured." }, { status: 500 });
      }
    }
    if (totpSecret) {
      if (!totp) {
        return NextResponse.json({ error: "Authentication code required", totp_required: true }, { status: 401 });
      }
      const step = verifyTotpWithSecret(totpSecret, totp);
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

    const ua = (req.headers.get("user-agent") || "").slice(0, 160);
    const { token: sessionToken } = await createAdminSession({
      ip,
      userAgent: (isMobile ? "mobile app | " : "web | ") + ua,
    });
    void dbService.audit(isMobile ? "admin.login_mobile" : "admin.login", { ip });
    if (isMobile) {
      // Every mobile login (no 2FA on that path), never deduplicated.
      void adminAlert(
        "admin_login_mobile",
        "Admin signed in from the MOBILE APP (no 2FA)",
        { IP: ip, Device: ua, "If this wasn't you": "Sign out everywhere + change ADMIN_PASSWORD" },
        { dedupKey: `${ip}:${Date.now()}`, windowSec: 1 }
      );
    } else {
      void adminAlert("admin_login", "Admin signed in", { IP: ip, Device: ua }, { dedupKey: ip, windowSec: 3600 });
    }

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

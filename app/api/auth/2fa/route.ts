// app/api/auth/2fa/route.ts — admin-only 2FA management (Authy / any TOTP app)
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { isAuthenticated, ADMIN_USERNAME } from "@/lib/auth";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";
import { adminAlert } from "@/lib/alerts";
import { otpauthUri } from "@/lib/totp";
import { getTwoFactorState, beginEnrollment, confirmEnrollment, disableTwoFactor } from "@/lib/admin-2fa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await getTwoFactorState());
  } catch {
    return NextResponse.json({ error: "Could not read 2FA state" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ip = getClientIp(req);
  if (!(await dbService.rateLimit("admin-2fa", ip, 10, 15 * 60))) {
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let body: { action?: string; code?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";

  try {
    if (body.action === "begin") {
      const secret = await beginEnrollment();
      const uri = otpauthUri(secret, ADMIN_USERNAME || "admin");
      const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      return NextResponse.json({ secret, otpauth: uri, qr_svg: qrSvg });
    }

    if (body.action === "confirm") {
      const step = await confirmEnrollment(code);
      if (step === null) return NextResponse.json({ error: "That code isn't valid. Check your app and try again." }, { status: 400 });
      await dbService.consumeNonce("totp:" + step, 120); // this code can't then be reused to log in
      void dbService.audit("admin.2fa_enabled", { ip });
      void adminAlert("totp_changed", "Two-factor authentication ENABLED", { IP: ip }, { windowSec: 1, dedupKey: String(Date.now()) });
      return NextResponse.json({ success: true, enabled: true });
    }

    if (body.action === "disable") {
      const step = await disableTwoFactor(code);
      if (step === null) return NextResponse.json({ error: "A valid current code is required to turn 2FA off." }, { status: 400 });
      await dbService.consumeNonce("totp:" + step, 120);
      void dbService.audit("admin.2fa_disabled", { ip });
      void adminAlert("totp_changed", "Two-factor authentication DISABLED", { IP: ip }, { windowSec: 1, dedupKey: String(Date.now()) });
      return NextResponse.json({ success: true, enabled: false });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "2FA error" }, { status: 400 });
  }
}

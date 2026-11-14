import { NextRequest, NextResponse } from "next/server";
import { publicError } from "@/lib/http-errors";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";
import { antiBypassService, createSignedToken, verifySignedToken } from "@/lib/anti-bypass";
import { HWID_RE, HWID_RESET_COOLDOWN_HOURS } from "@/lib/store";
import { adminAlert } from "@/lib/alerts";

// Per-key proof-of-ownership cookie so the full key is only re-shown to the browser that claimed it.
function claimCookieName(keyId: string): string {
  return `aero_ck_${keyId.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`;
}

function setClaimProof(res: NextResponse, req: NextRequest, keyId: string) {
  const isHttps = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const days = 30;
  res.cookies.set({
    name: claimCookieName(keyId),
    value: createSignedToken({ t: "ck", kid: keyId, exp: Date.now() + days * 86400000 }),
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: days * 86400,
  });
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return "••••";
  return key.slice(0, 4) + "•".repeat(Math.max(4, key.length - 8)) + key.slice(-4);
}

async function isVpnOrProxy(req: NextRequest, ip: string): Promise<boolean> {
  const via = req.headers.get("via");
  const forwardHeader = req.headers.get("x-forwarded-proto");
  const proxyConnection = req.headers.get("proxy-connection");

  if (via || proxyConnection) return true;

  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return false;
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,proxy,hosting`, {
      cache: "no-store",
      headers: { "User-Agent": "AeroAuthProxyCheck/1.0" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.proxy === true || data.hosting === true) {
        return true;
      }
    }
  } catch {
    // If external service is unavailable, fail open
  }

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const { searchParams } = new URL(req.url);
    const script_slug = searchParams.get("script") || searchParams.get("script_slug") || "";
    const script_id = searchParams.get("script_id") || "";

    let targetScriptId = script_id;
    if (!targetScriptId && script_slug) {
      const script = await dbService.getScriptMetaBySlug(script_slug);
      if (script) targetScriptId = script.id;
    }

    const existingKey = await dbService.getActiveKeyForIp(ip, targetScriptId);
    const settings = await dbService.getSettings();

    if (existingKey) {
      // SECURITY: this used to hand the full license key to ANYONE on the claimant's IP (shared
      // networks, CGNAT, VPN exits). The full key is only returned to the browser that actually
      // claimed it (signed cookie set at claim time); everyone else gets a masked key.
      const proof = req.cookies.get(claimCookieName(existingKey.id))?.value;
      const verified = proof ? verifySignedToken<{ t: string; kid: string }>(proof) : null;
      const isOwner = Boolean(verified?.valid && verified.payload?.t === "ck" && verified.payload.kid === existingKey.id);

      const base = {
        already_claimed: true,
        duration_hours: existingKey.duration_hours,
        bound_ip: existingKey.claimed_ip,
        expires_at: existingKey.expires_at,
        discord_invite_url: settings.discord_invite_url || "https://discord.gg/NdrTc27GxT",
      };
      if (isOwner) {
        return NextResponse.json({
          ...base,
          key: existingKey.key_string,
          message:
            "You have already claimed a license key for this script on your IP address. If you need another key, please join our Discord.",
        });
      }
      return NextResponse.json({
        ...base,
        key_masked: maskKey(existingKey.key_string),
        message:
          "A license key is already claimed on this network. Complete the checkpoints again to reveal it, or join our Discord if you need help.",
      });
    }

    return NextResponse.json({
      already_claimed: false,
      discord_invite_url: settings.discord_invite_url || "https://discord.gg/NdrTc27GxT",
    });
  } catch (err: unknown) {
    const errorMsg = publicError(err, "Error checking active key");
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, script_slug, script_id, discord_user } = body;
    const ip = getClientIp(req);

    // Throttle every claim-related action per IP (also bounds license-key guessing via reset_ip).
    if (!(await dbService.rateLimit("claim", ip, 20, 60))) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute and try again." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // If client is pinging that checkpoint validation has started
    if (action === "start_checkpoint") {
      await dbService.recordCheckpoint("started", ip);
      return NextResponse.json({ status: "checkpoint_started" });
    }

    // Self-service device (HWID) reset with a 12h cooldown. Clears the binding; the key re-binds to
    // whichever device + Roblox account runs it next.
    if (action === "reset_hwid") {
      const { key } = body;
      if (!key || typeof key !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(key.trim())) {
        return NextResponse.json({ error: "A valid license key is required." }, { status: 400 });
      }
      const keyRec = await dbService.getKeyByString(key.trim().toUpperCase());
      if (!keyRec || keyRec.status === "banned") {
        return NextResponse.json({ error: "License key not found." }, { status: 404 });
      }
      if (await dbService.isIpBanned(ip)) {
        return NextResponse.json({ error: "Access Denied." }, { status: 403 });
      }
      const res = await dbService.resetKeyHwid(keyRec.id, HWID_RESET_COOLDOWN_HOURS);
      if (!res.ok) {
        if (res.reason === "cooldown" && res.retry_at) {
          const hrs = Math.max(1, Math.ceil((new Date(res.retry_at).getTime() - Date.now()) / 3600000));
          return NextResponse.json({ error: `You can move this key again in about ${hrs} hour(s).` }, { status: 429 });
        }
        return NextResponse.json({ error: "Could not reset the device lock. Please try again later." }, { status: 400 });
      }
      void dbService.audit("keys.hwid_reset_self", { target: keyRec.id, ip });
      void adminAlert(
        "hwid_reset",
        "Player moved a key to a new device",
        { Key: `****-${keyRec.key_string.slice(-4)}`, IP: ip },
        { dedupKey: keyRec.id, windowSec: 60 }
      );
      return NextResponse.json({
        success: true,
        message: "Device lock cleared. Run the script on your new device to lock the key to it.",
      });
    }

    // Legacy self-service IP rebind (kept for older clients; IP is no longer the lock once HWID binding is live)
    if (action === "reset_ip") {
      const { key } = body;
      if (!key || typeof key !== "string" || !key.trim()) {
        return NextResponse.json({ error: "License key is required to reset IP." }, { status: 400 });
      }
      try {
        const updated = await dbService.resetKeyIp(key.trim(), ip);
        return NextResponse.json({
          success: true,
          message: `License key successfully rebound to your current IP (${ip}).`,
          bound_ip: updated.claimed_ip,
        });
      } catch (resetErr: unknown) {
        const msg = resetErr instanceof Error ? resetErr.message : "Failed to reset IP";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    const settings = await dbService.getSettings();
    const hwid = (body.hwid || body.claim_id || "").trim();

    // 1. IP Ban check
    if (await dbService.isIpBanned(ip)) {
      return NextResponse.json(
        { error: "Access Denied: Your IP is locked out from claiming keys due to bypass attempts." },
        { status: 403 }
      );
    }

    // 1b. HWID Ban check
    if (hwid && (await dbService.isHwidBanned(hwid))) {
      return NextResponse.json(
        { error: "Access Denied: Your device (HWID) is locked out from claiming keys due to bypass attempts." },
        { status: 403 }
      );
    }

    // 2. VPN Detection check
    if (settings.vpn_detection_enabled) {
      const vpnDetected = await isVpnOrProxy(req, ip);
      if (vpnDetected) {
        return NextResponse.json(
          {
            error: "VPN or Proxy Detected! Please turn off your VPN/Proxy and reload this page to claim a key.",
            is_vpn: true,
          },
          { status: 403 }
        );
      }
    }

    // 3. Resolve target script ID
    let targetScriptId = script_id || "";
    if (!targetScriptId && script_slug) {
      const script = await dbService.getScriptMetaBySlug(script_slug);
      if (script) targetScriptId = script.id;
    }

    // 4. Validate claim method
    if (settings.claim_method === "discord_oauth") {
      // SECURITY: this mode never verified anything — `discord_user` is whatever JSON the client
      // posts (the claim page just sends the username a visitor typed in), so anyone could claim
      // unlimited keys with `{"discord_user":{"id":"1"}}` and skip the checkpoints entirely.
      // Refuse until real server-side Discord OAuth (token exchange + guild membership check) exists.
      return NextResponse.json(
        {
          error:
            "Discord claiming is currently unavailable. Please use the checkpoint claim method or contact the administrator.",
        },
        { status: 501 }
      );
    } else {
      // Enforce strict Anti-Bypass checkpoint verification token
      const { session_id, claim_token } = body;
      if (!session_id || !claim_token) {
        const lockout = await dbService.recordBypassAttempt(
          ip,
          hwid || null,
          targetScriptId,
          "Direct claim attempt without completing checkpoints"
        );

        if (lockout.lockedOut) {
          return NextResponse.json(
            {
              error: "Access Denied: You have been permanently locked out (3/3 bypass attempts). Your IP and HWID are blocked.",
              bypass_blocked: true,
              locked_out: true,
            },
            { status: 403 }
          );
        }

        return NextResponse.json(
          {
            error: `Access Denied: Valid checkpoint verification token is required. Bypassing checkpoints is not permitted. (Warning: Attempt ${lockout.attemptCount}/3 - 3 attempts triggers permanent lockout)`,
            bypass_blocked: true,
            attemptCount: lockout.attemptCount,
          },
          { status: 403 }
        );
      }

      const claimValidation = antiBypassService.verifyAndConsumeClaimToken(
        String(session_id),
        String(claim_token),
        ip,
        targetScriptId
      );

      // Cross-instance, single-use enforcement of the claim token (the in-memory set inside
      // verifyAndConsumeClaimToken only protects a single server instance).
      if (claimValidation.valid && claimValidation.tokenId) {
        const firstUse = await dbService.consumeClaimToken(claimValidation.tokenId, 900);
        if (!firstUse) {
          claimValidation.valid = false;
          claimValidation.error = "This claim authorization token has already been consumed.";
        }
      }

      if (!claimValidation.valid) {
        const lockout = await dbService.recordBypassAttempt(
          ip,
          hwid || null,
          targetScriptId,
          claimValidation.error || "Invalid checkpoint authorization token"
        );

        if (lockout.lockedOut) {
          return NextResponse.json(
            {
              error: "Access Denied: You have been permanently locked out (3/3 bypass attempts). Your IP and HWID are blocked.",
              bypass_blocked: true,
              locked_out: true,
            },
            { status: 403 }
          );
        }

        return NextResponse.json(
          {
            error: `${claimValidation.error || "Checkpoint authorization failed."} (Warning: Attempt ${lockout.attemptCount}/3 - 3 attempts triggers permanent lockout)`,
            bypass_blocked: true,
            attemptCount: lockout.attemptCount,
          },
          { status: 403 }
        );
      }
    }

    // 5. Enforce 1 key per user / IP: Check if an active unexpired key is already bound to this IP
    const existingActiveKey = await dbService.getActiveKeyForIp(ip, targetScriptId);
    if (existingActiveKey) {
      const res = NextResponse.json({
        success: true,
        key: existingActiveKey.key_string,
        duration_hours: existingActiveKey.duration_hours,
        bound_ip: existingActiveKey.claimed_ip,
        expires_at: existingActiveKey.expires_at,
        already_claimed: true,
        message: "Active key found for your IP address.",
      });
      setClaimProof(res, req, existingActiveKey.id);
      return res;
    }

    // 6. Claim fresh key from pool and bind to IP and Discord
    // discord_user is client-supplied and unverified, so it is intentionally NOT stored on the key.
    const claimedKey = await dbService.claimKey(targetScriptId, ip);

    if (!claimedKey) {
      return NextResponse.json(
        {
          error: "No available keys in the pool! Please contact the administrator to generate more keys.",
        },
        { status: 404 }
      );
    }

    // Pre-bind the device when the claim link came from the in-game loader (its ?id= is the same
    // fingerprint verify() checks). Otherwise the key binds on its first run.
    if (HWID_RE.test(hwid)) {
      try {
        await dbService.bindKeyHwid(claimedKey.id, hwid);
      } catch {
        /* binding falls back to first run */
      }
    }

    // Record checkpoint completion
    await dbService.recordCheckpoint("completed", ip);

    const claimRes = NextResponse.json({
      success: true,
      key: claimedKey.key_string,
      duration_hours: claimedKey.duration_hours,
      bound_ip: claimedKey.claimed_ip,
      expires_at: claimedKey.expires_at,
    });
    setClaimProof(claimRes, req, claimedKey.id);
    return claimRes;
  } catch (err: unknown) {
    const errorMsg = publicError(err, "Error claiming key");
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

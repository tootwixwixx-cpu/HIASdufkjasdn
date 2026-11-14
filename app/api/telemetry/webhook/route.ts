// app/api/telemetry/webhook/route.ts
// Relay for in-game telemetry -> Discord. The hub used to POST straight to a Discord webhook URL
// embedded in client-side Lua (readable by every user, who could then spam/delete it). Now the client
// posts here and the real webhook URL lives only in the HUB_TELEMETRY_WEBHOOK_URL env var.
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";

export const runtime = "nodejs";

const DISCORD_WEBHOOK_RE = /^https:\/\/((ptb|canary)\.)?(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

const clip = (v: unknown, n: number): string => String(v ?? "").slice(0, n);

export async function POST(req: NextRequest) {
  const url = process.env.HUB_TELEMETRY_WEBHOOK_URL || "";
  if (!DISCORD_WEBHOOK_RE.test(url)) {
    // Not configured: accept and drop so clients never error.
    return NextResponse.json({ ok: true, delivered: false });
  }

  const ip = getClientIp(req);
  // Per-IP AND global caps: a per-IP limit alone can't stop a distributed spammer from flooding
  // your Discord channel (Discord itself allows ~30 webhook messages/min).
  if (
    !(await dbService.rateLimit("hub-telemetry", ip, 10, 60)) ||
    !(await dbService.rateLimit("hub-telemetry-global", "all", 25, 60))
  ) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const body = await req.json();
    const src = Array.isArray(body?.embeds) ? body.embeds[0] : null;
    if (!src || typeof src !== "object") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Rebuild the message from whitelisted, length-capped fields. Never forward `content`, mentions,
    // components, attachments or a caller-chosen username/avatar.
    const fields = (Array.isArray(src.fields) ? src.fields : []).slice(0, 8).map((f: any) => ({
      name: clip(f?.name, 64) || "-",
      value: clip(f?.value, 300) || "-",
      inline: Boolean(f?.inline),
    }));
    const embed = {
      title: clip(src.title, 100) || "AtomWare Hub — Auth Audit Log",
      color: Number.isInteger(src.color) && src.color >= 0 && src.color <= 0xffffff ? src.color : 0x5865f2,
      fields,
      footer: { text: clip(src?.footer?.text, 100) },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        username: "AtomWare Hub Telemetry",
        embeds: [embed],
        allowed_mentions: { parse: [] },
      }),
    });
    return NextResponse.json({ ok: true, delivered: res.ok });
  } catch {
    return NextResponse.json({ error: "Telemetry error" }, { status: 500 });
  }
}

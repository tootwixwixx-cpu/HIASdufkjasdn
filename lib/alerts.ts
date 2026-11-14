// lib/alerts.ts
// Admin security/ops alerts → Discord (ADMIN_ALERT_WEBHOOK_URL) + the admin_notifications table.
// Never throws and never blocks a request for long. Duplicate alerts inside `windowSec` are
// suppressed (shared across instances via Redis, or Postgres if Redis isn't configured).
// NOTE: intentionally does not import lib/store.ts (store calls into this module).
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { kvConsumeOnce } from "@/lib/kv";
import { scrubString } from "@/lib/sentry-scrub";

export type AlertType =
  | "admin_login"
  | "admin_login_mobile"
  | "admin_login_failures"
  | "ip_banned_bruteforce"
  | "bypass_lockout"
  | "bypass_spike"
  | "key_sharing"
  | "hwid_reset"
  | "new_country"
  | "remote_code"
  | "script_deleted"
  | "script_restored"
  | "totp_changed";

const SEVERITY: Record<AlertType, "info" | "warn" | "critical"> = {
  admin_login: "info",
  admin_login_mobile: "warn",
  admin_login_failures: "critical",
  ip_banned_bruteforce: "warn",
  bypass_lockout: "warn",
  bypass_spike: "critical",
  key_sharing: "warn",
  hwid_reset: "info",
  new_country: "info",
  remote_code: "critical",
  script_deleted: "warn",
  script_restored: "warn",
  totp_changed: "critical",
};

// admin_notifications.type has a fixed CHECK list (see migration/001_schema.sql)
const NOTIFICATION_TYPE: Record<AlertType, string> = {
  admin_login: "system_event",
  admin_login_mobile: "system_event",
  admin_login_failures: "system_event",
  ip_banned_bruteforce: "tamper_alert",
  bypass_lockout: "bypass_lockout",
  bypass_spike: "bypass_lockout",
  key_sharing: "alt_farm_detected",
  hwid_reset: "system_event",
  new_country: "system_event",
  remote_code: "system_event",
  script_deleted: "system_event",
  script_restored: "system_event",
  totp_changed: "system_event",
};

const COLORS = { info: 0x3b82f6, warn: 0xf59e0b, critical: 0xef4444 };
const WEBHOOK_RE = /^https:\/\/((ptb|canary)\.)?(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

async function firstInWindow(key: string, windowSec: number): Promise<boolean> {
  const viaKv = await kvConsumeOnce("alert:" + key, windowSec);
  if (viaKv !== null) return viaKv;
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc("consume_nonce", { p_nonce: "alert:" + key, p_ttl_seconds: windowSec });
      if (!error && typeof data === "boolean") return data;
    } catch {
      /* fall through */
    }
  }
  return true; // can't dedupe: send rather than silently drop a security alert
}

export interface AlertOptions {
  /** Alerts with the same dedupKey are sent at most once per windowSec. Defaults to the type. */
  dedupKey?: string;
  windowSec?: number;
}

/**
 * Sends an admin alert. Field values should not contain secrets; they are scrubbed of tokens/keys
 * anyway. IPs ARE shown on purpose (the admin channel is where you need them).
 */
export async function adminAlert(
  type: AlertType,
  title: string,
  fields: Record<string, string | number | null | undefined> = {},
  opts: AlertOptions = {}
): Promise<void> {
  try {
    const windowSec = opts.windowSec ?? 300;
    if (!(await firstInWindow(`${type}:${opts.dedupKey ?? "global"}`, windowSec))) return;

    const sev = SEVERITY[type];
    const cleanFields = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
      .slice(0, 10)
      .map(([name, v]) => ({
        name: name.slice(0, 64),
        // keep IPs visible for the admin, but strip tokens / keys / webhooks
        value: String(v).replace(/\bsb_secret_[A-Za-z0-9_-]+|\bgh[pousr]_[A-Za-z0-9]{20,}|https:\/\/[^\s]*discord[^\s]*webhooks[^\s]*/g, "[redacted]").slice(0, 300),
        inline: true,
      }));

    const tasks: Promise<unknown>[] = [];
    const url = process.env.ADMIN_ALERT_WEBHOOK_URL || "";
    if (WEBHOOK_RE.test(url)) {
      tasks.push(
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(4000),
          body: JSON.stringify({
            username: "AtomProtect Alerts",
            allowed_mentions: { parse: [] },
            embeds: [
              {
                title: `${sev === "critical" ? "🚨" : sev === "warn" ? "⚠️" : "ℹ️"} ${title}`.slice(0, 200),
                color: COLORS[sev],
                fields: cleanFields,
                timestamp: new Date().toISOString(),
                footer: { text: type },
              },
            ],
          }),
        }).catch(() => undefined)
      );
    }
    if (isSupabaseConfigured && supabase) {
      tasks.push(
        Promise.resolve(
          supabase.from("admin_notifications").insert({
            type: NOTIFICATION_TYPE[type],
            title: title.slice(0, 200),
            body: scrubString(cleanFields.map((f) => `${f.name}: ${f.value}`).join("\n")).slice(0, 2000) || title,
            data: { alert_type: type },
          })
        ).catch(() => undefined)
      );
    }
    await Promise.all(tasks);
  } catch (err) {
    console.error("[alerts] failed:", err);
  }
}

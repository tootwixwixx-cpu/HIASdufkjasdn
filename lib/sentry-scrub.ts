// lib/sentry-scrub.ts
// Strips personal data and secrets from every Sentry event BEFORE it leaves the server/browser.
// Error reports must never contain player IPs, license keys, HWIDs, session tokens, webhook URLs,
// API keys, cookies or request bodies.
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

const PATTERNS: [RegExp, string][] = [
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[supabase-key]"],
  [/\bsbp_[a-f0-9]{20,}/g, "[supabase-pat]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[github-token]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[jwt]"],
  [/https:\/\/((ptb|canary)\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g, "[discord-webhook]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]"],
  [/\b\d{10,16}\.[a-f0-9]{32}\.[a-f0-9]{64}\b/g, "[admin-session]"],
  [/\b[a-f0-9]{16}_[!-~]{1,40}/g, "[hwid]"],
  [/\b[A-Z0-9_-]{2,16}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, "[license-key]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"],
  [/\b(?:[a-f0-9]{1,4}:){2,7}[a-f0-9]{1,4}\b/gi, "[ip]"],
];

export function scrubString(s: string): string {
  let out = s;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

function scrubDeep(v: unknown, depth = 0): unknown {
  if (depth > 8 || v === null || v === undefined) return v;
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, depth + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/(password|secret|token|cookie|authorization|key_string|license|hwid|webhook|ip_address|^ip$)/i.test(k)) {
        o[k] = "[redacted]";
      } else {
        o[k] = scrubDeep(val, depth + 1);
      }
    }
    return o;
  }
  return v;
}

const DROP_HEADERS = /^(authorization|cookie|set-cookie|x-forwarded-for|x-real-ip|x-vercel-forwarded-for|cf-connecting-ip|x-session-id|x-license-key|x-hwid)$/i;

export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  try {
    if (event.user) event.user = { id: event.user.id ? "[user]" : undefined };
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      if (event.request.headers) {
        for (const h of Object.keys(event.request.headers)) {
          if (DROP_HEADERS.test(h)) delete event.request.headers[h];
        }
      }
      if (event.request.url) event.request.url = scrubString(event.request.url.split("?")[0]);
      delete event.request.query_string;
    }
    if (event.message) event.message = scrubString(event.message);
    if (event.exception?.values) {
      for (const ex of event.exception.values) {
        if (ex.value) ex.value = scrubString(ex.value);
      }
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b) => ({
        ...b,
        message: b.message ? scrubString(b.message) : b.message,
        data: b.data ? (scrubDeep(b.data) as typeof b.data) : b.data,
      }));
    }
    if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
    if (event.contexts) event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
    if (event.tags) event.tags = scrubDeep(event.tags) as typeof event.tags;
    return event;
  } catch {
    // If scrubbing itself fails, drop the event rather than risk leaking data.
    return null;
  }
}

export const SENTRY_BASE_OPTIONS = {
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend: scrubEvent,
  beforeBreadcrumb(b: { category?: string; message?: string; data?: Record<string, unknown> }) {
    // fetch/xhr breadcrumbs carry full URLs (keys, tokens in query strings) — keep only the path.
    if (b.data && typeof b.data.url === "string") b.data = { ...b.data, url: scrubString(String(b.data.url).split("?")[0]) };
    if (b.message) b.message = scrubString(b.message);
    return b;
  },
};

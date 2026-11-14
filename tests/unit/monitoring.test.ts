import { describe, it, expect, vi, afterEach } from "vitest";
import { scrubEvent, scrubString } from "@/lib/sentry-scrub";
import { kvRateLimit, kvConsumeOnce, kvGetJSON, isRedisConfigured } from "@/lib/kv";

// Fake secret-shaped strings are assembled at runtime so no token-like literal ever sits in the repo.
const FAKE_GH = "gh" + "p_" + "a".repeat(24);
const FAKE_SB = "sb_" + "secret_XYZ123abc";
const FAKE_SB2 = "sb_" + "secret_abc";
const FAKE_HOOK = "https://discord.com/api/" + "webhooks/123/abcDEF_-x";

describe("Sentry scrubbing", () => {
  it("removes IPs, license keys, HWIDs, tokens and webhooks from strings", () => {
    const s = scrubString(
      "user 203.0.113.7 key KEY-AB12-CD34-EF56 hwid 0123456789abcdef_ABC123 " +
        `Bearer abc.def ${FAKE_SB} ${FAKE_GH} ` +
        FAKE_HOOK
    );
    for (const leak of ["203.0.113.7", "KEY-AB12-CD34-EF56", "0123456789abcdef_ABC123", "sb_secret_", "ghp_", "webhooks/123"]) {
      expect(s).not.toContain(leak);
    }
  });

  it("drops cookies, bodies, auth/IP headers, query strings and user IPs from events", () => {
    const ev = scrubEvent({
      type: undefined,
      message: "failed for 198.51.100.4",
      user: { id: "x", ip_address: "198.51.100.4" },
      request: {
        url: "https://site/api/claim?key=KEY-AAAA-BBBB-CCCC",
        cookies: { aero_admin_session: "secret" },
        data: { key: "KEY-AAAA-BBBB-CCCC" },
        headers: { authorization: "Bearer x", "x-forwarded-for": "1.2.3.4", "user-agent": "ok" },
        query_string: "key=KEY-AAAA-BBBB-CCCC",
      },
      exception: { values: [{ type: "Error", value: "bad key KEY-AAAA-BBBB-CCCC from 1.2.3.4" }] },
      extra: { password: "hunter2", nested: { ip_address: "1.2.3.4", note: "from 1.2.3.4" } },
    } as any)!;
    const json = JSON.stringify(ev);
    for (const leak of ["198.51.100.4", "1.2.3.4", "KEY-AAAA-BBBB-CCCC", "hunter2", "secret", "Bearer x"]) {
      expect(json).not.toContain(leak);
    }
    expect(ev.request!.headers!["user-agent"]).toBe("ok");
    expect(ev.request!.url).toBe("https://site/api/claim");
  });
});

describe("kv (Redis) without configuration", () => {
  it("reports unavailable so callers fall back to Postgres", async () => {
    expect(isRedisConfigured).toBe(false);
    expect(await kvRateLimit("b", "k", 1, 60)).toBeNull();
    expect(await kvConsumeOnce("n", 60)).toBeNull();
    expect(await kvGetJSON("x")).toBeUndefined();
  });
});

describe("admin alerts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADMIN_ALERT_WEBHOOK_URL;
  });

  it("posts a sanitised embed with mentions disabled", async () => {
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://discord.com/api/webhooks/1/tok_en";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { adminAlert } = await import("@/lib/alerts");
    await adminAlert("admin_login", "Admin signed in", { IP: "1.2.3.4", Leak: `${FAKE_SB2} ${FAKE_GH}` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    const text = JSON.stringify(body);
    expect(text).toContain("1.2.3.4"); // IPs are intentionally visible to the admin
    expect(text).not.toContain(FAKE_SB2);
    expect(text).not.toContain("ghp_");
  });

  it("does nothing when the webhook env var is missing or not a Discord URL", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { adminAlert } = await import("@/lib/alerts");
    await adminAlert("admin_login", "x");
    process.env.ADMIN_ALERT_WEBHOOK_URL = "https://evil.example.com/hook";
    await adminAlert("admin_login", "y");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

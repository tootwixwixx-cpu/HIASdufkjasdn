import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { sealSecret, openSecret } from "@/lib/secret-box";
import { generateTotpSecret, verifyTotpWithSecret, otpauthUri } from "@/lib/totp";

describe("secret-box (2FA secret encryption at rest)", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "unit-test-auth-secret-0123456789";
  });

  it("round-trips", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", "admin-totp");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(openSecret(sealed, "admin-totp")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("uses a fresh IV every time", () => {
    expect(sealSecret("x", "p")).not.toBe(sealSecret("x", "p"));
  });

  it("rejects tampering, the wrong purpose, and a changed AUTH_SECRET", () => {
    const sealed = sealSecret("secret", "admin-totp");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    expect(openSecret(parts.join("."), "admin-totp")).toBeNull();
    expect(openSecret(sealed, "other-purpose")).toBeNull();
    process.env.AUTH_SECRET = "a-different-secret-entirely-xxxxx";
    expect(openSecret(sealed, "admin-totp")).toBeNull();
  });
});

describe("TOTP", () => {
  afterEach(() => vi.useRealTimers());

  it("matches the RFC 6238 SHA-1 test vector and allows ±1 step of drift", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    expect(verifyTotpWithSecret(secret, "287082")).not.toBeNull();
    expect(verifyTotpWithSecret(secret, "000000")).toBeNull();
    vi.setSystemTime(59_000 + 30_000);
    expect(verifyTotpWithSecret(secret, "287082")).not.toBeNull(); // previous step still OK
    vi.setSystemTime(59_000 + 120_000);
    expect(verifyTotpWithSecret(secret, "287082")).toBeNull(); // stale
  });

  it("generates 160-bit base32 secrets and authenticator-compatible URIs", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(s);
    const uri = otpauthUri(s, "admin");
    expect(uri.startsWith("otpauth://totp/AtomProtect%3Aadmin?secret=" + s)).toBe(true);
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("rejects malformed codes", () => {
    const s = generateTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345"]) expect(verifyTotpWithSecret(s, bad)).toBeNull();
  });
});

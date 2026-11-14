import { describe, it, expect } from "vitest";
import { normalizeHwid, HWID_RE } from "@/lib/store";

describe("HWID fingerprint normalisation", () => {
  it("accepts the loader's normal formats unchanged", () => {
    expect(normalizeHwid("0123456789abcdef_123456789")).toBe("0123456789abcdef_123456789");
    expect(normalizeHwid("0123456789abcdef_A1B2-C3D4E")).toBe("0123456789abcdef_A1B2-C3D4E");
    expect(HWID_RE.test(normalizeHwid("0123456789abcdef_123456789"))).toBe(true);
  });

  it("strips spaces / non-ASCII from the executor part instead of rejecting the player", () => {
    const n = normalizeHwid("0123456789ABCDEF_ab cdé{}xyz");
    expect(n).toBe("0123456789abcdef_abcd{}xyz");
    expect(HWID_RE.test(n)).toBe(true);
    expect(HWID_RE.test(normalizeHwid("0123456789abcdef_   "))).toBe(true); // empty suffix → placeholder
  });

  it("is stable (same input → same binding)", () => {
    const raw = "fedcba9876543210_ゲーム id";
    expect(normalizeHwid(raw)).toBe(normalizeHwid(raw));
  });

  it("rejects anything without the 16-hex hash", () => {
    for (const bad of ["", "nope", "123_abc", "0123456789abcdeg_x", null, 42]) expect(normalizeHwid(bad)).toBe("");
  });
});

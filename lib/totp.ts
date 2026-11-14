// lib/totp.ts — RFC 6238 TOTP (SHA-1, 30s, 6 digits; the format Authy and every authenticator use).
// Node runtime only.
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** New random 160-bit secret, base32 (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function otpauthUri(secretB32: string, account: string, issuer = "AtomProtect"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Verifies a 6-digit code against a base32 secret, allowing ±1 time step for clock drift.
 * Returns the matched time step (use it for replay protection) or null.
 */
export function verifyTotpWithSecret(secretB32: string, code: string): number | null {
  if (!secretB32 || !/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  if (secret.length === 0) return null;
  const step = Math.floor(Date.now() / 30000);
  for (const delta of [0, -1, 1]) {
    const expected = hotp(secret, step + delta);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return step + delta;
  }
  return null;
}

/** Env-var override (ADMIN_TOTP_SECRET). The dashboard enrolment stores its secret in the DB instead. */
export function isTotpConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}

export function verifyTotp(code: string): number | null {
  return verifyTotpWithSecret(process.env.ADMIN_TOTP_SECRET || "", code);
}

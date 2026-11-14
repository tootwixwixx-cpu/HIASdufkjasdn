// lib/totp.ts — RFC 6238 TOTP (SHA-1, 30s, 6 digits) using node:crypto. Node runtime only.
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

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}

export function isTotpConfigured(): boolean {
  return Boolean(process.env.ADMIN_TOTP_SECRET);
}

/**
 * Verifies a 6-digit code against ADMIN_TOTP_SECRET (base32), allowing ±1 time step for clock drift.
 * Returns the matched step (for replay protection) or null.
 */
export function verifyTotp(code: string): number | null {
  const secretB32 = process.env.ADMIN_TOTP_SECRET || "";
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

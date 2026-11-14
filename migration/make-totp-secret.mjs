#!/usr/bin/env node
// Generates a TOTP secret for admin 2FA.
//   node migration/make-totp-secret.mjs [accountName]
// 1. Put the printed secret in the ADMIN_TOTP_SECRET env var (Vercel + .env.local) and redeploy.
// 2. Add it to your authenticator app: scan the otpauth URL as a QR code (any QR generator), or choose
//    "enter setup key" and paste the secret (type: time-based, 6 digits, 30s, SHA-1).
// Once ADMIN_TOTP_SECRET is set, /api/auth/login requires the 6-digit code.
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const bytes = crypto.randomBytes(20);
let bits = 0, value = 0, out = "";
for (const b of bytes) {
  value = (value << 8) | b;
  bits += 8;
  while (bits >= 5) {
    out += B32[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
}
if (bits > 0) out += B32[(value << (5 - bits)) & 31];

const account = encodeURIComponent(process.argv[2] || "admin");
console.log("\nADMIN_TOTP_SECRET=" + out);
console.log(`\notpauth URL (for a QR code):\notpauth://totp/AtomProtect:${account}?secret=${out}&issuer=AtomProtect&algorithm=SHA1&digits=6&period=30\n`);

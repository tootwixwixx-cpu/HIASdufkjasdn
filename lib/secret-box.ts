// lib/secret-box.ts — AES-256-GCM encryption for small secrets stored in the database
// (currently the admin 2FA secret). The key is derived from AUTH_SECRET, so a database dump alone
// can't reveal the 2FA secret. Node runtime only.
import crypto from "crypto";

function key(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET || "";
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return crypto.createHash("sha256").update(`atomprotect:${purpose}:v1:` + secret).digest();
}

/** Returns "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function sealSecret(plaintext: string, purpose: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(purpose), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/** Returns the plaintext, or null if the value was tampered with or AUTH_SECRET changed. */
export function openSecret(sealed: string, purpose: string): string | null {
  try {
    const [v, iv, tag, ct] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || !ct) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

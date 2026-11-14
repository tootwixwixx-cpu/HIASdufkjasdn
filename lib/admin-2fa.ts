// lib/admin-2fa.ts — dashboard-managed admin 2FA (Authy or any TOTP app).
// The secret is generated server-side, encrypted (lib/secret-box) and stored in admin_totp.
// ADMIN_TOTP_SECRET in the environment, if set, overrides the database enrolment.
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { sealSecret, openSecret } from "@/lib/secret-box";
import { generateTotpSecret, verifyTotpWithSecret } from "@/lib/totp";

const PURPOSE = "admin-totp";

interface Row {
  secret_enc: string;
  enabled: boolean;
}

async function readRow(): Promise<Row | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.from("admin_totp").select("secret_enc, enabled").eq("id", 1).maybeSingle();
  if (error) {
    // Table missing (migration 002 not applied) → behave as "not enrolled".
    if (error.code === "42P01" || error.code === "PGRST205") return null;
    throw new Error("Could not read 2FA state");
  }
  return (data as Row) || null;
}

export async function getTwoFactorState(): Promise<{ enabled: boolean; source: "env" | "db" | null; pending: boolean }> {
  if (process.env.ADMIN_TOTP_SECRET) return { enabled: true, source: "env", pending: false };
  const row = await readRow();
  if (row?.enabled) return { enabled: true, source: "db", pending: false };
  return { enabled: false, source: null, pending: Boolean(row && !row.enabled) };
}

/** The secret that logins must satisfy, or null when 2FA is off. */
export async function getActiveTotpSecret(): Promise<string | null> {
  if (process.env.ADMIN_TOTP_SECRET) return process.env.ADMIN_TOTP_SECRET;
  const row = await readRow();
  if (!row?.enabled) return null;
  const secret = openSecret(row.secret_enc, PURPOSE);
  if (!secret) {
    // Can't decrypt (AUTH_SECRET rotated?) — fail CLOSED rather than silently disabling 2FA.
    throw new Error("2FA secret could not be decrypted; reset it with ADMIN_TOTP_SECRET or by clearing admin_totp.");
  }
  return secret;
}

/** Starts enrolment: stores a new pending secret and returns it for the QR code. */
export async function beginEnrollment(): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error("2FA enrolment needs the database.");
  const state = await getTwoFactorState();
  if (state.enabled) throw new Error("2FA is already enabled. Disable it first to re-enrol.");
  const secret = generateTotpSecret();
  const { error } = await supabase.from("admin_totp").upsert({
    id: 1,
    secret_enc: sealSecret(secret, PURPOSE),
    enabled: false,
    enrolled_at: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Could not start 2FA enrolment (has migration 002 been applied?)");
  return secret;
}

/** Finishes enrolment once the user proves their app produces valid codes. Returns the matched step. */
export async function confirmEnrollment(code: string): Promise<number | null> {
  const row = await readRow();
  if (!row || row.enabled) return null;
  const secret = openSecret(row.secret_enc, PURPOSE);
  if (!secret) return null;
  const step = verifyTotpWithSecret(secret, code);
  if (step === null) return null;
  const { error } = await supabase!
    .from("admin_totp")
    .update({ enabled: true, enrolled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", 1);
  return error ? null : step;
}

/** Disables dashboard 2FA; requires a current code. Returns the matched step or null. */
export async function disableTwoFactor(code: string): Promise<number | null> {
  const secret = await getActiveTotpSecret();
  if (!secret || process.env.ADMIN_TOTP_SECRET) return null; // env-managed 2FA can only be changed in the env
  const step = verifyTotpWithSecret(secret, code);
  if (step === null) return null;
  const { error } = await supabase!.from("admin_totp").delete().eq("id", 1);
  return error ? null : step;
}

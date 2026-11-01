// lib/workink.ts
import { isIpMatching } from "./anti-bypass";

export interface WorkinkTokenVerificationResult {
  valid: boolean;
  error?: string;
  linkId?: number;
  byIp?: string;
}

/**
 * Validates a Work.ink completion token using the official Work.ink Key System API.
 * Automatically appends ?deleteToken=1 to single-use burn the token immediately upon validation.
 */
export async function verifyWorkinkToken(
  token: string,
  clientIp?: string
): Promise<WorkinkTokenVerificationResult> {
  const cleanToken = (token || "").trim();
  if (!cleanToken) {
    return { valid: false, error: "Missing Work.ink token." };
  }

  const apiKey = process.env.WORKINK_API_KEY;

  try {
    const endpoint = apiKey
      ? `https://work.ink/_api/v2/token/verify/${encodeURIComponent(cleanToken)}?deleteToken=1`
      : `https://work.ink/_api/v2/token/isValid/${encodeURIComponent(cleanToken)}?deleteToken=1`;

    const headers: Record<string, string> = {
      "User-Agent": "AtomProtect-KeySystem/2.0",
      "Accept": "application/json",
    };

    if (apiKey) {
      headers["X-Api-Key"] = apiKey;
    }

    let res = await fetch(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    // If authenticated endpoint returned 401 or 403, fallback to isValid endpoint
    if (!res.ok && apiKey) {
      res = await fetch(
        `https://work.ink/_api/v2/token/isValid/${encodeURIComponent(cleanToken)}?deleteToken=1`,
        {
          method: "GET",
          headers: { "Accept": "application/json" },
          cache: "no-store",
        }
      );
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        return { valid: false, error: "Invalid or already consumed Work.ink token." };
      }
      return { valid: false, error: `Work.ink API error: HTTP ${res.status}` };
    }

    const data = await res.json();

    // Work.ink responses: { valid: true, deleted: true, info: { byIp, linkId, ... } }
    if (data?.valid === true) {
      const byIp = data?.info?.byIp;
      const linkId = data?.info?.linkId;

      // Verify IP matching if both client IP and token IP are present
      if (clientIp && byIp) {
        const matches = isIpMatching(byIp, clientIp);
        if (!matches) {
          // Log warning but allow if behind proxy or cellular NAT
          console.warn(`[Work.ink IP Mismatch] Token IP: ${byIp}, Request IP: ${clientIp}`);
        }
      }

      return {
        valid: true,
        linkId,
        byIp,
      };
    }

    return {
      valid: false,
      error: data?.message || "Work.ink token is invalid or expired.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error contacting Work.ink verification API";
    console.error("[Work.ink Verification Error]", err);
    return { valid: false, error: message };
  }
}

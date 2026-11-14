// lib/anti-bypass.ts
import crypto from "crypto";
import type { CheckpointItem } from "./store";

// SECURITY: must come from its own dedicated env var. Previously this fell back to the
// Supabase service-role key (reusing a DB credential as an unrelated HMAC secret) and,
// failing that, a hardcoded string baked into the source. Both fallbacks are removed —
// if ANTI_BYPASS_SECRET isn't set, every signed token this module issues/verifies is
// invalid (fails closed) rather than silently using a guessable/leaked key.
const HMAC_SECRET = process.env.ANTI_BYPASS_SECRET || "";
if (!HMAC_SECRET) {
  console.error(
    "[anti-bypass] ANTI_BYPASS_SECRET is not set. Checkpoint/gateway/claim tokens cannot be signed or verified."
  );
}

// In-memory set of consumed claim tokens to prevent replay attacks
const consumedClaimTokens = new Set<string>();

// Normalizes an IPv4-mapped IPv6 address ("::ffff:1.2.3.4") down to its plain IPv4
// form, so the *same* address represented in either notation compares equal. This is
// the only legitimate "different format, same address" case — it must NOT be used to
// wave through an arbitrary IPv4 address against an arbitrary IPv6 address (that was
// the bug: comparing "does it contain a colon" instead of the actual address).
function normalizeIpForCompare(ip: string): string {
  const v4MappedMatch = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip.trim());
  if (v4MappedMatch) return v4MappedMatch[1];
  return ip.trim().toLowerCase();
}

export function isIpMatching(tokenIp: string, reqIp: string): boolean {
  if (!tokenIp || !reqIp) return true;

  const normToken = normalizeIpForCompare(tokenIp);
  const normReq = normalizeIpForCompare(reqIp);
  if (normToken === normReq) return true;

  // Localhost aliases
  const isLocalToken =
    normToken === "127.0.0.1" || normToken === "::1" || normToken === "localhost";
  const isLocalReq =
    normReq === "127.0.0.1" || normReq === "::1" || normReq === "localhost";
  if (isLocalToken && isLocalReq) return true;

  return false;
}

export function createSignedToken<T extends object>(payload: T): string {
  // SECURITY: crypto.createHmac("sha256", "") happily signs with an empty key, so a missing
  // ANTI_BYPASS_SECRET would silently let anyone forge gateway/step/claim tokens. Fail closed.
  if (!HMAC_SECRET) {
    throw new Error("ANTI_BYPASS_SECRET is not configured; cannot issue signed tokens.");
  }
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", HMAC_SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifySignedToken<T extends object>(
  token: string
): { valid: boolean; payload?: T; error?: string } {
  if (!HMAC_SECRET) {
    return { valid: false, error: "Server token signing is not configured." };
  }
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, error: "Malformed token format." };
  }

  const [b64, sig] = token.split(".");
  if (!b64 || !sig) {
    return { valid: false, error: "Invalid token structure." };
  }

  const expectedSig = crypto.createHmac("sha256", HMAC_SECRET).update(b64).digest("base64url");
  if (sig.length !== expectedSig.length) {
    return { valid: false, error: "Invalid token signature length." };
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(sig, "utf8"),
    Buffer.from(expectedSig, "utf8")
  );
  if (!match) {
    return { valid: false, error: "Token signature verification failed. Tampering detected." };
  }

  try {
    const raw = Buffer.from(b64, "base64url").toString("utf8");
    const payload = JSON.parse(raw) as T & { exp?: number };
    if (payload.exp && Date.now() > payload.exp) {
      return { valid: false, error: "Token has expired. Please refresh the page." };
    }
    return { valid: true, payload };
  } catch {
    return { valid: false, error: "Failed to parse token payload." };
  }
}

// Difficulty 4 (~65k SHA-256 hashes on average, well under a second in a browser) — 16x the
// cost of the old default of 3, which was trivially cheap to automate.
export const POW_DIFFICULTY = 4;

export function generatePoWChallenge(difficulty = POW_DIFFICULTY): { nonce: string; difficulty: number } {
  return {
    nonce: crypto.randomBytes(16).toString("hex"),
    difficulty,
  };
}

export function verifyPoWSolution(nonce: string, solution: string, difficulty: number): boolean {
  if (!solution || typeof solution !== "string") return false;
  const hash = crypto.createHash("sha256").update(nonce + solution).digest("hex");
  const prefix = "0".repeat(difficulty);
  return hash.startsWith(prefix);
}

export interface GatewayTokenPayload {
  t: "gw";
  sid: string;
  step: number;
  total: number;
  ip: string;
  targetUrl: string;
  duration: number;
  scriptId: string;
  exp: number;
}

export interface ActiveStepTokenPayload {
  t: "active";
  sid: string;
  step: number;
  total: number;
  ip: string;
  startedAt: number; // Server clock millisecond timestamp
  duration: number;
  scriptId: string;
  powNonce: string;
  powDifficulty: number;
  exp: number;
}

export interface ClaimTokenPayload {
  t: "claim";
  sid: string;
  scriptId: string;
  ip: string;
  completedAt: number;
  exp: number;
}

export const antiBypassService = {
  createSession(
    ip: string,
    userAgent: string,
    scriptId: string,
    checkpoints: CheckpointItem[]
  ): {
    sessionId: string;
    totalSteps: number;
    currentStep: number;
    stepDetails: {
      id: string;
      title: string;
      duration_seconds: number;
      order: number;
      url?: string;
      gatewayUrl: string;
      gatewayToken: string;
      is_workink?: boolean;
    }[];
    powChallenge: { nonce: string; difficulty: number };
  } {
    const sessionId = crypto.randomUUID();
    const sorted = [...checkpoints].sort((a, b) => a.order - b.order);
    const totalSteps = sorted.length;
    const powChallenge = generatePoWChallenge();

    const stepDetails = sorted.map((cp, idx) => {
      const isWorkink = Boolean(
        Number(cp.duration_seconds) === 0 ||
        cp.url?.includes("work.ink") ||
        cp.url?.includes("workink.net") ||
        (cp as any).is_workink
      );
      const duration = isWorkink ? 0 : Math.max(1, Number(cp.duration_seconds) || 5);
      const gwPayload: GatewayTokenPayload = {
        t: "gw",
        sid: sessionId,
        step: idx,
        total: totalSteps,
        ip,
        targetUrl: cp.url,
        duration,
        scriptId,
        exp: Date.now() + 60 * 60 * 1000, // 1 hour validity
      };
      const gatewayToken = createSignedToken(gwPayload);
      const gatewayUrl = `/api/checkpoints/gateway?gt=${gatewayToken}`;

      return {
        id: cp.id,
        title: cp.title,
        duration_seconds: duration,
        order: cp.order,
        url: cp.url,
        gatewayUrl,
        gatewayToken,
        is_workink: isWorkink,
      };
    });

    return {
      sessionId,
      totalSteps,
      currentStep: 0,
      stepDetails,
      powChallenge,
    };
  },

  resolveGateway(
    gatewayToken: string,
    ip?: string
  ): {
    success: boolean;
    targetUrl?: string;
    error?: string;
  } {
    const res = verifySignedToken<GatewayTokenPayload>(gatewayToken);
    if (!res.valid || !res.payload) {
      return { success: false, error: res.error || "Invalid task gateway token." };
    }

    const payload = res.payload;
    if (payload.t !== "gw" || !payload.targetUrl) {
      return { success: false, error: "Invalid gateway payload or destination URL missing." };
    }

    if (ip && !isIpMatching(payload.ip, ip)) {
      // Allow redirect even if IP changed, destination task is external
    }

    return {
      success: true,
      targetUrl: payload.targetUrl,
    };
  },

  // Backwards compatibility for older link formats
  registerGatewayVisit(
    session: string,
    step: number,
    token: string,
    ip: string
  ): { success: boolean; targetUrl?: string; error?: string } {
    if (token && token.includes(".")) {
      return this.resolveGateway(token, ip);
    }
    return {
      success: false,
      error: "Session expired or invalid link. Please reload the claim page.",
    };
  },

  startStep(
    gatewayToken: string,
    ip: string
  ): {
    success: boolean;
    activeStepToken?: string;
    targetUrl?: string;
    duration?: number;
    stepIndex?: number;
    powChallenge?: { nonce: string; difficulty: number };
    error?: string;
  } {
    const res = verifySignedToken<GatewayTokenPayload>(gatewayToken);
    if (!res.valid || !res.payload) {
      return { success: false, error: res.error || "Invalid task gateway token." };
    }

    const payload = res.payload;
    if (payload.t !== "gw") {
      return { success: false, error: "Invalid token type." };
    }

    if (!isIpMatching(payload.ip, ip)) {
      return {
        success: false,
        error: "Network mismatch detected: Task must be opened from the claiming IP.",
      };
    }

    const powChallenge = generatePoWChallenge();

    // Stamp current server clock timestamp for strict temporal verification
    const activePayload: ActiveStepTokenPayload = {
      t: "active",
      sid: payload.sid,
      step: payload.step,
      total: payload.total,
      ip,
      startedAt: Date.now(),
      duration: payload.duration,
      scriptId: payload.scriptId,
      powNonce: powChallenge.nonce,
      powDifficulty: powChallenge.difficulty,
      exp: Date.now() + 45 * 60 * 1000,
    };

    const activeStepToken = createSignedToken(activePayload);

    return {
      success: true,
      activeStepToken,
      targetUrl: payload.targetUrl,
      duration: payload.duration,
      stepIndex: payload.step,
      powChallenge,
    };
  },

  verifyStep(
    activeStepToken: string,
    ip: string,
    powSolution: string,
    powNonce?: string
  ): {
    success: boolean;
    allCompleted?: boolean;
    nextStep?: number;
    nextStepToken?: string;
    nextPowChallenge?: { nonce: string; difficulty: number };
    claimToken?: string;
    error?: string;
    bypassDetected?: boolean;
    remainingSeconds?: number;
    sid?: string;
    step?: number;
  } {
    const res = verifySignedToken<ActiveStepTokenPayload>(activeStepToken);
    if (!res.valid || !res.payload) {
      return {
        success: false,
        bypassDetected: false,
        error: "Active step session expired. Please click 'Visit Task' or reopen the link.",
      };
    }

    const payload = res.payload;
    if (payload.t !== "active") {
      return { success: false, bypassDetected: true, error: "Invalid step token type." };
    }

    if (!isIpMatching(payload.ip, ip)) {
      return {
        success: false,
        bypassDetected: false,
        error: "Network mismatch: Your network IP changed during verification. Please reopen the task.",
      };
    }

    // Strict Server-Side Dwell Time Enforcement
    const elapsedSec = (Date.now() - payload.startedAt) / 1000;
    const requiredSec = payload.duration;

    // Allow 1.0 second tolerance for network latency
    if (elapsedSec < requiredSec - 1.0) {
      const remaining = Math.ceil(requiredSec - elapsedSec);
      return {
        success: false,
        bypassDetected: false,
        remainingSeconds: remaining,
        error: `Please wait ${remaining} more seconds on the destination task page.`,
      };
    }

    // Proof-of-Work Challenge Verification
    const nonceToVerify = payload.powNonce || powNonce || "";
    const difficultyToVerify = payload.powDifficulty || POW_DIFFICULTY;
    if (nonceToVerify) {
      if (!powSolution || !powSolution.trim()) {
        return {
          success: false,
          bypassDetected: false,
          error: "Verification challenge was interrupted. Please retry or click 'Visit Task'.",
        };
      }
      const powValid = verifyPoWSolution(nonceToVerify, powSolution, difficultyToVerify);
      if (!powValid) {
        return {
          success: false,
          bypassDetected: true,
          error: "Anti-bot challenge failed. Automated scripts and bypassers are prohibited.",
        };
      }
    }

    const isLastStep = payload.step >= payload.total - 1;

    if (isLastStep) {
      // All checkpoints completed legitimately! Issue cryptographically signed claim token
      const claimPayload: ClaimTokenPayload = {
        t: "claim",
        sid: payload.sid,
        scriptId: payload.scriptId,
        ip,
        completedAt: Date.now(),
        exp: Date.now() + 15 * 60 * 1000, // 15 minutes to claim
      };
      const claimToken = createSignedToken(claimPayload);

      return {
        success: true,
        allCompleted: true,
        claimToken,
        sid: payload.sid,
        step: payload.step,
      };
    } else {
      const nextStepIndex = payload.step + 1;
      const nextPow = generatePoWChallenge();

      return {
        success: true,
        allCompleted: false,
        nextStep: nextStepIndex,
        nextPowChallenge: nextPow,
        sid: payload.sid,
        step: payload.step,
      };
    }
  },

  /**
   * Verifies completion of a checkpoint step via an authenticated Work.ink token.
   * If valid, advances the step or issues the final claimToken.
   */
  completeWorkinkStep(
    sessionId: string,
    stepIndex: number,
    totalSteps: number,
    scriptId: string,
    ip: string
  ): {
    success: boolean;
    allCompleted: boolean;
    nextStep?: number;
    nextPowChallenge?: { nonce: string; difficulty: number };
    claimToken?: string;
  } {
    const isLastStep = stepIndex >= totalSteps - 1;

    if (isLastStep) {
      const claimPayload: ClaimTokenPayload = {
        t: "claim",
        sid: sessionId,
        scriptId,
        ip,
        completedAt: Date.now(),
        exp: Date.now() + 15 * 60 * 1000,
      };
      const claimToken = createSignedToken(claimPayload);
      return {
        success: true,
        allCompleted: true,
        claimToken,
      };
    } else {
      const nextStepIndex = stepIndex + 1;
      const nextPow = generatePoWChallenge();
      return {
        success: true,
        allCompleted: false,
        nextStep: nextStepIndex,
        nextPowChallenge: nextPow,
      };
    }
  },

  verifyAndConsumeClaimToken(
    sessionId: string,
    claimToken: string,
    ip: string,
    scriptId: string
  ): { valid: boolean; error?: string; tokenId?: string } {
    const res = verifySignedToken<ClaimTokenPayload>(claimToken);
    if (!res.valid || !res.payload) {
      return { valid: false, error: res.error || "Invalid or expired checkpoint authorization token." };
    }

    const payload = res.payload;
    if (payload.t !== "claim") {
      return { valid: false, error: "Invalid token type." };
    }

    if (!isIpMatching(payload.ip, ip)) {
      return { valid: false, error: "Claim IP address does not match verified checkpoint IP." };
    }

    // The token is bound to the script whose checkpoints were completed; it must not be
    // redeemable for a key on a different script.
    if (
      payload.scriptId &&
      payload.scriptId !== "all" &&
      scriptId &&
      scriptId !== "all" &&
      payload.scriptId !== scriptId
    ) {
      return { valid: false, error: "Claim token was issued for a different script." };
    }

    // Replay attack check (per-instance fast path; the claim route also consumes the token in
    // the database via dbService.consumeClaimToken so replay protection holds across instances)
    if (consumedClaimTokens.has(claimToken)) {
      return { valid: false, error: "This claim authorization token has already been consumed." };
    }

    // Prevent token reuse
    consumedClaimTokens.add(claimToken);
    if (consumedClaimTokens.size > 5000) {
      const first = consumedClaimTokens.values().next().value;
      if (first) consumedClaimTokens.delete(first);
    }

    return { valid: true, tokenId: claimToken.split(".")[1] };
  },
};

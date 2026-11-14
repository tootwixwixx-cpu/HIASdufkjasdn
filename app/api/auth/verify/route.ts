import { NextRequest, NextResponse } from "next/server";
import { publicError } from "@/lib/http-errors";
import { dbService, isStaffReviewKey, HWID_RE, HWID_RESET_COOLDOWN_HOURS, normalizeHwid, type ScriptRecord } from "@/lib/store";
import { bundleModularScript } from "@/lib/module-bundler";
import { obfuscateLuauVM, bundleModules } from "@/lib/obfuscator";
import { wrapPolymorphicLuau } from "@/lib/polymorphic";
import { syncScriptFromGitHub } from "@/lib/github-sync";
import { sendExecutionWebhook } from "@/lib/discord-webhook";
import { getClientIp, normalizeIp, getClientGeo } from "@/lib/ip";
import { encryptSessionPayload } from "@/lib/crypto-util";
import { adminAlert } from "@/lib/alerts";

function isMaliciousScraper(userAgent: string): boolean {
  const lower = userAgent.toLowerCase();
  return (
    lower.includes("python-requests") ||
    lower.includes("aiohttp") ||
    lower.includes("scrapy") ||
    lower.includes("wget") ||
    lower.includes("go-http-client") ||
    lower.includes("postmanruntime") ||
    lower.includes("insomnia") ||
    lower.includes("urllib") ||
    lower.includes("node-fetch") ||
    lower.includes("axios")
  );
}

// SECURITY: a User-Agent substring match alone is a weak, trivially-spoofable signal —
// a real scraper just sets a browser-like UA, while a legitimate tool whose HTTP client
// happens to default to one of these strings (e.g. an `axios`-based launcher) would
// otherwise be permanently IP-banned on a single request. Require a few hits within a
// short window before actually banning; a single hit is just rejected.
const scraperUaHitMap = new Map<string, { count: number; resetAt: number }>();
const SCRAPER_UA_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const SCRAPER_UA_BAN_THRESHOLD = 3;

function recordScraperUaHitAndShouldBan(ip: string): boolean {
  const now = Date.now();
  if (scraperUaHitMap.size > 5000) {
    scraperUaHitMap.forEach((v, k) => {
      if (now > v.resetAt) scraperUaHitMap.delete(k);
    });
  }
  const rec = scraperUaHitMap.get(ip);
  if (!rec || now > rec.resetAt) {
    scraperUaHitMap.set(ip, { count: 1, resetAt: now + SCRAPER_UA_WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count >= SCRAPER_UA_BAN_THRESHOLD;
}

/**
 * Validates Roblox user ID and username against Roblox's official public Users API.
 * Detects forged or spoofed user accounts, ID-username mismatches, and synthetic IDs.
 */
async function verifyRobloxIdentity(
  userId: unknown,
  username: unknown
): Promise<{ valid: boolean; reason?: string }> {
  const userIdStr = typeof userId === "string" ? userId.trim() : typeof userId === "number" ? String(userId) : "";
  const usernameStr = typeof username === "string" ? username.trim() : "";

  // 1. Format validation: Roblox User ID must be positive digits only
  if (!/^\d{1,12}$/.test(userIdStr) || Number(userIdStr) <= 0) {
    return { valid: false, reason: `Invalid non-numeric or malformed Roblox UserId '${userIdStr}'` };
  }

  // 2. Format validation: Roblox username format (3-20 chars, alphanumeric + underscore)
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(usernameStr)) {
    return { valid: false, reason: `Invalid Roblox username format '${usernameStr}'` };
  }

  // 3. Official Roblox public users API validation with 2500ms timeout
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://users.roblox.com/v1/users/${userIdStr}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Roblox/WinInet",
        "Accept": "application/json",
      },
      cache: "force-cache",
      next: { revalidate: 3600 },
    });
    clearTimeout(timer);

    if (res.status === 404) {
      return { valid: false, reason: `Roblox user ID ${userIdStr} does not exist on Roblox` };
    }
    if (res.ok) {
      const data = await res.json();
      const realName = (data.name || "").trim();
      if (!realName || realName.toLowerCase() !== usernameStr.toLowerCase()) {
        return {
          valid: false,
          reason: `Roblox User ID ${userIdStr} officially belongs to '${realName}', but request supplied username '${usernameStr}'`,
        };
      }
    }
  } catch (err: unknown) {
    // Fail-safe: if Roblox API has network timeout, allow format-checked request through so Roblox CDN hiccups don't kick users
    console.warn("Roblox public Users API verification skipped due to network timeout/error:", err);
  }

  return { valid: true };
}

async function lookupIsp(ip: string): Promise<string> {
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return "Localhost / Private Network";
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=isp,org`, {
      signal: controller.signal,
      cache: "force-cache",
      next: { revalidate: 3600 },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      return data.isp || data.org || "Generic ISP";
    }
  } catch {
    // ignore
  }
  return "Generic ISP";
}

// Failed-key probe thresholds (counted in Postgres via dbService.rateLimit)
const MAX_FAILED_KEY_PROBES = 8;
const FAILED_KEY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(req: NextRequest) {
  let clientIp = "127.0.0.1";
  let targetScriptName = "Unknown Script";
  let targetScriptId = "";
  let keyLast4 = "NONE";
  let robloxUser = "Unknown";
  let robloxId = "N/A";
  let detectedExecutor = "Unknown";
  let detectedOs = "Unknown";
  let webhookUrl = "";
  let webhookEnabled = false;

  try {
    clientIp = getClientIp(req);
    const clientGeo = getClientGeo(req);
    const userAgent = req.headers.get("user-agent") || "";
    const body = await req.json();

    // 0. Automated Scraper / Bot Tool Blocker
    if (isMaliciousScraper(userAgent)) {
      if (recordScraperUaHitAndShouldBan(clientIp)) {
        await dbService.banIp(
          clientIp,
          `Repeated automated-tool User-Agent hits on Verify API (${SCRAPER_UA_BAN_THRESHOLD}+ within 10min, latest: ${userAgent})`
        );
      }
      return NextResponse.json(
        { error: "Access Denied: Automated tools, scrapers, and external HTTP clients are strictly forbidden." },
        { status: 403 }
      );
    }

    const {
      key,
      script_slug,
      hwid,
      roblox_username,
      roblox_user_id,
      executor,
      os,
      place_id,
      place_name,
      job_id,
      timestamp,
      client_nonce,
      tamper_flags,
      loader_token,
    } = body;

    // 1. Replay & Timestamp Verification Guard
    if (timestamp === undefined || timestamp === null) {
      return NextResponse.json(
        { error: "Verification timestamp required." },
        { status: 400 }
      );
    }
    const clientTime = Number(timestamp);
    const serverTime = Math.floor(Date.now() / 1000);
    if (isNaN(clientTime) || Math.abs(serverTime - clientTime) > 90) {
      return NextResponse.json(
        { error: "Verification timestamp expired or out of sync (±90s tolerance)." },
        { status: 403 }
      );
    }

    if (!client_nonce || typeof client_nonce !== "string" || client_nonce.trim() === "") {
      return NextResponse.json(
        { error: "Verification client nonce required." },
        { status: 400 }
      );
    }
    if (client_nonce.length > 128) {
      return NextResponse.json({ error: "Verification client nonce invalid." }, { status: 400 });
    }
    // Postgres-backed so a replay can't be routed to a different serverless instance
    // (the old per-process Map was empty on every cold start / other instance).
    if (!(await dbService.consumeNonce("verify:" + client_nonce, 300))) {
      return NextResponse.json(
        { error: "Security Alert: Verification nonce replay detected." },
        { status: 403 }
      );
    }

    robloxUser = roblox_username || "Unknown";
    robloxId = roblox_user_id || "N/A";
    detectedExecutor = executor || "Unknown Executor";
    detectedOs = os || "Desktop (Windows)";

    if (key && typeof key === "string") {
      keyLast4 = key.trim().slice(-4).toUpperCase();
    }

    // Resolve script and loader config early for webhook and logging
    let script: ScriptRecord | null = null;
    if (script_slug) {
      script = await dbService.getScriptBySlug(script_slug);
    }
    if (script) {
      targetScriptName = script.name;
      targetScriptId = script.id;

      // Auto-Pull check if enabled
      if (script.github_auto_pull && script.github_repo) {
        const lastPull = script.github_last_pulled_at ? new Date(script.github_last_pulled_at).getTime() : 0;
        if (Date.now() - lastPull > 60 * 1000) {
          syncScriptFromGitHub(script.id).catch(() => {});
        }
      }
    }

    // NOTE: Gateway token (gpt_) is single-use and consumed by the probe gate when it
    // delivered the loader payload. Re-verifying it here would always fail on any retry
    // (autoload, double-click, re-verify after a fail). The probe gate already ran all
    // environment checks. This endpoint enforces its own integrity via tamper_flags +
    // client_nonce replay detection above.

    const resolveWebhook = async (sc?: ScriptRecord | null) => {
      if (sc?.loader_config_id) {
        const loaderConfig = await dbService.getLoaderConfigById(sc.loader_config_id);
        if (loaderConfig?.webhook_enabled && loaderConfig.webhook_url?.trim()) {
          return { enabled: true, url: loaderConfig.webhook_url.trim() };
        }
      }
      // Fallback: check all loader configs in database for an active webhook
      try {
        const allConfigs = await dbService.getLoaderConfigs();
        const activeConfig = allConfigs.find((c) => c.webhook_enabled && c.webhook_url?.trim()?.startsWith("http"));
        if (activeConfig && activeConfig.webhook_url) {
          return { enabled: true, url: activeConfig.webhook_url.trim() };
        }
      } catch (err) {
        console.error("Error looking up fallback loader webhook:", err);
      }
      return { enabled: false, url: "" };
    };

    // FIX: Resolve ISP and webhook in parallel — no serial waiting
    const [ispResult, initialWh] = await Promise.all([
      lookupIsp(clientIp),
      resolveWebhook(script),
    ]);
    const isp = ispResult;
    webhookEnabled = initialWh.enabled;
    webhookUrl = initialWh.url;
    // Mark webhook as already resolved so logAndNotifyFailure skips redundant DB calls
    let webhookResolved = true;

    const logAndNotifyFailure = async (reason: string) => {
      await dbService.recordExecution({
        script_id: targetScriptId,
        script_name: targetScriptName,
        roblox_username: robloxUser,
        roblox_user_id: robloxId,
        ip_address: clientIp,
        country: clientGeo.country,
        city: clientGeo.city,
        latitude: clientGeo.latitude,
        longitude: clientGeo.longitude,
        isp,
        os: detectedOs,
        executor: detectedExecutor,
        key_last4: keyLast4,
        status: "failed",
        failure_reason: reason,
      });

      // FIX: Use cached webhook result — avoid redundant DB call on every failure
      if (!webhookResolved || (!webhookEnabled || !webhookUrl)) {
        const wh = await resolveWebhook(script);
        webhookEnabled = wh.enabled;
        webhookUrl = wh.url;
        webhookResolved = true;
      }

      if (webhookEnabled && webhookUrl) {
        await sendExecutionWebhook({
          webhookUrl,
          scriptName: targetScriptName,
          robloxUsername: robloxUser,
          robloxUserId: robloxId,
          ipAddress: clientIp,
          isp,
          os: detectedOs,
          executor: detectedExecutor,
          keyLast4,
          success: false,
          failureReason: reason,
        });
      }
    };

    // 1. Parameter Tampering & Privilege Escalation Detection:
    // 1. Parameter Tampering & Privilege Escalation Detection:
    // Clients must NEVER submit duration, expiration, or privilege fields directly
    if (
      body.duration !== undefined ||
      body.duration_hours !== undefined ||
      body.expires_at !== undefined ||
      body.is_staff !== undefined ||
      body.is_admin !== undefined ||
      body.is_staff_review !== undefined ||
      body.lifetime !== undefined ||
      body.status !== undefined
    ) {
      await dbService.banIp(
        clientIp,
        "Privilege Escalation / Parameter Tampering: Client attempted to forge duration or privilege fields"
      );
      await logAndNotifyFailure("Security Integrity Violation: Tampering detected");
      return NextResponse.json(
        {
          error:
            "[AERO AUTH] Security Integrity Violation: Parameter tampering detected. Your IP has been permanently banned.",
        },
        { status: 403 }
      );
    }

    if (!key || typeof key !== "string" || key.trim() === "") {
      // Missing key check
      return NextResponse.json({ error: "License key is required." }, { status: 400 });
    }

    const keyStr = key.trim();

    // Check for malformed length or invalid characters
    if (keyStr.length < 6 || keyStr.length > 64 || !/^[A-Za-z0-9_-]+$/.test(keyStr)) {
      // Reject malformed key format immediately without cluttering analytics logs
      return NextResponse.json({ error: "Invalid key format." }, { status: 400 });
    }

    // 2 & 3. FIX: Parallel — check IP ban + fetch key + start Roblox identity check simultaneously
    // Identity check fires speculatively; result is consumed only if key is valid and user is not staff.
    const identityCheckPromise = verifyRobloxIdentity(roblox_user_id, roblox_username);

    const [isBanned, fetchedKey] = await Promise.all([
      dbService.isIpBanned(clientIp),
      dbService.getKeyByString(keyStr),
    ]);

    if (isBanned) {
      await logAndNotifyFailure("IP Banned: Client IP is blacklisted.");
      return NextResponse.json(
        { error: "Access Denied: Your IP address is banned from this service." },
        { status: 403 }
      );
    }
    if (!fetchedKey) {
      // Sliding-window limit on failed key attempts to block brute-force / key guessing.
      // Postgres-backed (see dbService.rateLimit) so attempts spread across serverless instances
      // still add up. Same thresholds as before: soft 429 after 5 failures, ban at 8.
      // rateLimit() returns false once the count EXCEEDS the limit, so limit N blocks the (N+1)th call:
      // ban on the 8th failure, soft-block from the 5th — identical to the original thresholds.
      const underBanLimit = await dbService.rateLimit("bad-key-ban", clientIp, MAX_FAILED_KEY_PROBES - 1, FAILED_KEY_WINDOW_MS / 1000);
      const underSoftLimit = await dbService.rateLimit("bad-key-soft", clientIp, 4, FAILED_KEY_WINDOW_MS / 1000);

      if (!underBanLimit) {
        void adminAlert(
          "ip_banned_bruteforce",
          "IP banned for license-key brute forcing",
          { IP: clientIp, Script: targetScriptName, Executor: detectedExecutor },
          { dedupKey: clientIp, windowSec: 3600 }
        );
        await dbService.banIp(
          clientIp,
          `Brute-Force Key Guessing Attack (${MAX_FAILED_KEY_PROBES}+ invalid key probes in 5 minutes)`
        );
        await logAndNotifyFailure("Brute-Force Key Guessing Attack");
        return NextResponse.json(
          {
            error:
              "[AERO AUTH] Security Alert: Multiple invalid key attempts detected. Your IP address has been permanently blacklisted.",
          },
          { status: 403 }
        );
      }
      if (!underSoftLimit) {
        return NextResponse.json(
          { error: "Too many failed key attempts. Please wait 5 minutes before trying again." },
          { status: 429, headers: { "Retry-After": "300" } }
        );
      }

      await logAndNotifyFailure("Invalid Key: License key does not exist.");
      return NextResponse.json(
        { error: "Invalid Key: License key does not exist." },
        { status: 401 }
      );
    }

    const keyRecord = fetchedKey;

    const isStaff = isStaffReviewKey(keyRecord);

    if (keyRecord.status === "banned") {
      if (!isStaff) await logAndNotifyFailure("Revoked Key: License key was banned.");
      return NextResponse.json(
        { error: "Key Revoked: This license has been permanently banned." },
        { status: 403 }
      );
    }

    // 4. Critical Client Tamper Check:
    // If request originates from key's bound IP, enforce dual-IP ban; otherwise ban offending clientIp only
    if (Array.isArray(tamper_flags) && tamper_flags.some((f: unknown) => typeof f === "string" && f.startsWith("CRITICAL"))) {
      const isOwner = Boolean(keyRecord.claimed_ip && normalizeIp(keyRecord.claimed_ip) === normalizeIp(clientIp));
      if (isOwner && !isStaff) {
        await dbService.autoBanOffender(
          clientIp,
          keyRecord,
          `Critical Client Tampering Detected (Verify): ${tamper_flags.join("; ")}`,
          { banLinkedClaimedIp: true }
        );
      } else {
        await dbService.banIp(
          clientIp,
          `Critical Client Tampering Detected (Verify from unauthorized IP): ${tamper_flags.join("; ")}`
        );
      }
      await logAndNotifyFailure("Security Integrity Violation: Tampering detected");
      return NextResponse.json(
        {
          error:
            "[AERO AUTH] Security Integrity Violation: Client environment modified or hooked. Access Denied.",
        },
        { status: 403 }
      );
    }

    // 5. Anti-Spoofing & Identity Integrity Checks (Enforced on all regular keys)
    if (!isStaff) {
      // Await the already-in-flight Roblox identity check (started in parallel with key/ban lookup)
      const identityCheck = await identityCheckPromise;
      if (!identityCheck.valid) {
        await logAndNotifyFailure("Identity Spoofing Blocked");
        return NextResponse.json(
          {
            error: `[AERO AUTH] Verification Error: ${identityCheck.reason}. Please make sure you are executing from your own Roblox account.`,
          },
          { status: 403 }
        );
      }

      // Validate Executor identifier sanity
      if (!executor || typeof executor !== "string" || executor.trim() === "" || executor.length > 80) {
        await logAndNotifyFailure("Security Alert: Missing or forged executor identifier.");
        return NextResponse.json(
          { error: "[AERO AUTH] Security Alert: Invalid executor environment." },
          { status: 403 }
        );
      }
    }

    if (!isStaff && keyRecord.status === "unclaimed") {
      // Paid lifetime keys are given directly to buyers and do not require claiming via the website
      if (keyRecord.duration_hours === null || keyRecord.duration_hours === undefined) {
        const nowIso = new Date().toISOString();
        keyRecord.status = "active";
        keyRecord.claimed_ip = clientIp;
        keyRecord.claimed_at = nowIso;
        keyRecord.activated_at = nowIso;
        await dbService.activateKey(keyRecord.id, clientIp);
      } else {
        await logAndNotifyFailure("Unclaimed Key: Key not claimed from website.");
        return NextResponse.json(
          { error: "Unclaimed Key: Please claim this key from the website first." },
          { status: 403 }
        );
      }
    }

    // Auto-bind IP for lifetime key if claimed_ip is not bound yet
    if (!isStaff && (keyRecord.duration_hours === null || keyRecord.duration_hours === undefined) && !keyRecord.claimed_ip) {
      keyRecord.claimed_ip = clientIp;
      keyRecord.claimed_at = new Date().toISOString();
      keyRecord.status = "active";
      await dbService.activateKey(keyRecord.id, clientIp);
    }

    // 5. Check Expiration (Skipped for staff review keys - completely lifetime)
    if (!isStaff && keyRecord.expires_at) {
      const now = new Date();
      const expires = new Date(keyRecord.expires_at);
      if (now > expires) {
        await logAndNotifyFailure("Expired Key: License expired.");
        // Immediately purge the expired key from the pool
        await dbService.deleteKey(keyRecord.id);
        return NextResponse.json(
          { error: "Expired Key: Your license key has expired and has been removed." },
          { status: 403 }
        );
      }
    }

    // 6. Device lock. HWID (device + Roblox account fingerprint from the loader) is the lock; the IP
    //    is recorded as a second signal and alerts on likely key sharing, but a new IP is allowed
    //    (mobile data / dynamic IPs). Staff review keys are unbound by design.
    let hwidMode: "hwid" | "legacy-ip" = "hwid";
    if (!isStaff) {
      const hwidStr = normalizeHwid(hwid);
      if (!HWID_RE.test(hwidStr)) {
        await logAndNotifyFailure("Missing or malformed device fingerprint (HWID)");
        return NextResponse.json(
          { error: "[AERO AUTH] Could not identify your device. Please re-execute the loader." },
          { status: 400 }
        );
      }
      const binding = await dbService.bindKeyHwid(keyRecord.id, hwidStr);
      if (binding === "mismatch") {
        await logAndNotifyFailure("HWID Mismatch (key locked to another device/account)");
        return NextResponse.json(
          {
            error:
              "Device Mismatch! This key is locked to another device or Roblox account. " +
              `You can move it to this device on the claim page (once every ${HWID_RESET_COOLDOWN_HOURS} hours).`,
          },
          { status: 403 }
        );
      }
      if (binding === "unsupported") {
        hwidMode = "legacy-ip"; // migration 002 not applied yet: keep the old IP lock below
      } else {
        const ipStats = await dbService.recordKeyIp(keyRecord.id, normalizeIp(clientIp), clientGeo.country);
        if (ipStats && (ipStats.ips_24h >= 3 || ipStats.countries_24h >= 2)) {
          void adminAlert(
            "key_sharing",
            "Possible key sharing",
            {
              Key: `****-${keyLast4}`,
              "IPs (24h)": ipStats.ips_24h,
              "Countries (24h)": ipStats.countries_24h,
              Latest: `${clientIp} ${clientGeo.country || ""}`.trim(),
              Player: `${robloxUser} (${robloxId})`,
            },
            { dedupKey: keyRecord.id, windowSec: 6 * 3600 }
          );
        }
      }
    }

    // Legacy IP lock — only used until migration 002 (HWID binding) is applied.
    if (!isStaff && hwidMode === "legacy-ip") {
      const normalizedClaimed = normalizeIp(keyRecord.claimed_ip);
      const normalizedClient = normalizeIp(clientIp);

      if (normalizedClaimed && normalizedClaimed !== normalizedClient) {
        const isLifetime = keyRecord.duration_hours === null || keyRecord.duration_hours === undefined;
        const reason = "IP Mismatch (Bound to different device)";
        await logAndNotifyFailure(reason);
        return NextResponse.json(
          {
            error: isLifetime
              ? `IP Mismatch! This paid lifetime key is locked to IP ${normalizedClaimed.slice(0, 7)}... but your IP is ${normalizedClient}.`
              : `IP Mismatch! This key was claimed by IP ${normalizedClaimed.slice(0, 7)}... but your IP is ${normalizedClient}. Re-claim your key on your network.`,
          },
          { status: 403 }
        );
      }
    }

    // 7. Fetch Script if not already resolved
    if (!script) {
      if (keyRecord.script_id && keyRecord.script_id !== "all") {
        const allScripts = await dbService.getScriptsLite();
        const meta = allScripts.find((s) => s.id === keyRecord.script_id) || null;
        // Full record (modules etc.) is needed below; fetch it by indexed slug (cached).
        script = meta ? (await dbService.getScriptBySlug(meta.slug)) || meta : null;
      }
      if (script) {
        targetScriptName = script.name;
        targetScriptId = script.id;
        if (!webhookEnabled || !webhookUrl) {
          const wh = await resolveWebhook(script);
          webhookEnabled = wh.enabled;
          webhookUrl = wh.url;
        }
      }
    }

    if (!script) {
      if (!isStaff) await logAndNotifyFailure("Script Not Found: Missing target script.");
      return NextResponse.json({ error: "Script payload not found." }, { status: 404 });
    }

    // 7b. Script-Specific Key Isolation: Ensure key claimed for Script A cannot be used on Script B (unless assigned to "all")
    if (keyRecord.script_id && keyRecord.script_id !== "all" && script.id && keyRecord.script_id !== script.id) {
      const allScripts = await dbService.getScriptsLite();
      const claimedForScript = allScripts.find((s) => s.id === keyRecord.script_id);
      const claimedForName = claimedForScript ? claimedForScript.name : "another script";
      const reason = "Script Mismatch (Key claimed for different script)";
      if (!isStaff) await logAndNotifyFailure(reason);
      return NextResponse.json(
        {
          error: `Script Mismatch! This key was claimed specifically for "${claimedForName}" and cannot be used for "${script.name}".`,
        },
        { status: 403 }
      );
    }

    // 7c. Maintenance Mode Kill-Switch: Block access unless using staff review key
    if (script.is_maintenance && !isStaff) {
      const mMsg = script.maintenance_message || "This script is currently under scheduled maintenance. Please check our Discord for updates.";
      await logAndNotifyFailure("Maintenance Mode: Script under maintenance");
      return NextResponse.json({ error: mMsg }, { status: 403 });
    }

    const protocol = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    // 8. STAFF REVIEW KEY FAST-PATH:
    // Completely lifetime, zero user PII, anonymous staff review session tracking
    if (isStaff) {
      const staffReview = await dbService.createStaffReview({
        key_id: keyRecord.id,
        script_id: script.id,
        script_name: script.name,
        key_label: keyRecord.notes || "Staff Review Key",
      });

      let rawPayload: string = (await dbService.getProtectedPayload(script.slug)) || "";
      if (!rawPayload) {
        const bundled = bundleModularScript({
          entryFile: script.entry_file || "init.lua",
          files: script.modules || {},
          dynamicStreaming: true,
          slug: script.slug,
          sessionToken: staffReview.id,
          baseUrl,
          key: (key || keyRecord.key_string || "").trim(),
          obfuscate: false,
        });
        const obfRes = await obfuscateLuauVM(bundled, { preset: "balanced" });
        // SECURITY: obfuscateLuauVM never throws -- it returns {ok:false} on any failure
        // (e.g. the bundled luau-compile.exe binary not being runnable on a non-Windows
        // host like a Linux/Vercel deployment). This used to fall back to `bundled`, the
        // RAW UNOBFUSCATED source, which would then be delivered as-is to the client --
        // completely defeating the obfuscator. Fall back to the lightweight polymorphic
        // wrapper instead (same safety net probe/route.ts already uses), which at least
        // isn't plaintext, and log loudly so a broken compiler is visible, not silent.
        if (obfRes.ok) {
          rawPayload = obfRes.output;
        } else {
          console.error(`[verify] VM obfuscation failed for "${script.slug}", falling back to polymorphic wrap: ${obfRes.error}`);
          rawPayload = wrapPolymorphicLuau(bundled);
        }
        dbService.saveProtectedPayload(script.slug, rawPayload, obfRes.stats).catch(console.error);
      }

      const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const secretKey = `${staffReview.id}_${(key || "").trim()}_${nonce}`;
      const { encryptedHex, signature } = encryptSessionPayload(rawPayload, secretKey, nonce);

      return NextResponse.json({
        success: true,
        session_token: staffReview.id,
        is_staff_review: true,
        is_admin_key: true,
        expires_at: null,
        duration_hours: null,
        encrypted_payload: encryptedHex,
        payload_signature: signature,
        nonce,
      });
    }

    // 9. Normal User Key Flow:
    // Activate key and start its expiration countdown upon first execution
    const activatedKey = await dbService.activateKey(keyRecord.id, clientIp);
    const activeKey = activatedKey || keyRecord;

    // Upgrade loader session → active, or create a new session if no loader_token
    let session;
    const existingLoaderSession = loader_token ? await dbService.getSessionByToken(loader_token) : null;
    if (existingLoaderSession) {
      // Promote the loader session: update status → active and attach key/script info
      await dbService.updateHeartbeat(existingLoaderSession.id, clientIp, {
        roblox_username: robloxUser,
        roblox_user_id: robloxId,
        place_id: place_id ? String(place_id) : undefined,
        job_id: job_id || undefined,
      });
      await dbService.upgradeLoaderSession(existingLoaderSession.id, {
        key_id: keyRecord.id,
        script_id: script.id,
        status: "active",
        hwid: hwid || null,
        tamper_flags: [],
        country: clientGeo.country,
        city: clientGeo.city,
        latitude: clientGeo.latitude,
        longitude: clientGeo.longitude,
      });
      session = { ...existingLoaderSession, id: existingLoaderSession.id };
    } else {
      // No loader session — create a fresh one (backwards compat)
      session = await dbService.createSession({
      key_id: keyRecord.id,
      script_id: script.id,
      ip_address: clientIp,
      hwid: hwid || null,
      roblox_username: robloxUser,
      roblox_user_id: robloxId,
      country: clientGeo.country,
      city: clientGeo.city,
      latitude: clientGeo.latitude,
      longitude: clientGeo.longitude,
      status: "active",
      tamper_flags: [],
    });
    }

    // Record Successful Execution & Dispatch Webhook
    await dbService.recordExecution({
      script_id: script.id,
      script_name: script.name,
      roblox_username: robloxUser,
      roblox_user_id: robloxId,
      ip_address: clientIp,
      country: clientGeo.country,
      city: clientGeo.city,
      latitude: clientGeo.latitude,
      longitude: clientGeo.longitude,
      isp,
      os: detectedOs,
      executor: detectedExecutor,
      place_id: place_id ? String(place_id) : null,
      place_name: place_name || null,
      job_id: job_id || null,
      key_last4: keyLast4,
      status: "success",
      failure_reason: null,
    });

    // First successful run from a country not seen in the last 30 days (deduped per country).
    if (clientGeo.country) {
      void adminAlert(
        "new_country",
        `New country: first player from ${clientGeo.country} in 30 days`,
        { Country: clientGeo.country, City: clientGeo.city, Script: targetScriptName },
        { dedupKey: clientGeo.country, windowSec: 30 * 86400 }
      );
    }

    // FIX: webhookResolved flag ensures we skip redundant DB call here — already fetched at request start
    if (!webhookResolved || (!webhookEnabled && !webhookUrl)) {
      const finalWh = await resolveWebhook(script);
      webhookEnabled = finalWh.enabled;
      webhookUrl = finalWh.url;
    }

    if (webhookEnabled && webhookUrl) {
      sendExecutionWebhook({
        webhookUrl,
        scriptName: script.name,
        robloxUsername: robloxUser,
        robloxUserId: robloxId,
        ipAddress: clientIp,
        isp,
        os: detectedOs,
        executor: detectedExecutor,
        keyLast4,
        success: true,
      }).catch((e) => console.error("Webhook dispatch error:", e));
    }

    // Instant delivery of pre-obfuscated AtomProtect VM payload
    let rawPayload: string = (await dbService.getProtectedPayload(script.slug)) || "";
    if (!rawPayload) {
      const bundled = bundleModularScript({
        entryFile: script.entry_file || "init.lua",
        files: script.modules || {},
        dynamicStreaming: true,
        slug: script.slug,
        sessionToken: session.id,
        baseUrl,
        key: (key || keyRecord.key_string || "").trim(),
        obfuscate: false,
      });
      const obfRes = await obfuscateLuauVM(bundled, { preset: "balanced" });
      // SECURITY: see matching comment above -- never fall back to raw/unobfuscated
      // source on an obfuscation failure.
      if (obfRes.ok) {
        rawPayload = obfRes.output;
      } else {
        console.error(`[verify] VM obfuscation failed for "${script.slug}", falling back to polymorphic wrap: ${obfRes.error}`);
        rawPayload = wrapPolymorphicLuau(bundled);
      }
      dbService.saveProtectedPayload(script.slug, rawPayload, obfRes.stats).catch(console.error);
    }

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const secretKey = `${session.id}_${(key || "").trim()}_${nonce}`;
    const { encryptedHex, signature } = encryptSessionPayload(rawPayload, secretKey, nonce);
    let remainingSeconds: number | null = null;
    const isLifetime = !isStaff && (activeKey.duration_hours === null || activeKey.duration_hours === undefined);

    if (activeKey.expires_at) {
      const diffMs = new Date(activeKey.expires_at).getTime() - Date.now();
      remainingSeconds = Math.max(0, Math.floor(diffMs / 1000));
    } else if (activeKey.duration_hours && activeKey.duration_hours > 0) {
      remainingSeconds = activeKey.duration_hours * 3600;
    }

    return NextResponse.json({
      success: true,
      session_token: session.id,
      expires_at: activeKey.expires_at,
      duration_hours: activeKey.duration_hours,
      remaining_seconds: remainingSeconds,
      is_lifetime: isLifetime,
      encrypted_payload: encryptedHex,
      payload_signature: signature,
      nonce,
    });
  } catch (err: unknown) {
    const message = publicError(err, "Internal verification error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

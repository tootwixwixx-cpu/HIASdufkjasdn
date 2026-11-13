// lib/ip.ts
import { NextRequest } from "next/server";

export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const clean = ip.trim();
  // IPv4 regex (0.0.0.0 to 255.255.255.255)
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(clean)) return true;
  // IPv6 regex
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  return ipv6Regex.test(clean);
}

export function normalizeIp(ip: string | null | undefined): string {
  if (!ip) return "127.0.0.1";
  let clean = ip.trim();
  // Strip port if present (e.g. 192.168.1.1:5024)
  if (clean.includes(":") && clean.includes(".") && !clean.startsWith("[")) {
    clean = clean.split(":")[0];
  }
  // Convert ::ffff:1.2.3.4 -> 1.2.3.4
  if (clean.startsWith("::ffff:")) {
    clean = clean.replace("::ffff:", "");
  }
  if (clean === "::1" || clean === "localhost") {
    return "127.0.0.1";
  }
  return clean;
}

// SECURITY: x-forwarded-for / cf-connecting-ip / x-real-ip are plain request headers —
// if the app is reachable directly (no reverse proxy/CDN actually stripping and
// re-setting them), a client can set any value it likes and get a fresh, never-banned
// "IP identity" on every request, defeating IP bans, per-IP key binding, brute-force
// lockouts, and checkpoint anti-sharing in one move. They are now only trusted when
// explicitly enabled via TRUSTED_PROXY=true — set this ONLY when the app genuinely sits
// behind an infrastructure component (Nginx, Caddy, Cloudflare, etc.) that you've
// configured to overwrite/strip these headers from the client before they reach Node.
// `x-vercel-forwarded-for` is trusted automatically instead, because `VERCEL=1` is set
// by the Vercel platform itself in its own runtime and can't be influenced by a request.
const TRUST_PROXY_HEADERS = process.env.TRUSTED_PROXY === "true";
const ON_VERCEL = process.env.VERCEL === "1";

/**
 * Resolves client IP address securely, prioritizing trusted server connection
 * socket and edge proxy headers ahead of spoofable headers.
 */
export function getClientIp(req: NextRequest): string {
  // 1. Direct Socket Remote Address from runtime (cannot be spoofed by client headers)
  const socketIp = (req as unknown as { ip?: string }).ip;
  if (socketIp && typeof socketIp === "string") {
    const norm = normalizeIp(socketIp);
    if (isValidIp(norm)) return norm;
  }

  // 2. Vercel Edge Server Header (set by Vercel's own edge network, not the client)
  if (ON_VERCEL) {
    const vercelIp = req.headers.get("x-vercel-forwarded-for");
    if (vercelIp && vercelIp.trim()) {
      const firstIp = normalizeIp(vercelIp.split(",")[0].trim());
      if (isValidIp(firstIp)) return firstIp;
    }
  }

  // 3-5. Only trust these when TRUSTED_PROXY=true confirms something ahead of this
  // process actually controls/overwrites them before a client request reaches here.
  if (TRUST_PROXY_HEADERS) {
    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp && cfIp.trim()) {
      const normalized = normalizeIp(cfIp.trim());
      if (isValidIp(normalized)) return normalized;
    }

    const realIp = req.headers.get("x-real-ip");
    if (realIp && realIp.trim()) {
      const normalized = normalizeIp(realIp.trim());
      if (isValidIp(normalized)) return normalized;
    }

    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded && forwarded.trim()) {
      const firstIp = normalizeIp(forwarded.split(",")[0].trim());
      if (isValidIp(firstIp)) {
        return firstIp;
      }
    }
  }

  return "127.0.0.1";
}

export interface ClientGeoInfo {
  country?: string | null;
  city?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Extracts real geographic location data supplied by edge CDN infrastructure (Vercel Edge, Cloudflare)
 */
export function getClientGeo(req: NextRequest): ClientGeoInfo {
  const country =
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cf-ipcountry") ||
    null;

  const city =
    req.headers.get("x-vercel-ip-city") ||
    req.headers.get("cf-ipcity") ||
    null;

  const region =
    req.headers.get("x-vercel-ip-country-region") ||
    req.headers.get("cf-region") ||
    null;

  const latStr =
    req.headers.get("x-vercel-ip-latitude") ||
    req.headers.get("cf-iplatitude") ||
    null;

  const lngStr =
    req.headers.get("x-vercel-ip-longitude") ||
    req.headers.get("cf-iplongitude") ||
    null;

  const latitude = latStr ? parseFloat(latStr) : null;
  const longitude = lngStr ? parseFloat(lngStr) : null;

  return {
    country: country ? country.toUpperCase().trim() : null,
    city: city ? decodeURIComponent(city.trim()) : null,
    region: region ? region.trim() : null,
    latitude: !isNaN(Number(latitude)) && latitude !== null ? Number(latitude) : null,
    longitude: !isNaN(Number(longitude)) && longitude !== null ? Number(longitude) : null,
  };
}

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// SECURITY: this endpoint fetches a server-supplied URL and returns the bytes to the
// caller — without a host allowlist it's an open SSRF-capable proxy (can be used to
// probe/reach internal network addresses or any external host from the server's own
// IP). Only the hosts this feature actually needs are allowed.
const ALLOWED_AVATAR_HOSTS = new Set([
  "tr.rbxcdn.com",
  "images.rbxcdn.com",
  "t0.rbxcdn.com",
  "t1.rbxcdn.com",
  "t2.rbxcdn.com",
  "t3.rbxcdn.com",
  "t4.rbxcdn.com",
  "t5.rbxcdn.com",
  "t6.rbxcdn.com",
  "t7.rbxcdn.com",
  "r2.guns.lol",
  "guns.lol",
  "cdn.guns.lol",
]);

function isAllowedAvatarUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return ALLOWED_AVATAR_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl || !isAllowedAvatarUrl(targetUrl)) {
    return new NextResponse("Invalid or disallowed URL", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      next: { revalidate: 3600 },
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "image/jpeg";
      const buffer = await res.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400",
        },
      });
    }
  } catch (err) {
    console.warn("[Avatar Proxy Fetch Error]", err);
  }

  // Fallback SVG if external avatar fails
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
    <rect width="150" height="150" fill="#0f111a"/>
    <circle cx="75" cy="55" r="30" fill="#3b82f6" opacity="0.6"/>
    <path d="M25 135 C25 100 50 90 75 90 C100 90 125 100 125 135 Z" fill="#3b82f6" opacity="0.6"/>
  </svg>`;

  return new NextResponse(fallbackSvg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300",
    },
  });
}

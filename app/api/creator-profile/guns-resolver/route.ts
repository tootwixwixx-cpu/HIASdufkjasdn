import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// SECURITY: this feature is specifically "resolve a guns.lol profile" — it must never
// fetch an arbitrary server-side URL from user input (that's an SSRF primitive). Only
// guns.lol/www.guns.lol hostnames are ever fetched, regardless of what the caller passes.
const ALLOWED_RESOLVER_HOSTS = new Set(["guns.lol", "www.guns.lol"]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let query = (body.query || body.username || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Guns.lol username or URL is required." }, { status: 400 });
    }

    // Normalize to a guns.lol URL. If the caller supplied a full URL, it must already
    // point at guns.lol — otherwise extract a bare username and build the URL ourselves.
    let targetUrl: string;
    if (query.startsWith("http://") || query.startsWith("https://")) {
      let parsed: URL;
      try {
        parsed = new URL(query);
      } catch {
        return NextResponse.json({ error: "Invalid URL." }, { status: 400 });
      }
      if (!ALLOWED_RESOLVER_HOSTS.has(parsed.hostname.toLowerCase())) {
        return NextResponse.json({ error: "Only guns.lol URLs are supported." }, { status: 400 });
      }
      targetUrl = parsed.toString();
    } else {
      const cleanUsername = query.replace(/^@/, "").replace(/^guns\.lol\//i, "").replace(/^\/+/, "");
      if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
        return NextResponse.json({ error: "Invalid guns.lol username." }, { status: 400 });
      }
      targetUrl = `https://guns.lol/${cleanUsername}`;
    }

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Could not fetch Guns.lol profile (HTTP ${res.status}). Ensure the user exists.` },
        { status: 404 }
      );
    }

    const html = await res.text();

    // Extract OpenGraph tags and metadata
    const getMeta = (property: string): string => {
      const match =
        html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i")) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i"));
      return match ? match[1].trim() : "";
    };

    let title = getMeta("og:title") || "";
    if (title.endsWith(" - guns.lol") || title.endsWith(" | guns.lol")) {
      title = title.replace(/\s*[-|]\s*guns\.lol$/i, "");
    }
    const description = getMeta("og:description") || getMeta("description") || "";
    let ogImage = getMeta("og:image") || getMeta("twitter:image") || "";

    // Proxy the image to defeat r2.guns.lol anti-hotlinking
    let avatarUrl = ogImage;
    if (avatarUrl && avatarUrl.startsWith("http")) {
      avatarUrl = `/api/avatar-proxy?url=${encodeURIComponent(avatarUrl)}`;
    }

    // Extract theme color if present
    const themeColor = getMeta("theme-color") || "#3b82f6";

    // Social links extraction from known anchor patterns if available in page
    const socials: Record<string, string> = {};
    const discordMatch = html.match(/https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9_-]+/i);
    if (discordMatch) socials.discord = discordMatch[0];

    const youtubeMatch = html.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:@|c\/|channel\/)|youtu\.be\/)[a-zA-Z0-9_.-]+/i);
    if (youtubeMatch) socials.youtube = youtubeMatch[0];

    const xMatch = html.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i);
    if (xMatch) socials.x = xMatch[0];

    const githubMatch = html.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+/i);
    if (githubMatch) socials.github = githubMatch[0];

    const tiktokMatch = html.match(/https?:\/\/(?:www\.)?tiktok\.com\/@[a-zA-Z0-9_.-]+/i);
    if (tiktokMatch) socials.tiktok = tiktokMatch[0];

    return NextResponse.json({
      success: true,
      data: {
        display_name: title || query.replace(/^https?:\/\/(?:www\.)?guns\.lol\//i, ""),
        bio: description,
        avatar_url: avatarUrl,
        raw_avatar_url: ogImage,
        accent_color: themeColor,
        socials,
        synced_at: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to resolve Guns.lol profile";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// app/api/chatroom/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const since = searchParams.get("since") || undefined;
    const limit = Math.min(Number(searchParams.get("limit") || 100), 200);

    const [messages, cooldown] = await Promise.all([
      dbService.getChatroomMessages(since, limit),
      dbService.getChatroomCooldown(),
    ]);

    return NextResponse.json({
      success: true,
      messages,
      cooldown_seconds: cooldown,
    });
  } catch (error: any) {
    console.error("Error fetching chatroom messages:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load chat messages" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, username, displayName, avatarUrl, message, isDev } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ success: false, error: "Message text is required" }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ success: false, error: "Message is too long (max 500 characters)." }, { status: 400 });
    }

    // Only an authenticated admin may post with the "dev" badge — otherwise any
    // player could spoof `isDev: true` and impersonate staff in the public chat.
    const claimsDev = Boolean(isDev);
    const isDevVerified = claimsDev && (await isAuthenticated(req));
    if (claimsDev && !isDevVerified) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // SECURITY: userId/username/avatar were taken from the request body, so anyone could post as any
    // player (or as "Admin"). Players must hold an authenticated key session from this IP, and their
    // identity is taken from that session. Admins (the dev badge) may post as themselves.
    let postUserId: string;
    let postUsername: string;
    let postDisplay: string | undefined;
    let postAvatar: string | undefined;
    if (isDevVerified) {
      postUserId = String(userId || "0");
      postUsername = String(username || "Admin").slice(0, 40);
      postDisplay = displayName ? String(displayName).slice(0, 40) : undefined;
      postAvatar = avatarUrl ? String(avatarUrl).slice(0, 300) : undefined;
    } else {
      const sess = await dbService.getPlayerSession(String(userId || ""), getClientIp(req));
      if (!sess) {
        return NextResponse.json(
          { success: false, error: "You must be authenticated in-game to use chat." },
          { status: 401 }
        );
      }
      postUserId = String(sess.roblox_user_id);
      postUsername = sess.roblox_username || "Player";
      postDisplay = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 40) : undefined;
      postAvatar = `/api/roblox/avatar?userId=${postUserId}`;
    }

    const result = await dbService.postChatroomMessage({
      user_id: postUserId,
      username: postUsername,
      display_name: postDisplay,
      avatar_url: postAvatar,
      message: message.trim(),
      is_dev: isDevVerified,
    });

    if (result.rateLimited) {
      return NextResponse.json(
        {
          success: false,
          rateLimited: true,
          remaining: result.remaining,
          error: result.error || "Chat cooldown active.",
        },
        { status: 429 }
      );
    }

    if (result.blocked) {
      return NextResponse.json(
        { success: false, blocked: true, error: result.error || "Message contains blacklisted language" },
        { status: 400 }
      );
    }

    if (!result.success || !result.data) {
      return NextResponse.json({ success: false, error: result.error || "Failed to send message" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: result.data });
  } catch (error: any) {
    console.error("Error sending chatroom message:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await isAuthenticated(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const all = searchParams.get("all") === "true" || id === "all";

    if (all) {
      void dbService.audit("chat.clear_all");
      await dbService.clearAllChatroomMessages();
      return NextResponse.json({ success: true, message: "Chatroom history cleared successfully." });
    }

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing message id or all=true" }, { status: 400 });
    }

    await dbService.deleteChatroomMessage(id);
    void dbService.audit("chat.delete_message", { target: id });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error deleting chat message:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

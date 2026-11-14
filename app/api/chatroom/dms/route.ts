// app/api/chatroom/dms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (userId) {
      // SECURITY: this used to return ANY player's DM thread to anyone who supplied their (sequential,
      // public) Roblox user id. Now the caller must be an admin, or have an authenticated key session
      // for that exact Roblox user from the same IP address as this request.
      const isAdmin = await isAuthenticated(req);
      if (!isAdmin && !(await dbService.getPlayerSession(userId, getClientIp(req)))) {
        return NextResponse.json({ success: false, error: "No active authenticated session for this player." }, { status: 401 });
      }
      const messages = await dbService.getDevMessages(userId);
      return NextResponse.json({ success: true, messages });
    }

    // No userId = "give me every player's conversation" — admin dashboard only.
    if (!(await isAuthenticated(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const conversations = await dbService.getDevConversations();
    return NextResponse.json({ success: true, conversations });
  } catch (error: any) {
    console.error("Error fetching dev messages:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, username, displayName, avatarUrl, senderType, message } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ success: false, error: "Message text is required" }, { status: 400 });
    }
    if (message.length > 1000) {
      return NextResponse.json({ success: false, error: "Message is too long (max 1000 characters)." }, { status: 400 });
    }

    const type = senderType === "dev" ? "dev" : "user";

    // Only an authenticated admin may post as "Admin / Dev" — otherwise anyone could
    // spoof staff replies in a player's DM thread.
    if (type === "dev" && !(await isAuthenticated(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // A player message must come from that player's own authenticated session (same IP). The
    // identity written to the thread comes from the SESSION, not from the request body, so a player
    // can't post into someone else's thread or impersonate another account.
    let senderUsername = "Admin / Dev";
    let senderDisplayName = "Admin / Dev";
    let threadUserId = String(userId);
    if (type === "user") {
      const sess = await dbService.getPlayerSession(String(userId), getClientIp(req));
      if (!sess) {
        return NextResponse.json({ success: false, error: "No active authenticated session for this player." }, { status: 401 });
      }
      threadUserId = String(sess.roblox_user_id);
      senderUsername = sess.roblox_username || "Player";
      senderDisplayName = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 40) : senderUsername;
    }

    const result = await dbService.postDevMessage({
      user_id: threadUserId,
      username: senderUsername,
      display_name: senderDisplayName,
      avatar_url: type === "user" ? `/api/roblox/avatar?userId=${threadUserId}` : (avatarUrl ? String(avatarUrl).slice(0, 300) : undefined),
      sender_type: type,
      message: message.trim(),
    });

    if (result.blocked) {
      return NextResponse.json(
        { success: false, blocked: true, error: result.error || "Message contains prohibited words" },
        { status: 400 }
      );
    }

    if (!result.success || !result.data) {
      return NextResponse.json({ success: false, error: result.error || "Failed to send message" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: result.data });
  } catch (error: any) {
    console.error("Error sending dev message:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, reader } = body;
    if (!userId) {
      return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 });
    }

    const readerRole = reader === "player" ? "player" : (reader === "all" ? "all" : "admin");

    // A player marking their own thread read is fine public; marking as admin (or
    // "all", which also flips the admin-side unread state) requires auth.
    if (readerRole !== "player" && !(await isAuthenticated(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (readerRole === "player" && !(await dbService.getPlayerSession(String(userId), getClientIp(req)))) {
      return NextResponse.json({ success: false, error: "No active authenticated session for this player." }, { status: 401 });
    }

    await dbService.markDevMessagesRead(String(userId), readerRole);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error marking messages read:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

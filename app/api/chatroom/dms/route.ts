// app/api/chatroom/dms/route.ts
import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (userId) {
      // A specific player's own thread. There's no player session token to verify
      // ownership against here, so this stays reachable by userId (as the in-game
      // client needs), but see POST/PATCH below for the admin-only operations.
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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

    const type = senderType === "dev" ? "dev" : "user";

    // Only an authenticated admin may post as "Admin / Dev" — otherwise anyone could
    // spoof staff replies in a player's DM thread.
    if (type === "dev" && !(await isAuthenticated(req))) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const senderUsername = type === "dev" ? "Admin / Dev" : (username ? String(username) : "Player");
    const senderDisplayName = type === "dev" ? "Admin / Dev" : (displayName ? String(displayName) : senderUsername);

    const result = await dbService.postDevMessage({
      user_id: String(userId),
      username: senderUsername,
      display_name: senderDisplayName,
      avatar_url: avatarUrl ? String(avatarUrl) : undefined,
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
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

    await dbService.markDevMessagesRead(String(userId), readerRole);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Error marking messages read:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

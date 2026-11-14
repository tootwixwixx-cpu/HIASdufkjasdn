// app/api/telemetry/errors/route.ts
import { NextRequest, NextResponse } from "next/server";
import { publicError } from "@/lib/http-errors";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";

export async function POST(req: NextRequest) {
  try {
    // Unauthenticated write endpoint: rate-limit per IP and cap field sizes.
    if (!(await dbService.rateLimit("client-error", getClientIp(req), 20, 60))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const body = await req.json();
    const { script_id, error_message, stack_trace } = body;
    const executor = typeof body.executor === "string" ? body.executor.slice(0, 80) : null;
    const os = typeof body.os === "string" ? body.os.slice(0, 80) : null;
    const rawSession = body.session_id || body.session_token || null;
    const sessionId = typeof rawSession === "string" && rawSession.length <= 64 ? rawSession : null;

    if (!error_message) {
      return NextResponse.json({ error: "Missing error_message" }, { status: 400 });
    }

    let robloxUsername: string | null = null;
    let robloxUserId: string | null = null;
    let targetScriptId: string | null = script_id || null;
    let targetScriptName: string | null = null;

    if (sessionId) {
      const session = await dbService.getSessionById(sessionId);
      if (session) {
        robloxUsername = session.roblox_username;
        robloxUserId = session.roblox_user_id;
        if (!targetScriptId) targetScriptId = session.script_id;
      }
    }

    if (targetScriptId) {
      const scripts = await dbService.getScriptsLite();
      const script = scripts.find((s) => s.id === targetScriptId || s.slug === targetScriptId);
      if (script) {
        targetScriptName = script.name;
      }
    }

    const recorded = await dbService.recordClientError({
      session_id: sessionId,
      script_id: targetScriptId,
      script_name: targetScriptName || "Universal Script",
      roblox_username: robloxUsername,
      roblox_user_id: robloxUserId,
      executor: executor || null,
      os: os || null,
      error_message: String(error_message).substring(0, 1000),
      stack_trace: stack_trace ? String(stack_trace).substring(0, 3000) : null,
    });

    return NextResponse.json({ success: true, id: recorded.id });
  } catch (err: unknown) {
    const message = publicError(err, "Error logging client error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    const errors = await dbService.getClientErrors(200);
    return NextResponse.json({ errors });
  } catch (err: unknown) {
    const message = publicError(err, "Error retrieving client errors");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized. Admin session required." }, { status: 401 });
  }

  try {
    await dbService.clearClientErrors();
    return NextResponse.json({ success: true, message: "Client error logs cleared." });
  } catch (err: unknown) {
    const message = publicError(err, "Error clearing client errors");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

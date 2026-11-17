// app/api/scripts/changelog/route.ts -- owner-written changelogs for a script (admin only).
// Players never call this: the newest one is attached to the /api/auth/verify response.
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService, sanitizeChangelogEntries } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scriptId = new URL(req.url).searchParams.get("script_id") || "";
  return NextResponse.json({ changelogs: await dbService.listChangelogs(scriptId) });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const scriptId = String(body?.script_id || "");
    const entries = sanitizeChangelogEntries(body?.entries);
    if (!entries) return NextResponse.json({ error: "Add at least one changelog entry." }, { status: 400 });
    const title = typeof body?.title === "string" ? body.title : null;
    const changelog = await dbService.addChangelog(scriptId, title, entries);
    void dbService.audit("scripts.changelog", { target: scriptId, details: { entries: entries.length } });
    return NextResponse.json({ success: true, changelog });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save changelog" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const id = new URL(req.url).searchParams.get("id") || "";
    await dbService.deleteChangelog(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not delete changelog" }, { status: 400 });
  }
}

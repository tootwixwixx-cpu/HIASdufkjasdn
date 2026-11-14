// app/api/scripts/versions/route.ts — list a script's saved builds (GET) and roll back (POST)
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService } from "@/lib/store";
import { adminAlert } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const scriptId = new URL(req.url).searchParams.get("script_id") || "";
  return NextResponse.json({ versions: await dbService.listScriptVersions(scriptId) });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { script_id, version_id } = await req.json();
    const res = await dbService.restoreScriptVersion(String(script_id || ""), String(version_id || ""));
    void dbService.audit("scripts.restore", { target: String(script_id), details: { version: res.version, slug: res.slug } });
    void adminAlert("script_restored", "Script rolled back", { Script: res.slug, "Restored version": `v${res.version}` }, { dedupKey: `${script_id}:${Date.now()}`, windowSec: 1 });
    return NextResponse.json({ success: true, ...res, versions: await dbService.listScriptVersions(String(script_id)) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Restore failed" }, { status: 400 });
  }
}

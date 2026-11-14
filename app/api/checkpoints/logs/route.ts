// app/api/checkpoints/logs/route.ts — checkpoint completion / drop-off report (admin only)
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService } from "@/lib/store";

export const dynamic = "force-dynamic";

const RANGES: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, all: 0 };

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const range = RANGES[p.get("range") || "7d"] ?? 7;
  const script = p.get("script_id") || "all";
  const report = await dbService.getCheckpointReport(script === "all" ? undefined : script, range);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}

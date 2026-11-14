// app/api/analytics/insights/route.ts — aggregated analytics for the dashboard (admin only)
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService } from "@/lib/store";

export const dynamic = "force-dynamic";

const TIMEFRAME_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365, all: 3650 };

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const days = TIMEFRAME_DAYS[p.get("timeframe") || "month"] ?? 30;
  const scriptId = p.get("script_id");
  const data = await dbService.getInsights(days, scriptId && scriptId !== "all" ? scriptId : null);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

import { NextRequest, NextResponse } from "next/server";
import { dbService } from "@/lib/store";
import { isAuthenticated } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Allow Vercel Cron (sends Authorization: Bearer CRON_SECRET) or authenticated dashboard admins
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

  if (!isVercelCron && !isAuthenticated()) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await dbService.autoPruneStaleLogs(true);
    await dbService.markStaleSessionsDisconnected(90000, true);
    return NextResponse.json({
      success: true,
      message: "Database storage optimization & retention pruning completed successfully.",
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Pruning error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

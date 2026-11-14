// app/api/status/route.ts — public status (GET) + admin edits (POST)
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUSES = ["operational", "degraded", "partial_outage", "major_outage", "maintenance"];
const SEVERITIES = ["minor", "major", "critical", "maintenance"];
const STATES = ["investigating", "identified", "monitoring", "resolved"];

export async function GET(req: NextRequest) {
  const data = await dbService.getStatusPage();
  // Dashboard editor: full data (raw + effective status, kinds, sort order) for signed-in admins.
  if (new URL(req.url).searchParams.get("admin") === "1") {
    if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  }
  // Public view: no internal ids for scripts, just what visitors need.
  return NextResponse.json(
    {
      overall: data.overall,
      components: data.components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, status: c.effective_status, message: c.message, updated_at: c.updated_at })),
      incidents: data.incidents.map((i) => ({ id: i.id, title: i.title, body: i.body, severity: i.severity, state: i.state, created_at: i.created_at, resolved_at: i.resolved_at })),
    },
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
  );
}

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  try {
    switch (b.action) {
      case "update_component": {
        if (b.status !== undefined && !STATUSES.includes(str(b.status))) throw new Error("Invalid status");
        await dbService.updateStatusComponent(str(b.id), {
          status: b.status !== undefined ? str(b.status) : undefined,
          message: b.message !== undefined ? (str(b.message) || null) : undefined,
          sort_order: typeof b.sort_order === "number" ? b.sort_order : undefined,
          name: b.name !== undefined ? str(b.name) : undefined,
        });
        break;
      }
      case "create_component":
        if (!str(b.name).trim()) throw new Error("Name required");
        await dbService.createStatusComponent(str(b.name).trim());
        break;
      case "delete_component":
        await dbService.deleteStatusComponent(str(b.id));
        break;
      case "save_incident":
        if (!str(b.title).trim()) throw new Error("Title required");
        if (!SEVERITIES.includes(str(b.severity)) || !STATES.includes(str(b.state))) throw new Error("Invalid severity/state");
        await dbService.saveIncident({
          id: str(b.id) || undefined,
          title: str(b.title).trim(),
          body: str(b.body) || null,
          severity: str(b.severity),
          state: str(b.state),
        });
        break;
      case "delete_incident":
        await dbService.deleteIncident(str(b.id));
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    void dbService.audit(`status.${String(b.action)}`, { target: str(b.id) || str(b.name) || str(b.title) || undefined });
    return NextResponse.json({ success: true, ...(await dbService.getStatusPage()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Status update failed" }, { status: 400 });
  }
}

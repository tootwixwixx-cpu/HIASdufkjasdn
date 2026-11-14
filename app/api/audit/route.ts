// app/api/audit/route.ts — admin-only audit log (filters, cursor pagination, CSV export)
import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { dbService } from "@/lib/store";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const format = p.get("format");
  const rows = await dbService.getAuditLog({
    category: p.get("category") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    beforeId: p.get("before") ? Number(p.get("before")) : undefined,
    limit: format === "csv" ? 1000 : Number(p.get("limit") || 100),
  });

  if (format === "csv") {
    const header = ["time", "action", "target", "ip", "details"].join(",");
    const body = rows
      .map((r) => [r.created_at, r.action, r.target, r.ip_address, r.details].map(csvCell).join(","))
      .join("\n");
    return new NextResponse(header + "\n" + body + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ rows, next_before: rows.length ? rows[rows.length - 1].id : null });
}

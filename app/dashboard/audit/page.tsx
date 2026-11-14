// app/dashboard/audit/page.tsx — who did what, when (admin actions, logins, bans, resets)
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, Input, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui";
import type { AuditRow } from "@/lib/store";

const CATEGORIES = [
  { id: "", label: "All activity" },
  { id: "admin", label: "Sign-ins & 2FA" },
  { id: "keys", label: "Keys" },
  { id: "scripts", label: "Scripts" },
  { id: "players", label: "Players & remote code" },
  { id: "bans", label: "Bans" },
  { id: "settings", label: "Settings" },
  { id: "status", label: "Status page" },
  { id: "chat", label: "Chat moderation" },
];

function describeDetails(d: Record<string, unknown> | null): string {
  if (!d || Object.keys(d).length === 0) return "";
  return Object.entries(d)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams();
      if (category) p.set("category", category);
      if (from) p.set("from", new Date(from).toISOString());
      if (to) p.set("to", new Date(to + "T23:59:59").toISOString());
      for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p.toString();
    },
    [category, from, to]
  );

  const load = useCallback(
    async (append = false) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/audit?${query(append && nextBefore ? { before: String(nextBefore) } : {})}`);
        if (!res.ok) return;
        const json = await res.json();
        setRows((prev) => (append ? [...prev, ...json.rows] : json.rows));
        setNextBefore(json.rows.length >= 100 ? json.next_before : null);
      } finally {
        setLoading(false);
      }
    },
    [query, nextBefore]
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-heading font-semibold text-fg">Audit log</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Every sign-in, key and script change, ban, device reset and remote command, newest first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => load(false)} loading={loading}>
            <RefreshCw /> Refresh
          </Button>
          <a href={`/api/audit?${query({ format: "csv" })}`}>
            <Button variant="secondary">
              <Download /> Export CSV
            </Button>
          </a>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select value={category} onChange={(e) => setCategory(e.target.value)} wrapperClassName="w-56">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <label className="text-caption text-fg-muted">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5" />
        </label>
        <label className="text-caption text-fg-muted">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5" />
        </label>
      </div>

      <Table containerClassName="max-h-[70vh]">
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5} title={loading ? "Loading…" : "No audit entries"} description="Actions appear here as soon as they happen." />
          ) : (
            rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell muted className="whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell mono>{r.action}</TableCell>
                <TableCell mono truncate={220} title={r.target || ""}>{r.target || "—"}</TableCell>
                <TableCell mono>{r.ip_address || "—"}</TableCell>
                <TableCell muted truncate={420} title={describeDetails(r.details)}>{describeDetails(r.details) || "—"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {nextBefore && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => load(true)} loading={loading}>
            Load older entries
          </Button>
        </div>
      )}
    </div>
  );
}

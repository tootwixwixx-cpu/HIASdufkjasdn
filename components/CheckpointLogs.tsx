// components/CheckpointLogs.tsx — "Checkpoint logs" dashboard tab:
//   1) Completion & drop-off: per-session funnel, where players stop, daily trend, recent journeys
//   2) Bypass attempts: anti-bypass detections, lockouts, manual lock/unlock
// Charts follow the dataviz rules: one accent hue for the data, neutral for context, text in text tokens,
// values printed next to marks, hover titles, no invented numbers.
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Flag, Lock, RefreshCw, Search, ShieldAlert, Trash2, Unlock, Users, CheckCircle2, KeyRound } from "lucide-react";
import { Badge, Button, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger } from "@/components/ui";
import type { CheckpointReport } from "@/lib/store";

type ScriptLite = { id: string; name: string; slug: string };
type Attempt = { id: string; ip_address: string; hwid?: string | null; script_id?: string | null; step_index?: number; reason: string; created_at: string };
type LockedIp = { ip: string; reason: string; banned_at: string; attemptCount: number };
type LockedHwid = { hwid: string; ip?: string | null; reason: string; banned_at: string; attemptCount: number };

const RANGES = [
  { id: "24h", label: "24 hours" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

function ago(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Tile({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="flex items-center gap-1.5 text-caption text-fg-muted">
        <span className={tone === "warn" ? "text-warning-text" : "text-fg-subtle"}>{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-data text-heading font-semibold text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-caption text-fg-subtle">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status, step }: { status: "finished" | "in_progress" | "stopped"; step?: string | null }) {
  if (status === "finished") return <Badge tone="success" dot>Finished</Badge>;
  if (status === "in_progress") return <Badge tone="accent" dot>In progress{step ? ` · ${step}` : ""}</Badge>;
  return <Badge tone="warning" dot>Stopped at {step || "a step"}</Badge>;
}

export default function CheckpointLogs({ scripts }: { scripts: ScriptLite[] }) {
  const [view, setView] = useState<"funnel" | "bypass">("funnel");
  const [scriptId, setScriptId] = useState<string>("all");
  const [range, setRange] = useState("7d");
  const [report, setReport] = useState<CheckpointReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [journeyFilter, setJourneyFilter] = useState<"all" | "finished" | "in_progress" | "stopped">("all");

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [lockedIps, setLockedIps] = useState<LockedIp[]>([]);
  const [lockedHwids, setLockedHwids] = useState<LockedHwid[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [search, setSearch] = useState("");

  // Default to the first script so the funnel is useful immediately.
  useEffect(() => {
    if (scriptId === "all" && scripts.length > 0) setScriptId(scripts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scripts.length]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/checkpoints/logs?script_id=${encodeURIComponent(scriptId)}&range=${range}`);
      if (r.ok) setReport(await r.json());
    } finally {
      setLoading(false);
    }
  }, [scriptId, range]);

  const loadBypass = useCallback(async () => {
    const r = await fetch(`/api/checkpoints/bypass-attempts${scriptId !== "all" ? `?script_id=${encodeURIComponent(scriptId)}` : ""}`);
    if (!r.ok) return;
    const j = await r.json();
    setAttempts(j.attempts || []);
    setLockedIps(j.locked_ips || []);
    setLockedHwids(j.locked_hwids || []);
    if (j.summary?.lockout_threshold) setThreshold(j.summary.lockout_threshold);
  }, [scriptId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);
  useEffect(() => {
    loadBypass();
  }, [loadBypass]);

  const bypassAction = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    await fetch("/api/checkpoints/bypass-attempts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    loadBypass();
  };

  const s = report?.summary;
  const funnelMax = Math.max(1, report?.funnel[0]?.reached || 0);
  const dailyMax = Math.max(1, ...(report?.daily || []).map((d) => d.started));
  const journeys = (report?.recent || []).filter((j) => journeyFilter === "all" || j.status === journeyFilter);

  const scopedAttempts = useMemo(
    () => attempts.filter((a) => scriptId === "all" || !a.script_id || a.script_id === scriptId),
    [attempts, scriptId]
  );
  const filteredAttempts = scopedAttempts.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return a.ip_address?.toLowerCase().includes(q) || (a.hwid || "").toLowerCase().includes(q) || a.reason.toLowerCase().includes(q);
  });
  const topReasons = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of scopedAttempts) {
      const key = a.reason.replace(/\s*\(.*$/, "").slice(0, 80);
      m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [scopedAttempts]);
  const reasonMax = Math.max(1, ...topReasons.map((r) => r[1]));
  const lockedIpSet = new Set(lockedIps.map((l) => l.ip));
  const lockedHwidSet = new Set(lockedHwids.map((l) => l.hwid));

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
        <div>
          <h2 className="text-heading font-semibold text-fg">Checkpoint logs</h2>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            How many players finish your checkpoints, exactly where the rest stop, and what the anti-bypass system caught.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scriptId}
            onChange={(e) => setScriptId(e.target.value)}
            className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-body-sm text-fg outline-none focus:border-accent"
            aria-label="Script"
          >
            <option value="all">All scripts</option>
            {scripts.map((sc) => (
              <option key={sc.id} value={sc.id}>{sc.name}</option>
            ))}
          </select>
          <div className="flex rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={`rounded-md px-2.5 py-1 text-caption font-medium transition-colors ${range === r.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={() => { loadReport(); loadBypass(); }} loading={loading}>
            <RefreshCw /> Refresh
          </Button>
        </div>
      </div>

      <Tabs variant="segmented" value={view} onValueChange={(v) => setView(v as "funnel" | "bypass")}>
        <TabsList>
          <TabsTrigger value="funnel">
            <Flag /> Completion & drop-off
          </TabsTrigger>
          <TabsTrigger value="bypass" count={scopedAttempts.length || undefined}>
            <ShieldAlert /> Bypass attempts
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "funnel" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile icon={<Users className="h-3.5 w-3.5" />} label="Players" value={s?.visitors ?? "—"} sub={s ? `${s.sessions} visits · ${s.unique_visitors} IPs` : undefined} />
            <Tile icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Finished all steps" value={s ? `${s.completion_rate}%` : "—"} sub={s ? `${s.finished} of ${s.visitors}` : undefined} />
            <Tile icon={<KeyRound className="h-3.5 w-3.5" />} label="Keys claimed" value={s?.keys_claimed ?? "—"} />
            <Tile icon={<Clock className="h-3.5 w-3.5" />} label="Median time to finish" value={s?.median_minutes_to_finish != null ? `${s.median_minutes_to_finish}m` : "—"} />
            <Tile icon={<Flag className="h-3.5 w-3.5" />} label="Still in progress" value={s?.in_progress ?? "—"} sub="active in the last hour" />
            <Tile
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              tone={s?.biggest_drop ? "warn" : undefined}
              label="Biggest drop-off"
              value={s?.biggest_drop ? `${s.biggest_drop.count}` : "—"}
              sub={s?.biggest_drop ? `stopped at ${s.biggest_drop.title}` : "no drop-offs yet"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
            {/* Funnel */}
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-body font-semibold text-fg">Step-by-step funnel</h3>
                <span className="text-caption text-fg-subtle">bar = players who completed the step</span>
              </div>
              {!report ? (
                <p className="text-body-sm text-fg-muted">Loading…</p>
              ) : !report.scope ? (
                <p className="text-body-sm text-fg-muted">Choose a script above — each script has its own checkpoint steps.</p>
              ) : report.summary.visitors === 0 ? (
                <p className="text-body-sm text-fg-muted">No one has started this script&apos;s checkpoints in this period.</p>
              ) : (
                <ol className="space-y-3">
                  {report.funnel.map((f) => {
                    const pct = Math.round((f.completed / funnelMax) * 100);
                    return (
                      <li key={f.step} title={`${f.title}: ${f.reached} reached, ${f.completed} completed, ${f.stopped_here} stopped here, ${f.in_progress_here} in progress`}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-body-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line font-data text-micro text-fg-muted">{f.step + 1}</span>
                            <span className="truncate text-fg">{f.title}</span>
                            {f.is_workink && <Badge tone="neutral">Work.ink</Badge>}
                          </span>
                          <span className="shrink-0 font-data text-caption text-fg">
                            {f.completed}/{f.reached} <span className="text-fg-subtle">({pct}%)</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-sm bg-line/50">
                          <div className="h-full rounded-sm bg-accent" style={{ width: `${Math.max(f.completed ? 1.5 : 0, pct)}%` }} />
                        </div>
                        {(f.stopped_here > 0 || f.in_progress_here > 0) && (
                          <p className="mt-1 text-caption">
                            {f.stopped_here > 0 && <span className="text-warning-text">{f.stopped_here} stopped here</span>}
                            {f.stopped_here > 0 && f.in_progress_here > 0 && <span className="text-fg-subtle"> · </span>}
                            {f.in_progress_here > 0 && <span className="text-fg-muted">{f.in_progress_here} on this step now</span>}
                          </p>
                        )}
                      </li>
                    );
                  })}
                  <li className="flex items-center justify-between border-t border-line pt-2 text-body-sm">
                    <span className="text-fg-muted">Keys claimed</span>
                    <span className="font-data text-fg">{report.summary.keys_claimed}</span>
                  </li>
                </ol>
              )}
            </div>

            {/* Daily trend: started (neutral) vs finished (accent) */}
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <h3 className="text-body font-semibold text-fg">New players per day</h3>
                <span className="flex items-center gap-3 text-caption text-fg-muted">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-line-strong" /> New players</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-accent" /> Finished</span>
                </span>
              </div>
              {report && report.daily.some((d) => d.started > 0) ? (
                <>
                  <div className="flex h-40 items-end gap-[2px]" role="img" aria-label="Daily checkpoint visitors">
                    {report.daily.map((d) => (
                      <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${d.day}: ${d.started} new players, ${d.finished} finished`}>
                        <div className="relative w-full rounded-t-sm bg-line-strong" style={{ height: `${(d.started / dailyMax) * 100}%` }}>
                          <div className="absolute bottom-0 left-0 w-full rounded-t-sm bg-accent" style={{ height: d.started ? `${(Math.min(d.finished, d.started) / d.started) * 100}%` : 0 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between font-data text-micro text-fg-subtle">
                    <span>{report.daily[0].day.slice(5)}</span>
                    <span>{report.daily[report.daily.length - 1].day.slice(5)}</span>
                  </div>
                </>
              ) : (
                <p className="py-10 text-center text-body-sm text-fg-muted">No visitors in this period.</p>
              )}
            </div>
          </div>

          {/* Journeys */}
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-body font-semibold text-fg">Players</h3>
              <div className="flex rounded-lg border border-line bg-canvas p-0.5">
                {([
                  ["all", "All"],
                  ["finished", "Finished"],
                  ["in_progress", "In progress"],
                  ["stopped", "Stopped"],
                ] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setJourneyFilter(id)}
                    className={`rounded-md px-2.5 py-1 text-caption ${journeyFilter === id ? "bg-surface-hover font-semibold text-fg" : "text-fg-muted hover:text-fg"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Table bare containerClassName="max-h-[420px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Script</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead align="right">Visits</TableHead>
                  <TableHead>First seen</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journeys.length === 0 ? (
                  <TableEmpty colSpan={7} title="No players" description="Players who open the claim page show up here." />
                ) : (
                  journeys.map((j) => (
                    <TableRow key={j.session + j.started_at}>
                      <TableCell><StatusBadge status={j.status} step={j.step_title} /></TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="flex gap-0.5">
                            {Array.from({ length: j.total }, (_, i) => (
                              <span key={i} className={`h-1.5 w-3 rounded-full ${i < j.steps_done ? "bg-accent" : "bg-line-strong"}`} />
                            ))}
                          </span>
                          <span className="font-data text-caption text-fg-muted">{j.steps_done}/{j.total}</span>
                        </span>
                      </TableCell>
                      <TableCell muted truncate={160}>{j.script}</TableCell>
                      <TableCell mono>{j.ip}</TableCell>
                      <TableCell align="right" muted title={j.attempts > 1 ? "Opened the claim page more than once; progress shown is their furthest" : undefined}>{j.attempts}</TableCell>
                      <TableCell muted title={new Date(j.started_at).toLocaleString()}>{ago(j.started_at)}</TableCell>
                      <TableCell muted title={new Date(j.last_at).toLocaleString()}>{ago(j.last_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {view === "bypass" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile icon={<ShieldAlert className="h-3.5 w-3.5" />} tone={scopedAttempts.length ? "warn" : undefined} label="Bypass attempts" value={scopedAttempts.length} sub="most recent 200" />
            <Tile icon={<Lock className="h-3.5 w-3.5" />} label="Locked IPs" value={lockedIps.length} />
            <Tile icon={<Lock className="h-3.5 w-3.5" />} label="Locked devices" value={lockedHwids.length} />
            <Tile icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Auto-lock after" value={`${threshold} attempts`} sub="IP and device, permanent" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[2fr_3fr]">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h3 className="mb-3 text-body font-semibold text-fg">What was caught</h3>
              {topReasons.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Nothing caught yet.</p>
              ) : (
                <ul className="space-y-2">
                  {topReasons.map(([reason, n]) => (
                    <li key={reason} title={`${reason}: ${n}`}>
                      <div className="mb-1 flex justify-between gap-2 text-caption">
                        <span className="truncate text-fg">{reason}</span>
                        <span className="font-data text-fg">{n}</span>
                      </div>
                      <div className="h-2 rounded-sm bg-line/50">
                        <div className="h-full rounded-sm bg-accent" style={{ width: `${(n / reasonMax) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-line bg-surface">
              <h3 className="border-b border-line px-4 py-3 text-body font-semibold text-fg">Locked out</h3>
              <Table bare containerClassName="max-h-[260px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Identifier</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead align="right"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lockedIps.length + lockedHwids.length === 0 ? (
                    <TableEmpty colSpan={5} title="No one is locked out" />
                  ) : (
                    <>
                      {lockedIps.map((l) => (
                        <TableRow key={"ip" + l.ip}>
                          <TableCell><Badge tone="neutral">IP</Badge></TableCell>
                          <TableCell mono>{l.ip}</TableCell>
                          <TableCell muted truncate={220} title={l.reason}>{l.reason}</TableCell>
                          <TableCell muted>{ago(l.banned_at)}</TableCell>
                          <TableCell align="right">
                            <Button size="xs" variant="ghost" onClick={() => bypassAction({ action: "unban_ip", ip: l.ip }, `Unlock IP ${l.ip}?`)}>
                              <Unlock /> Unlock
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {lockedHwids.map((l) => (
                        <TableRow key={"hw" + l.hwid}>
                          <TableCell><Badge tone="neutral">Device</Badge></TableCell>
                          <TableCell mono truncate={200} title={l.hwid}>{l.hwid}</TableCell>
                          <TableCell muted truncate={220} title={l.reason}>{l.reason}</TableCell>
                          <TableCell muted>{ago(l.banned_at)}</TableCell>
                          <TableCell align="right">
                            <Button size="xs" variant="ghost" onClick={() => bypassAction({ action: "unban_hwid", hwid: l.hwid }, "Unlock this device?")}>
                              <Unlock /> Unlock
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h3 className="text-body font-semibold text-fg">Attempt log</h3>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1">
                  <Search className="h-3.5 w-3.5 text-fg-subtle" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search IP, device or reason"
                    className="w-48 bg-transparent text-caption text-fg outline-none placeholder:text-fg-subtle"
                  />
                </label>
                {attempts.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => bypassAction({ action: "clear_attempts" }, "Clear ALL bypass attempt logs? Lockouts stay in place.")}>
                    <Trash2 /> Clear log
                  </Button>
                )}
              </div>
            </div>
            <Table bare containerClassName="max-h-[420px]">
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAttempts.length === 0 ? (
                  <TableEmpty colSpan={6} title={attempts.length ? "No matches" : "No bypass attempts"} description="Skipped steps, too-fast completions and forged tokens appear here." />
                ) : (
                  filteredAttempts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell muted title={new Date(a.created_at).toLocaleString()} className="whitespace-nowrap">{ago(a.created_at)}</TableCell>
                      <TableCell truncate={320} title={a.reason}>{a.reason}</TableCell>
                      <TableCell muted>{typeof a.step_index === "number" ? a.step_index + 1 : "—"}</TableCell>
                      <TableCell mono>{a.ip_address}</TableCell>
                      <TableCell mono truncate={150} title={a.hwid || ""}>{a.hwid || "—"}</TableCell>
                      <TableCell align="right">
                        <span className="flex justify-end gap-1">
                          {lockedIpSet.has(a.ip_address) ? (
                            <Badge tone="danger">IP locked</Badge>
                          ) : (
                            <Button size="xs" variant="ghost" onClick={() => bypassAction({ action: "ban_ip", ip: a.ip_address, reason: "Manual lockout from Checkpoint logs" }, `Lock out IP ${a.ip_address}?`)}>
                              <Lock /> IP
                            </Button>
                          )}
                          {a.hwid && !lockedHwidSet.has(a.hwid) && (
                            <Button size="xs" variant="ghost" onClick={() => bypassAction({ action: "ban_hwid", hwid: a.hwid, ip: a.ip_address, reason: "Manual lockout from Checkpoint logs" }, "Lock out this device?")}>
                              <Lock /> Device
                            </Button>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

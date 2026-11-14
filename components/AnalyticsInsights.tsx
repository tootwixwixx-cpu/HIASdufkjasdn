// components/AnalyticsInsights.tsx — retention, daily active players, executor/OS/country mix,
// checkpoint funnel and key-pool health. All numbers are aggregated in Postgres (migration 002).
// Charts follow the dataviz rules: one accent hue (no categorical palette needed), thin marks,
// text in text tokens, hover tooltips, and a table view for the line chart.
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyticsInsights as Insights } from "@/lib/store";

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-caption text-fg-muted">{label}</p>
      <p className="mt-1 font-data text-heading font-semibold text-fg">{value}</p>
      {sub && <p className="mt-0.5 text-caption text-fg-subtle">{sub}</p>}
    </div>
  );
}

function RankedBars({ title, rows, unit }: { title: string; rows: { label: string; players: number }[]; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r.players));
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="mb-2 text-body-sm font-semibold text-fg">{title}</p>
      {rows.length === 0 ? (
        <p className="text-caption text-fg-subtle">No data in this period.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2" title={`${r.label}: ${r.players} ${unit}`}>
              <span className="truncate text-caption text-fg-muted">{r.label}</span>
              <span className="h-2.5 rounded-sm bg-line/60">
                <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.max(2, (r.players / max) * 100)}%` }} />
              </span>
              <span className="font-data text-caption text-fg">{r.players}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DailyActiveChart({ daily }: { daily: Insights["daily"] }) {
  const W = 720, H = 180, PL = 36, PR = 12, PT = 12, PB = 24;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const max = Math.max(1, ...daily.map((d) => d.players));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const x = (i: number) => PL + (daily.length <= 1 ? (W - PL - PR) / 2 : (i / (daily.length - 1)) * (W - PL - PR));
  const y = (v: number) => PT + (1 - v / niceMax) * (H - PT - PB);
  const line = daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.players).toFixed(1)}`).join(" ");
  const area = daily.length ? `${line} L${x(daily.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || daily.length === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < daily.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  const h = hover !== null ? daily[hover] : null;
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-body-sm font-semibold text-fg">Daily active players</p>
      <p className="mb-2 text-caption text-fg-subtle">Unique players with a successful run, per day (UTC), last {daily.length ? `${daily.length} active days` : "period"}.</p>
      {daily.length === 0 ? (
        <p className="py-8 text-center text-caption text-fg-subtle">No runs in this period.</p>
      ) : (
        <div className="relative">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Daily active players line chart">
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PL} x2={W - PR} y1={y(niceMax * f)} y2={y(niceMax * f)} className="stroke-line" strokeWidth={1} />
                <text x={PL - 6} y={y(niceMax * f) + 4} textAnchor="end" className="fill-fg-subtle" fontSize={10}>{Math.round(niceMax * f)}</text>
              </g>
            ))}
            <path d={area} className="fill-accent" fillOpacity={0.12} />
            <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {daily.length <= 31 && daily.map((d, i) => <circle key={d.day} cx={x(i)} cy={y(d.players)} r={3} className="fill-accent" />)}
            <text x={PL} y={H - 6} className="fill-fg-subtle" fontSize={10}>{daily[0].day.slice(0, 10)}</text>
            <text x={W - PR} y={H - 6} textAnchor="end" className="fill-fg-subtle" fontSize={10}>{daily[daily.length - 1].day.slice(0, 10)}</text>
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={PT} y2={H - PB} className="stroke-fg-muted" strokeWidth={1} strokeDasharray="3 3" />
                <circle cx={x(hover)} cy={y(daily[hover].players)} r={5} className="fill-accent stroke-surface" strokeWidth={2} />
              </g>
            )}
          </svg>
          {h && (
            <div className="pointer-events-none absolute top-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-caption shadow-popover" style={{ left: `${Math.min(80, (x(hover!) / W) * 100)}%` }}>
              <p className="text-fg-muted">{h.day.slice(0, 10)}</p>
              <p className="font-data text-fg">{h.players} players · {h.executions} runs</p>
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-caption text-fg-muted">Show as table</summary>
            <table className="mt-2 w-full text-caption">
              <thead><tr className="text-left text-fg-muted"><th className="py-1">Day</th><th>Players</th><th>Runs</th></tr></thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.day} className="border-t border-line text-fg"><td className="py-1 font-data">{d.day.slice(0, 10)}</td><td className="font-data">{d.players}</td><td className="font-data">{d.executions}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}

function Funnel({ funnel }: { funnel: NonNullable<Insights["funnel"]> }) {
  const stages = [
    { label: "Started checkpoints", n: funnel.started },
    ...funnel.steps.map((s) => ({ label: `Completed step ${s.step + 1}`, n: s.sessions })),
    { label: "Finished all steps", n: funnel.completed },
    { label: "Keys claimed", n: funnel.claimed },
  ];
  const top = Math.max(1, funnel.started);
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-body-sm font-semibold text-fg">Checkpoint funnel</p>
      <p className="mb-2 text-caption text-fg-subtle">Where players drop off between starting the claim page and getting a key.</p>
      <ul className="space-y-1.5">
        {stages.map((s) => {
          const p = pct(s.n, top);
          return (
            <li key={s.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2" title={`${s.label}: ${s.n}${p !== null ? ` (${p}% of starts)` : ""}`}>
              <span className="truncate text-caption text-fg-muted">{s.label}</span>
              <span className="h-2.5 rounded-sm bg-line/60">
                <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.min(100, Math.max(2, (s.n / top) * 100))}%` }} />
              </span>
              <span className="font-data text-caption text-fg">
                {s.n}
                {p !== null && <span className="ml-1 text-fg-subtle">{p}%</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AnalyticsInsights({ timeframe, scriptId }: { timeframe: string; scriptId: string }) {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ timeframe, script_id: scriptId || "all" });
    fetch(`/api/analytics/insights?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => !cancelled && setData(j))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [timeframe, scriptId]);

  const ret = data?.retention;
  const keys = data?.keys;
  const d1 = useMemo(() => (ret ? pct(ret.returned_d1, ret.eligible_d1) : null), [ret]);
  const d7 = useMemo(() => (ret ? pct(ret.returned_d7, ret.eligible_d7) : null), [ret]);

  if (loading && !data) return <div className="rounded-lg border border-line bg-surface p-4 text-body-sm text-fg-muted">Loading insights…</div>;
  if (!data || data.unavailable) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4 text-body-sm text-fg-muted">
        Retention, funnel and player-mix insights appear here once <code>migration/002_features.sql</code> has been run in Supabase.
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="Player insights">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="New players" value={ret?.new_players ?? 0} sub="first run in this period" />
        <StatTile label="Came back next day (D1)" value={d1 === null ? "—" : `${d1}%`} sub={ret ? `${ret.returned_d1} of ${ret.eligible_d1} eligible` : undefined} />
        <StatTile label="Came back within 7 days (D7)" value={d7 === null ? "—" : `${d7}%`} sub={ret ? `${ret.returned_d7} of ${ret.eligible_d7} eligible` : undefined} />
        <StatTile
          label="Keys used in the last 7 days"
          value={keys?.used_7d ?? 0}
          sub={keys ? `of ${keys.activated} ever activated · ${keys.hwid_bound} device-locked` : undefined}
        />
      </div>

      <DailyActiveChart daily={data.daily} />

      <div className="grid gap-3 lg:grid-cols-3">
        <RankedBars title="Executors" rows={data.executors} unit="players" />
        <RankedBars title="Platforms" rows={data.os} unit="players" />
        <RankedBars title="Countries" rows={data.countries} unit="players" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {data.funnel && <Funnel funnel={data.funnel} />}
        {keys && (
          <div className="rounded-lg border border-line bg-surface p-3">
            <p className="mb-2 text-body-sm font-semibold text-fg">Key pool</p>
            <dl className="grid grid-cols-3 gap-2 text-caption">
              {[
                ["Total", keys.total],
                ["Unclaimed", keys.unclaimed],
                ["Claimed", keys.claimed],
                ["Active", keys.active],
                ["Expired", keys.expired],
                ["Banned", keys.banned],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-md border border-line px-2 py-1.5">
                  <dt className="text-fg-muted">{l}</dt>
                  <dd className="font-data text-body text-fg">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

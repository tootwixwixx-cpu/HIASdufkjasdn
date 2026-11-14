// app/dashboard/analytics/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  Users,
  Activity,
  Filter,
  RefreshCw,
  Laptop,
  ShieldAlert,
  Search,
  Download,
  Trash2,
  Globe,
  Radio,
  FileCode,
  Gamepad2,
  Clock,
  Compass,
  Bug,
  Copy,
  Check,
  Terminal,
  X,
  AlertTriangle,
  Zap,
  Flame,
  Shield,
  Layers,
  Sparkles,
} from "lucide-react";
import { Badge, Button, Select, Input, Tabs, TabsList, TabsTrigger, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui";
import type { ExecutionLog, ClientErrorLog } from "@/lib/store";
import WorldMapTelemetry, { ActivePlayerSession } from "@/components/WorldMapTelemetry";
import AnalyticsInsights from "@/components/AnalyticsInsights";

function RobloxAvatar({
  userId,
  username,
  size = "md",
}: {
  userId?: string | null;
  username?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [imgError, setImgError] = useState(false);
  const initials = username ? username.substring(0, 2).toUpperCase() : "??";

  const sizeClass =
    size === "sm"
      ? "w-7 h-7 rounded-lg text-micro"
      : size === "lg"
      ? "w-12 h-12 rounded-lg text-body-sm"
      : "w-9 h-9 rounded-lg text-caption";

  if (userId && !imgError) {
    return (
      <div className={`${sizeClass} overflow-hidden bg-surface border border-line shrink-0 relative flex items-center justify-center`}>
        <img
          src={`/api/roblox/avatar?userId=${userId}`}
          alt={username || "Roblox Avatar"}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} bg-accent hover:bg-accent-hover to-black border border-accent/30 flex items-center justify-center font-bold text-accent-text shrink-0 font-data`}
    >
      {initials}
    </div>
  );
}

function formatCompactNumber(num: number): string {
  if (num === null || num === undefined || isNaN(num)) return "0";
  if (num < 1000) return String(num);
  if (num < 1000000) {
    const val = num / 1000;
    return `${parseFloat(val.toFixed(1))}k`;
  }
  const val = num / 1000000;
  return `${parseFloat(val.toFixed(1))}M`;
}

interface TimelinePoint {
  key: string;
  label: string;
  passed: number;
  failed: number;
  total: number;
}

interface AnalyticsData {
  timeframe: string;
  totalExecutions: number;
  passedExecutions: number;
  failedExecutions: number;
  passRate: number;
  uniqueUsers: number;
  uniqueIps: number;
  checkpointsStarted: number;
  checkpointsCompleted: number;
  checkpointConversionRate: number;
  failureReasons: Record<string, number>;
  executors: Record<string, number>;
  topExecutors?: { name: string; count: number; percentage: number }[];
  topGames?: { place_id: string; place_name: string; count: number; percentage: number }[];
  avgSessionDurationSec?: number;
  operatingSystems?: Record<string, number>;
  scriptsBreakdown?: Record<string, { total: number; passed: number; failed: number }>;
  timeline: TimelinePoint[];
  recentLogs: ExecutionLog[];
}

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<"day" | "week" | "month" | "year" | "all">("all");
  const [selectedScript, setSelectedScript] = useState<string>("all");
  const [scriptsList, setScriptsList] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActivePlayerSession[]>([]);
  const [clientErrors, setClientErrors] = useState<ClientErrorLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [activeLogTab, setActiveLogTab] = useState<"audit" | "errors">("audit");
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [copiedTrace, setCopiedTrace] = useState(false);

  // Fetch available scripts for filtering
  useEffect(() => {
    fetch("/api/scripts")
      .then((res) => res.json())
      .then((resData) => {
        if (resData.scripts) {
          setScriptsList(resData.scripts);
        }
      })
      .catch((err) => console.error("Error fetching scripts list", err));
  }, []);

  // Fetch main analytics and active players telemetry
  const fetchAnalytics = async (tf = timeframe, scId = selectedScript) => {
    try {
      const url = new URL("/api/analytics", window.location.origin);
      url.searchParams.set("timeframe", tf);
      if (scId && scId !== "all") url.searchParams.set("script_id", scId);

      const [analyticsRes, playersRes, errorsRes] = await Promise.all([
        fetch(url.toString()),
        fetch("/api/players"),
        fetch("/api/telemetry/errors"),
      ]);

      const [analyticsJson, playersJson, errorsJson] = await Promise.all([
        analyticsRes.json(),
        playersRes.json(),
        errorsRes.json(),
      ]);

      if (analyticsJson && !analyticsJson.error) {
        setData(analyticsJson);
      }
      if (playersJson && playersJson.sessions) {
        setActiveSessions(playersJson.sessions);
      }
      if (errorsJson && errorsJson.errors) {
        setClientErrors(errorsJson.errors);
      }
    } catch (err) {
      console.error("Failed to load telemetry", err);
    } finally {
      setLoading(false);
    }
  };

  const handleClearClientErrors = async () => {
    if (!confirm("Are you sure you want to clear all client runtime errors?")) return;
    try {
      await fetch("/api/telemetry/errors", { method: "DELETE" });
      setClientErrors([]);
      showToast("Client error logs cleared.");
    } catch {
      alert("Failed to clear error logs.");
    }
  };

  const handleCopyTrace = (trace: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(trace);
      setCopiedTrace(true);
      setTimeout(() => setCopiedTrace(false), 2000);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchAnalytics(timeframe, selectedScript);
  }, [timeframe, selectedScript]);

  // Auto-refresh telemetry every 5s if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchAnalytics(timeframe, selectedScript);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, timeframe, selectedScript]);

  const showToast = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!data || !data.recentLogs || data.recentLogs.length === 0) {
      alert("No execution logs to export.");
      return;
    }

    const headers = [
      "ID",
      "Timestamp",
      "Script",
      "Status",
      "Roblox Username",
      "Roblox User ID",
      "Executor",
      "OS",
      "IP Address",
      "Country",
      "City",
      "Key Last 4",
      "Failure Reason",
    ];

    const rows = data.recentLogs.map((log) => [
      log.id,
      log.created_at,
      log.script_name,
      log.status,
      log.roblox_username || "N/A",
      log.roblox_user_id || "N/A",
      log.executor || "Unknown",
      log.os || "Unknown",
      log.ip_address,
      log.country || "N/A",
      log.city || "N/A",
      log.key_last4 || "NONE",
      `"${(log.failure_reason || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `analytics_logs_${timeframe}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Analytics logs exported to CSV.");
  };

  // Clear analytics logs
  const handleClearLogs = async () => {
    if (!confirm("Are you sure you want to clear all analytics and execution logs? This cannot be undone.")) return;
    try {
      await fetch("/api/analytics", { method: "DELETE" });
      showToast("Analytics logs have been cleared.");
      fetchAnalytics(timeframe, selectedScript);
    } catch {
      alert("Failed to clear analytics.");
    }
  };

  const total = data?.totalExecutions || 0;
  const passed = data?.passedExecutions || 0;
  const failed = data?.failedExecutions || 0;
  const passRate = data?.passRate ?? 100;
  const uniqueUsers = data?.uniqueUsers || 0;
  const uniqueIps = data?.uniqueIps || 0;

  const cpStarted = data?.checkpointsStarted || 0;
  const cpCompleted = data?.checkpointsCompleted || 0;
  const cpRate = data?.checkpointConversionRate ?? 100;
  const cpDropped = Math.max(0, cpStarted - cpCompleted);

  const formatDuration = (seconds: number) => {
    if (seconds <= 0) return "0s";
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  // Filter recent logs by search query
  const filteredLogs = (data?.recentLogs || []).filter((log) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (log.roblox_username && log.roblox_username.toLowerCase().includes(q)) ||
      (log.roblox_user_id && log.roblox_user_id.toLowerCase().includes(q)) ||
      (log.ip_address && log.ip_address.toLowerCase().includes(q)) ||
      (log.script_name && log.script_name.toLowerCase().includes(q)) ||
      (log.executor && log.executor.toLowerCase().includes(q)) ||
      (log.failure_reason && log.failure_reason.toLowerCase().includes(q)) ||
      (log.country && log.country.toLowerCase().includes(q)) ||
      (log.city && log.city.toLowerCase().includes(q)) ||
      (log.key_last4 && log.key_last4.toLowerCase().includes(q))
    );
  });

  // Filter client runtime errors by search query
  const filteredErrors = clientErrors.filter((err) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (err.roblox_username && err.roblox_username.toLowerCase().includes(q)) ||
      (err.roblox_user_id && err.roblox_user_id.toLowerCase().includes(q)) ||
      (err.script_name && err.script_name.toLowerCase().includes(q)) ||
      (err.executor && err.executor.toLowerCase().includes(q)) ||
      (err.error_message && err.error_message.toLowerCase().includes(q)) ||
      (err.os && err.os.toLowerCase().includes(q))
    );
  });

  // Calculate max volume for activity timeline bars
  const timeline = data?.timeline || [];
  const maxTimelineTotal = Math.max(1, ...timeline.map((t) => t.total));

  const kpis = [
    {
      label: "Total runs",
      value: formatCompactNumber(total),
      title: total.toLocaleString(),
      meta: timeframe === "day" ? "Past 24 hours" : timeframe === "week" ? "Past 7 days" : "Recorded total",
      icon: Activity,
      valueClass: "text-fg",
    },
    {
      label: "Passed auth",
      value: formatCompactNumber(passed),
      title: passed.toLocaleString(),
      meta: `${passRate}% success rate`,
      icon: CheckCircle2,
      valueClass: "text-success-text",
    },
    {
      label: "Rejected auth",
      value: formatCompactNumber(failed),
      title: failed.toLocaleString(),
      meta: `${total > 0 ? Math.round((failed / total) * 100) : 0}% rejection rate`,
      icon: XCircle,
      valueClass: "text-danger-text",
    },
    {
      label: "Unique players",
      value: formatCompactNumber(uniqueUsers),
      title: uniqueUsers.toLocaleString(),
      meta: `${formatCompactNumber(uniqueIps)} distinct IPs`,
      icon: Users,
      valueClass: "text-fg",
    },
    {
      label: "Live now",
      value: formatCompactNumber(activeSessions.filter((s) => s.status === "active").length),
      title: undefined,
      meta: "In-game concurrents",
      icon: Zap,
      valueClass: "text-fg",
    },
    {
      label: "Avg session",
      value: formatDuration(data?.avgSessionDurationSec || 0),
      title: undefined,
      meta: "Player active time",
      icon: Clock,
      valueClass: "text-fg",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-heading font-semibold text-fg">
            Execution analytics
            <Badge mono>{total} runs</Badge>
          </h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Script executions, player locations, executor share and auth outcomes, updated live.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            value={selectedScript}
            onChange={(e) => setSelectedScript(e.target.value)}
            aria-label="Script"
            wrapperClassName="w-44"
          >
            <option value="all">All scripts</option>
            {scriptsList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          <Tabs variant="segmented" value={timeframe} onValueChange={(v) => setTimeframe(v as any)}>
            <TabsList>
              {[
                { id: "day", label: "24h" },
                { id: "week", label: "7d" },
                { id: "month", label: "30d" },
                { id: "year", label: "1y" },
                { id: "all", label: "All" },
              ].map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="font-data">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Toggle live auto-refresh (every 5s)"
            aria-pressed={autoRefresh}
          >
            <span aria-hidden className={`size-1.5 rounded-full ${autoRefresh ? "bg-success" : "bg-fg-subtle"}`} />
            {autoRefresh ? "Live, 5s" : "Paused"}
          </Button>

          <Button size="sm" iconOnly onClick={() => fetchAnalytics()} title="Refresh now" aria-label="Refresh now">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-body-sm text-accent-text">
          <CheckCircle2 className="size-4" />
          <span>{notice}</span>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3 lg:grid-cols-6 [&>*]:bg-surface-raised">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="px-4 py-3">
              <div className="flex items-center justify-between text-caption text-fg-subtle">
                <span>{kpi.label}</span>
                <Icon aria-hidden className="size-3.5" />
              </div>
              <p className={`mt-1 font-data text-[22px] font-semibold leading-7 ${kpi.valueClass}`} title={kpi.title}>
                {kpi.value}
              </p>
              <span className="mt-0.5 block truncate text-caption text-fg-subtle">{kpi.meta}</span>
            </div>
          );
        })}
      </div>

      {/* REAL Interactive Global Radar World Map */}
      <WorldMapTelemetry sessions={activeSessions} logs={data?.recentLogs || []} />

      <AnalyticsInsights timeframe={timeframe} scriptId={selectedScript} />

      {/* Activity Timeline Bar Chart */}
      {timeline.length > 0 && (
        <div className="bg-surface border border-line p-4 rounded-lg space-y-4 font-data">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-body-sm font-bold text-fg flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-accent-text" />
                Hourly Execution Volume & Pass Rate
              </h2>
              <p className="text-caption text-fg-muted">
                Hourly throughput across authentication servers. Cyan represents authorized executions, red represents security rejections.
              </p>
            </div>
            <div className="flex items-center gap-4 text-caption">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-accent inline-block" />
                <span className="text-fg">Passed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-danger inline-block" />
                <span className="text-fg">Rejected</span>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="h-44 flex items-end gap-1.5 sm:gap-2.5 w-full">
              {timeline.map((point) => {
                const passedHeight = maxTimelineTotal > 0 ? (point.passed / maxTimelineTotal) * 100 : 0;
                const failedHeight = maxTimelineTotal > 0 ? (point.failed / maxTimelineTotal) * 100 : 0;

                return (
                  <div key={point.key} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                    {/* Hover Floating Tooltip */}
                    <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center bg-canvas border border-line-strong p-2 rounded-lg text-micro text-fg whitespace-nowrap z-20 pointer-events-none">
                      <span className="font-bold text-accent-text">{point.label}</span>
                      <span>Total: {point.total}</span>
                      <span className="text-success-text">Passed: {point.passed}</span>
                      <span className="text-danger-text">Rejected: {point.failed}</span>
                    </div>

                    {/* Stacked Vertical Bar */}
                    <div className="w-full flex flex-col justify-end h-full">
                      {point.failed > 0 && (
                        <div
                          style={{ height: `${failedHeight}%` }}
                          className="w-full bg-danger/80 rounded-t-sm transition-all group-hover:bg-danger-solid-hover"
                        />
                      )}
                      <div
                        style={{ height: `${passedHeight}%` }}
                        className={`w-full bg-accent transition-all group-hover:bg-accent-hover ${
                          point.failed > 0 ? "" : "rounded-t-sm"
                        }`}
                      />
                    </div>

                    <span className="text-micro text-fg-subtle font-data mt-1.5 truncate max-w-[34px]">
                      {point.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Fitted Breakdowns Grid (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 font-data">
        {/* Top Roblox Games */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-accent-text" />
            Top Roblox Games
          </h2>

          {!data?.topGames || data.topGames.length === 0 ? (
            <p className="text-caption text-fg-subtle py-4">No Roblox game telemetry tracked yet.</p>
          ) : (
            <div className="space-y-2.5">
              {data.topGames.map((g) => {
                return (
                  <div key={g.place_id} className="space-y-1">
                    <div className="flex justify-between text-caption">
                      <div className="truncate max-w-[180px]">
                        <span className="text-fg font-semibold block truncate" title={g.place_name}>
                          {g.place_name}
                        </span>
                        <a
                          href={`https://www.roblox.com/games/${g.place_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-micro text-accent-text hover:underline flex items-center gap-1"
                        >
                          <span>Place #{g.place_id}</span>
                          <Compass className="w-2.5 h-2.5" />
                        </a>
                      </div>
                      <span className="text-fg-muted shrink-0 text-micro whitespace-nowrap font-data">
                        {formatCompactNumber(g.count)} ({g.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden border border-line">
                      <div className="bg-accent h-1.5 rounded-full" style={{ width: `${g.percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Executors Detected */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <Laptop className="w-4 h-4 text-accent-text" />
            Roblox Executors Detected
          </h2>

          {Object.keys(data?.executors || {}).length === 0 ? (
            <p className="text-caption text-fg-subtle py-4">No executor data logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(data?.executors || {})
                .sort(([, a], [, b]) => b - a)
                .map(([exec, count]) => {
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={exec} className="space-y-1">
                      <div className="flex justify-between items-center text-caption">
                        <span className="text-fg font-semibold truncate pr-2" title={exec}>{exec}</span>
                        <span className="text-fg-muted text-micro whitespace-nowrap font-data">{formatCompactNumber(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden border border-line">
                        <div className="bg-accent h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Operating Systems & Devices */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <Compass className="w-4 h-4 text-success-text" />
            Device Operating Systems
          </h2>

          {Object.keys(data?.operatingSystems || {}).length === 0 ? (
            <p className="text-caption text-fg-subtle py-4">No OS telemetry logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(data?.operatingSystems || {})
                .sort(([, a], [, b]) => b - a)
                .map(([os, count]) => {
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={os} className="space-y-1">
                      <div className="flex justify-between items-center text-caption">
                        <span className="text-fg font-semibold truncate pr-2" title={os}>{os}</span>
                        <span className="text-fg-muted text-micro whitespace-nowrap font-data">{formatCompactNumber(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden border border-line">
                        <div className="bg-success h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Scripts Breakdown */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <FileCode className="w-4 h-4 text-accent-text" />
            Top Scripts Executed
          </h2>

          {!data?.scriptsBreakdown || Object.keys(data.scriptsBreakdown).length === 0 ? (
            <p className="text-caption text-fg-subtle py-4">No script executions logged yet.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(data.scriptsBreakdown)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([sName, stats]) => {
                  const pct = total > 0 ? Math.round((stats.total / total) * 100) : 0;
                  return (
                    <div key={sName} className="space-y-1">
                      <div className="flex justify-between items-center text-caption">
                        <span className="text-fg font-semibold truncate pr-2" title={sName}>{sName}</span>
                        <span className="text-fg-muted text-micro whitespace-nowrap font-data">{formatCompactNumber(stats.total)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden border border-line">
                        <div className="bg-accent h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Security Rejection Breakdown */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-danger-text" />
            Security Rejections Matrix
          </h2>

          {Object.keys(data?.failureReasons || {}).length === 0 ? (
            <p className="text-caption text-fg-subtle py-4">Zero security rejections recorded.</p>
          ) : (
            <div className="space-y-2.5">
              {Object.entries(data?.failureReasons || {})
                .sort(([, a], [, b]) => b - a)
                .map(([reason, count]) => {
                  const pct = failed > 0 ? Math.round((count / failed) * 100) : 0;
                  return (
                    <div key={reason} className="space-y-1">
                      <div className="flex justify-between items-center text-caption">
                        <span className="text-fg truncate pr-2 font-medium" title={reason}>{reason}</span>
                        <span className="text-fg-muted text-micro whitespace-nowrap font-data">{formatCompactNumber(count)} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden border border-line">
                        <div className="bg-danger h-1.5 rounded-full transition-all duration-300" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Funnel Conversion */}
        <div className="bg-surface border border-line p-4 rounded-lg space-y-3">
          <h2 className="text-caption font-bold text-fg flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-warning-text" />
            Checkpoint Conversion Funnel
          </h2>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-caption">
              <span className="text-fg-muted">Claims Funnel Conversion:</span>
              <span className="font-bold text-warning-text">{cpRate}%</span>
            </div>
            <div className="w-full h-3 bg-surface rounded-lg overflow-hidden border border-line flex">
              <div
                style={{ width: `${cpRate}%` }}
                className="bg-success h-full transition-all duration-500"
                title={`Completed: ${cpRate}%`}
              />
              <div
                style={{ width: `${100 - cpRate}%` }}
                className="bg-danger/80 h-full transition-all duration-500"
                title={`Dropped: ${100 - cpRate}%`}
              />
            </div>
            <div className="flex items-center justify-between text-micro text-fg-subtle pt-1">
              <span>Completed: {cpCompleted}</span>
              <span>Bounced: {cpDropped}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live execution feed & client errors */}
      <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
        <div className="flex flex-col justify-between gap-2 border-b border-line px-3 sm:flex-row sm:items-center">
          <Tabs value={activeLogTab} onValueChange={(v) => setActiveLogTab(v as "audit" | "errors")}>
            <TabsList className="border-b-0">
              <TabsTrigger value="audit" count={data?.recentLogs?.length || 0}>
                <Terminal />
                Execution feed
              </TabsTrigger>
              <TabsTrigger value="errors" count={clientErrors.length > 0 ? clientErrors.length : undefined}>
                <Bug />
                Client errors
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1.5 py-2">
            <Input
              size="sm"
              leading={<Search />}
              placeholder={activeLogTab === "audit" ? "Search user, IP, executor" : "Search error, player, script"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search logs"
              className="w-48 sm:w-64"
            />

            {activeLogTab === "audit" ? (
              <>
                <Button size="sm" onClick={handleExportCSV} title="Download logs as CSV">
                  <Download />
                  CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={handleClearLogs}
                  title="Clear all logs"
                  aria-label="Clear all logs"
                  className="hover:bg-danger/10 hover:text-danger-text"
                >
                  <Trash2 />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearClientErrors}
                title="Clear all client runtime errors"
                className="hover:bg-danger/10 hover:text-danger-text"
              >
                <Trash2 />
                Clear errors
              </Button>
            )}
          </div>
        </div>

        {activeLogTab === "audit" ? (
          /* EXECUTION AUDIT LOG TABLE */
          <div className="overflow-x-auto">
            <Table bare containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>Result</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Script</TableHead>
                  <TableHead>Roblox Player</TableHead>
                  <TableHead>Executor / OS</TableHead>
                  <TableHead>IP & Location</TableHead>
                  <TableHead>Key Last 4</TableHead>
                  <TableHead>Outcome / Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="whitespace-normal h-auto text-center py-12 text-fg-subtle">
                      Loading telemetry logs...
                    </TableCell>
                  </TableRow>
                ) : filteredLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="whitespace-normal h-auto text-center py-12 text-fg-subtle">
                      No execution events match your filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>
                        {log.status === "success" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-bold bg-success/15 text-success-text border border-success/30">
                            Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-bold bg-danger/15 text-danger-text border border-danger/30">
                            Fail
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell>
                        <span className="text-accent-text font-semibold">{log.script_name || "Universal"}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RobloxAvatar userId={log.roblox_user_id} username={log.roblox_username} size="sm" />
                          <div>
                            <span className="text-fg font-medium">{log.roblox_username || "Unknown"}</span>
                            {log.roblox_user_id && (
                              <span className="block text-micro text-fg-subtle">
                                ID: {log.roblox_user_id}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-fg">
                        <span>{log.executor || "Unknown"}</span>
                        <span className="block text-micro text-fg-subtle">{log.os}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-fg">{log.ip_address}</span>
                        <span className="block text-micro text-fg-subtle truncate max-w-[140px]">
                          {log.city ? `${log.city}, ${log.country}` : log.isp || "Private Node"}
                        </span>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        ****-{log.key_last4 || "NONE"}
                      </TableCell>
                      <TableCell className="text-fg">
                        {log.status === "success" ? (
                          <span className="text-success-text font-medium">Authorized & Streamed</span>
                        ) : (
                          <span className="text-danger-text">{log.failure_reason || "Access Rejected"}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* CLIENT ERRORS DEBUG TABLE */
          <div className="overflow-x-auto">
            <Table bare containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>Error Message</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Script</TableHead>
                  <TableHead>Executor / OS</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead align="right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredErrors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="whitespace-normal h-auto text-center py-12 text-fg-subtle">
                      Zero client runtime errors reported. Your Luau code is running smoothly!
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredErrors.map((err) => (
                    <React.Fragment key={err.id}>
                      <TableRow>
                        <TableCell>
                          <span className="text-danger-text font-bold block truncate max-w-[320px]">
                            {err.error_message}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <RobloxAvatar userId={err.roblox_user_id} username={err.roblox_username} size="sm" />
                            <span className="text-fg font-medium">{err.roblox_username || "Unknown"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-accent-text font-medium">{err.script_name || "AtomWare"}</TableCell>
                        <TableCell className="text-fg">
                          <span>{err.executor}</span>
                          <span className="block text-micro text-fg-subtle">{err.os}</span>
                        </TableCell>
                        <TableCell className="text-fg-muted">
                          {new Date(err.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <button
                            type="button"
                            onClick={() => setExpandedErrorId(expandedErrorId === err.id ? null : err.id)}
                            className="px-2.5 py-1 rounded-lg bg-surface border border-line text-fg hover:text-fg text-micro"
                          >
                            {expandedErrorId === err.id ? "Hide Stack" : "View Stack"}
                          </button>
                        </TableCell>
                      </TableRow>

                      {expandedErrorId === err.id && err.stack_trace && (
                        <TableRow>
                          <TableCell colSpan={6} className="whitespace-normal h-auto p-4 bg-canvas border-y border-line">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-micro text-fg-muted font-bold">Lua Stack Trace:</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyTrace(err.stack_trace!)}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-hover text-fg hover:text-fg text-micro"
                                >
                                  {copiedTrace ? <Check className="w-3 h-3 text-success-text" /> : <Copy className="w-3 h-3" />}
                                  <span>{copiedTrace ? "Copied" : "Copy Trace"}</span>
                                </button>
                              </div>
                              <pre className="p-3 rounded-lg bg-canvas/60 border border-line text-danger-text font-data text-micro overflow-x-auto whitespace-pre-wrap">
                                {err.stack_trace}
                              </pre>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
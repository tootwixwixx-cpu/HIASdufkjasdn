// app/dashboard/keys/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import type { KeyRecord, ScriptRecord } from "@/lib/store";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Ban,
  ShieldCheck,
  Filter,
  Clock,
  CheckCircle2,
  Shield,
  Sparkles,
  Edit3,
  X,
  FileText,
  Search,
  RefreshCw,
  Flame,
  UserCheck,
  Zap,
} from "lucide-react";
import {
  Badge,
  StatusBadge,
  Button,
  Spinner,
  Input,
  Select,
  Field,
  Modal,
  Tabs,
  TabsList,
  TabsTrigger,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableToolbar,
} from "@/components/ui";

// Keys as returned by GET /api/keys (with 24h IP history and the key-sharing flag attached)
type KeyRow = KeyRecord & { ips_24h?: string[]; countries_24h?: string[]; sharing_flag?: boolean };

function isStaffReviewKey(k: KeyRecord | null | undefined): boolean {
  if (!k) return false;
  return (
    k.is_staff_review === true ||
    k.claimed_discord_tag === "STAFF_REVIEW" ||
    k.claimed_discord_id === "STAFF_REVIEW" ||
    Boolean(k.key_string && (k.key_string.startsWith("STAFF-") || k.key_string.startsWith("STAFF_")))
  );
}

function isLifetimePaidKey(k: KeyRecord | null | undefined): boolean {
  if (!k) return false;
  if (isStaffReviewKey(k)) return false;
  return k.duration_hours === null || k.duration_hours === undefined;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [bannedIps, setBannedIps] = useState<Record<string, { reason: string; banned_at: string }>>({});
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [purging, setPurging] = useState(false);
  const [purgeFeedback, setPurgeFeedback] = useState<string | null>(null);

  // Generator modal (Regular batch / Lifetime)
  const [showGenModal, setShowGenModal] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [genPrefix, setGenPrefix] = useState("ATOM");
  const [genScriptId, setGenScriptId] = useState("");
  const [genDuration, setGenDuration] = useState<string>("lifetime");
  const [genNotes, setGenNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  // Note editing state for existing keys
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Staff Review Key modal
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffScriptId, setStaffScriptId] = useState("all");
  const [staffKeyMode, setStaffKeyMode] = useState<"auto" | "custom">("auto");
  const [staffCustomKey, setStaffCustomKey] = useState("");
  const [staffNotes, setStaffNotes] = useState("");
  const [staffGenerating, setStaffGenerating] = useState(false);

  useEffect(() => {
    fetchKeys();
    fetchScripts();
  }, []);

  const fetchKeys = async () => {
    try {
      const res = await fetch("/api/keys");
      const data = await res.json();
      if (data.keys) setKeys(data.keys);
      if (data.banned_ips) setBannedIps(data.banned_ips);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchScripts = async () => {
    try {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      if (data.scripts) {
        setScripts(data.scripts);
        if (data.scripts.length > 0 && !genScriptId) {
          setGenScriptId(data.scripts[0].id);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePurgeExpired = async () => {
    setPurging(true);
    setPurgeFeedback(null);
    try {
      const res = await fetch("/api/keys?action=purge_expired", { method: "DELETE" });
      const data = await res.json();
      await fetchKeys();
      const count = data.purged || 0;
      setPurgeFeedback(count > 0 ? `Purged ${count} expired keys` : "No expired keys found (Pool is clean)");
      setTimeout(() => setPurgeFeedback(null), 3500);
    } catch (err) {
      console.error(err);
      setPurgeFeedback("Error purging keys");
      setTimeout(() => setPurgeFeedback(null), 3000);
    } finally {
      setPurging(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const durationHours =
        genDuration === "24h"
          ? 24
          : genDuration === "7d"
          ? 168
          : genDuration === "30d"
          ? 720
          : null;

      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: genCount,
          prefix: genPrefix,
          script_id: genScriptId,
          duration_hours: durationHours,
          notes: genNotes.trim() || null,
        }),
      });

      const data = await res.json();
      if (data.keys) {
        setKeys((prev) => [...data.keys, ...prev]);
        setShowGenModal(false);
        setGenNotes("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  const startEditNote = (k: KeyRecord) => {
    setEditingNoteId(k.id);
    setEditNoteValue(k.notes || "");
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditNoteValue("");
  };

  const handleSaveNote = async (id: string) => {
    setSavingNote(true);
    try {
      const trimmed = editNoteValue.trim();
      const res = await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, notes: trimmed || null }),
      });
      if (res.ok) {
        setKeys((prev) =>
          prev.map((k) => (k.id === id ? { ...k, notes: trimmed || null } : k))
        );
        setEditingNoteId(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingNote(false);
    }
  };

  const handleCreateStaffReviewKey = async () => {
    setStaffGenerating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_staff_review: true,
          script_id: staffScriptId || "all",
          custom_key: staffKeyMode === "custom" ? staffCustomKey.trim() : "",
          notes: staffNotes.trim() || "Staff Review Key",
        }),
      });

      const data = await res.json();
      if (data.keys) {
        setKeys((prev) => [...data.keys, ...prev]);
        setShowStaffModal(false);
        setStaffCustomKey("");
        setStaffNotes("");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStaffGenerating(false);
    }
  };

  const handleStatusToggle = async (key: KeyRecord) => {
    const newStatus = key.status === "banned" ? (key.activated_at ? "active" : "claimed") : "banned";
    try {
      await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: key.id, status: newStatus }),
      });
      setKeys((prev) =>
        prev.map((k) => (k.id === key.id ? { ...k, status: newStatus } : k))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetHwid = async (id: string) => {
    if (!confirm("Reset this key's device lock? It will lock to whichever device runs it next.")) return;
    try {
      const res = await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reset_hwid" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, bound_hwid: null, hwid_bound_at: null } : k)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reset failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this key?")) return;
    try {
      await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleBanIp = async (ip: string) => {
    const isCurrentlyBanned = Boolean(bannedIps[ip]);
    if (isCurrentlyBanned) {
      if (!confirm(`Unban IP ${ip}? Associated keys will remain status as configured.`)) return;
      try {
        const res = await fetch("/api/ip-bans", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ip_address: ip }),
        });
        const data = await res.json();
        if (data.success) {
          fetchKeys();
        }
      } catch (err) {
        console.error(err);
      }
      return;
    }

    const reason = prompt(`Enter blacklist reason for IP ${ip}:`, "License Key Abuse / Script Tampering");
    if (!reason) return;
    try {
      const res = await fetch("/api/ip-bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip_address: ip, reason }),
      });
      const data = await res.json();
      if (data.success) {
        fetchKeys();
      } else {
        alert(data.error || "Failed to ban IP");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const copyKey = (id: string, keyStr: string) => {
    navigator.clipboard?.writeText(keyStr);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter & Search Logic
  const filteredKeys = keys.filter((k) => {
    // 1. Status Filter
    if (filterStatus === "staff" && !isStaffReviewKey(k)) return false;
    if (filterStatus === "lifetime" && !isLifetimePaidKey(k)) return false;
    if (filterStatus !== "all" && filterStatus !== "staff" && filterStatus !== "lifetime") {
      if (isStaffReviewKey(k)) return false;
      if (k.status !== filterStatus) return false;
    }

    // 2. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const boundScript = scripts.find((s) => s.id === k.script_id);
      const matchKey = k.key_string?.toLowerCase().includes(q);
      const matchNote = k.notes?.toLowerCase().includes(q);
      const matchDiscord = k.claimed_discord_tag?.toLowerCase().includes(q);
      const matchIp = k.claimed_ip?.toLowerCase().includes(q);
      const matchScript = boundScript?.name?.toLowerCase().includes(q);
      return matchKey || matchNote || matchDiscord || matchIp || matchScript;
    }

    return true;
  });

  const staffCount = keys.filter((k) => isStaffReviewKey(k)).length;
  const lifetimePaidCount = keys.filter((k) => isLifetimePaidKey(k)).length;
  const unclaimedCount = keys.filter((k) => !isStaffReviewKey(k) && !isLifetimePaidKey(k) && k.status === "unclaimed").length;
  const claimedNotActivatedCount = keys.filter((k) => !isStaffReviewKey(k) && k.status === "claimed").length;
  const activatedCount = keys.filter((k) => !isStaffReviewKey(k) && k.status === "active").length;
  const bannedCount = keys.filter((k) => k.status === "banned").length;

  const renderStatusBadge = (key: KeyRecord) => {
    if (isStaffReviewKey(key)) {
      return (
        <Badge tone="accent">
          <ShieldCheck className="size-3" />
          Staff review
        </Badge>
      );
    }
    if (isLifetimePaidKey(key)) {
      if (key.status === "banned") return <StatusBadge status="revoked">Revoked lifetime</StatusBadge>;
      return (
        <Badge tone="success">
          <Sparkles className="size-3" />
          {key.status === "active" ? "Active lifetime" : "Paid lifetime"}
        </Badge>
      );
    }
    switch (key.status) {
      case "unclaimed":
        return <StatusBadge status="unused">Unclaimed</StatusBadge>;
      case "claimed":
        return <StatusBadge status="claimed" />;
      case "active":
        return <StatusBadge status="active" />;
      case "banned":
        return <StatusBadge status="revoked" />;
      default:
        return <Badge>{key.status}</Badge>;
    }
  };

  const filterPills = [
    { id: "all", label: "All", count: keys.length },
    { id: "unclaimed", label: "Unclaimed", count: unclaimedCount },
    { id: "active", label: "Active", count: activatedCount },
    { id: "claimed", label: "Claimed", count: claimedNotActivatedCount },
    { id: "staff", label: "Staff", count: staffCount },
    { id: "lifetime", label: "Lifetime", count: lifetimePaidCount },
    { id: "banned", label: "Revoked", count: bannedCount },
  ];

  const kpis = [
    { label: "Total pool", value: keys.length, unit: "keys issued", meta: <>Auto-cleaned via <span className="font-data text-fg-muted">pg_cron</span></>, icon: Key, valueClass: "text-fg" },
    {
      label: "Active & bound",
      value: activatedCount + claimedNotActivatedCount,
      unit: "in runtime",
      meta: `${activatedCount} active, ${claimedNotActivatedCount} ready`,
      icon: Zap,
      valueClass: "text-success-text",
    },
    { label: "Available stock", value: unclaimedCount, unit: "unclaimed", meta: "Ready for checkpoint claims", icon: Flame, valueClass: "text-fg" },
    {
      label: "Staff & lifetime",
      value: staffCount + lifetimePaidCount,
      unit: "permanent",
      meta: `${staffCount} staff, ${lifetimePaidCount} lifetime`,
      icon: ShieldCheck,
      valueClass: "text-fg",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-heading font-semibold text-fg">
            Keys pool
            <Badge mono>{keys.length} total</Badge>
          </h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Generate, allocate and monitor license keys. Expired keys are purged automatically every 10 minutes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={handlePurgeExpired}
            disabled={purging}
            title="Purge expired keys immediately from database"
          >
            <RefreshCw className={purging ? "animate-spin" : ""} />
            {purging ? "Purging..." : "Purge expired"}
          </Button>
          <Button size="sm" onClick={() => setShowStaffModal(true)}>
            <ShieldCheck />
            Staff key
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowGenModal(true)}>
            <Plus />
            Generate keys
          </Button>
        </div>
      </div>

      {/* Purge feedback */}
      {purgeFeedback && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-body-sm text-accent-text">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>{purgeFeedback}</span>
          </div>
          <Button variant="ghost" size="xs" iconOnly aria-label="Dismiss" onClick={() => setPurgeFeedback(null)}>
            <X />
          </Button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4 [&>*]:bg-surface-raised gap-px">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="px-4 py-3">
              <div className="flex items-center justify-between text-caption text-fg-subtle">
                <span>{kpi.label}</span>
                <Icon aria-hidden className="size-3.5" />
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className={`font-data text-[22px] font-semibold leading-7 ${kpi.valueClass}`}>{kpi.value}</span>
                <span className="text-caption text-fg-subtle">{kpi.unit}</span>
              </div>
              <div className="mt-0.5 truncate text-caption text-fg-subtle">{kpi.meta}</div>
            </div>
          );
        })}
      </div>

      {/* Toolbar + table */}
      <div>
        <TableToolbar className="justify-between">
          <Input
            size="sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search key, script, note, IP or Discord"
            aria-label="Search keys"
            leading={<Search />}
            trailing={
              searchQuery ? (
                <Button variant="ghost" size="xs" iconOnly aria-label="Clear search" onClick={() => setSearchQuery("")}>
                  <X />
                </Button>
              ) : undefined
            }
            className="max-w-sm"
          />
          <Tabs variant="segmented" value={filterStatus} onValueChange={setFilterStatus} className="max-w-full overflow-x-auto">
            <TabsList>
              {filterPills.map((st) => (
                <TabsTrigger key={st.id} value={st.id} count={st.count}>
                  {st.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </TableToolbar>

        <Table containerClassName="max-h-[calc(100vh-300px)] min-h-[240px]">
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Script</TableHead>
              <TableHead>Bound identity</TableHead>
              <TableHead>Duration / expiry</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-body-sm text-fg-muted">
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Loading keys...
                  </span>
                </td>
              </tr>
            ) : filteredKeys.length === 0 ? (
              <TableEmpty
                colSpan={6}
                title="No keys match this filter"
                description={searchQuery ? "Clear the search or pick another status." : "Generate a batch to fill the pool."}
              />
            ) : (
              filteredKeys.map((k) => {
                const boundScript = scripts.find((s) => s.id === k.script_id);
                const isLifetime = isLifetimePaidKey(k);
                const isStaff = isStaffReviewKey(k);
                const ipBanned = Boolean(k.claimed_ip && bannedIps[k.claimed_ip]);

                return (
                  <TableRow key={k.id}>
                    {/* Key & note */}
                    <TableCell className="py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-data text-caption font-medium text-fg select-all">{k.key_string}</span>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          onClick={() => copyKey(k.id, k.key_string)}
                          title="Copy license key"
                          aria-label="Copy license key"
                          className="opacity-60 group-hover/row:opacity-100"
                        >
                          {copiedId === k.id ? <Check className="text-success-text" /> : <Copy />}
                        </Button>
                        {editingNoteId === k.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              size="sm"
                              value={editNoteValue}
                              onChange={(e) => setEditNoteValue(e.target.value)}
                              placeholder="Buyer name, Discord, order #"
                              className="h-6 w-48"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveNote(k.id);
                                if (e.key === "Escape") cancelEditNote();
                              }}
                            />
                            <Button
                              variant="primary"
                              size="xs"
                              iconOnly
                              disabled={savingNote}
                              onClick={() => handleSaveNote(k.id)}
                              title="Save note"
                              aria-label="Save note"
                            >
                              <Check />
                            </Button>
                            <Button variant="ghost" size="xs" iconOnly onClick={cancelEditNote} title="Cancel" aria-label="Cancel">
                              <X />
                            </Button>
                          </div>
                        ) : k.notes ? (
                          <button
                            type="button"
                            onClick={() => startEditNote(k)}
                            title="Edit note"
                            className="inline-flex max-w-[200px] items-center gap-1 rounded px-1.5 text-caption text-fg-muted hover:bg-surface-hover hover:text-fg"
                          >
                            <FileText className="size-3 shrink-0 text-fg-subtle" />
                            <span className="truncate">{k.notes}</span>
                          </button>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>{renderStatusBadge(k)}</TableCell>

                    <TableCell muted truncate={180}>
                      {k.script_id === "all" ? "Universal (all scripts)" : boundScript ? boundScript.name : "Universal"}
                    </TableCell>

                    {/* Bound identity */}
                    <TableCell className="py-1">
                      {!isStaff && (
                        <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                          {k.bound_hwid ? (
                            <>
                              <span className="font-data text-micro text-fg" title={`Device ${k.bound_hwid}`}>
                                Device {k.bound_hwid.slice(0, 8)}…
                              </span>
                              <Button variant="ghost" size="xs" onClick={() => handleResetHwid(k.id)} title="Clear the device lock">
                                Reset device
                              </Button>
                            </>
                          ) : (
                            <span className="text-micro text-fg-subtle">No device yet (locks on first run)</span>
                          )}
                          {k.sharing_flag && (
                            <span
                              className="rounded border border-warning/40 bg-warning/10 px-1.5 text-micro font-semibold text-warning-text"
                              title={`Used from ${k.ips_24h?.length || 0} IPs / ${k.countries_24h?.length || 0} countries in 24h`}
                            >
                              Possible sharing
                            </span>
                          )}
                          {(k.ips_24h?.length || 0) > 0 && (
                            <span className="text-micro text-fg-muted" title={(k.ips_24h || []).join(", ")}>
                              {k.ips_24h!.length} IP{k.ips_24h!.length === 1 ? "" : "s"} / 24h
                            </span>
                          )}
                        </div>
                      )}
                      {isStaff ? (
                        <span className="text-caption text-fg-muted">Unlimited users</span>
                      ) : k.claimed_ip ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`font-data text-caption ${ipBanned ? "text-danger-text line-through" : "text-fg"}`}>
                            {k.last_ip || k.claimed_ip}
                          </span>
                          {ipBanned && <StatusBadge status="banned" dot={false} />}
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleBanIp(k.claimed_ip!)}
                            title={ipBanned ? `Unban IP ${k.claimed_ip}` : `Ban IP ${k.claimed_ip}`}
                            className={ipBanned ? "" : "hover:bg-danger/10 hover:text-danger-text"}
                          >
                            {ipBanned ? "Unban" : "Ban IP"}
                          </Button>
                        </div>
                      ) : isLifetime ? (
                        <span className="text-caption text-fg-muted">Binds on first run</span>
                      ) : (
                        <span className="text-caption text-fg-subtle">Unbound</span>
                      )}
                      {k.claimed_discord_tag && (
                        <span className="block font-data text-micro text-fg-muted">@{k.claimed_discord_tag}</span>
                      )}
                    </TableCell>

                    {/* Duration / expiry */}
                    <TableCell className="py-1 text-caption">
                      {isStaff ? (
                        <>
                          <span className="text-fg">Permanent</span>
                          <span className="ml-1.5 text-fg-subtle">developer bypass</span>
                        </>
                      ) : isLifetime ? (
                        <>
                          <span className="text-fg">Lifetime</span>
                          <span className="ml-1.5 text-fg-subtle">
                            {k.status === "active" ? "locked to hardware" : "never expires"}
                          </span>
                        </>
                      ) : k.status === "unclaimed" || k.status === "claimed" ? (
                        <>
                          <span className="font-data text-fg">{k.duration_hours ? `${k.duration_hours}h` : "Lifetime"}</span>
                          <span className="ml-1.5 inline-flex items-center gap-1 text-fg-subtle">
                            <Clock className="size-3" /> starts on first run
                          </span>
                        </>
                      ) : k.status === "active" ? (
                        <>
                          <span className="font-data text-fg">{k.duration_hours ? `${k.duration_hours}h` : "Lifetime"}</span>
                          {k.expires_at ? (
                            <span className="ml-1.5 font-data text-fg-muted">
                              exp {new Date(k.expires_at).toLocaleDateString()}{" "}
                              {new Date(k.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          ) : (
                            <span className="ml-1.5 text-fg-subtle">permanent</span>
                          )}
                        </>
                      ) : (
                        <span className="text-danger-text">Access revoked</span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="xs" iconOnly onClick={() => startEditNote(k)} title="Edit note" aria-label="Edit note">
                          <Edit3 />
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          onClick={() => handleStatusToggle(k)}
                          title={k.status === "banned" ? "Unban key" : "Ban key"}
                          aria-label={k.status === "banned" ? "Unban key" : "Ban key"}
                          className={k.status === "banned" ? "hover:text-success-text" : "hover:text-warning-text"}
                        >
                          {k.status === "banned" ? <ShieldCheck /> : <Ban />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          onClick={() => handleDelete(k.id)}
                          title="Delete key"
                          aria-label="Delete key"
                          className="hover:bg-danger/10 hover:text-danger-text"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Batch generator */}
      <Modal
        open={showGenModal}
        onClose={() => setShowGenModal(false)}
        title="Generate license keys"
        description="Create a batch of keys for one script or for every script."
        footer={
          <>
            <Button onClick={() => setShowGenModal(false)}>Cancel</Button>
            <Button variant="primary" loading={generating} onClick={handleGenerate}>
              {`Create ${genCount} key${genCount > 1 ? "s" : ""}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Key prefix" htmlFor="gen-prefix">
              <Input
                id="gen-prefix"
                mono
                value={genPrefix}
                onChange={(e) => setGenPrefix(e.target.value.toUpperCase())}
                placeholder="ATOM"
              />
            </Field>
            <Field label="Quantity" htmlFor="gen-count" aside="1 to 100">
              <Input
                id="gen-count"
                mono
                type="number"
                min={1}
                max={100}
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-fg-muted">Duration</span>
            <Tabs variant="segmented" value={genDuration} onValueChange={setGenDuration}>
              <TabsList className="flex w-full">
                {[
                  { id: "24h", label: "24 hours" },
                  { id: "7d", label: "7 days" },
                  { id: "30d", label: "30 days" },
                  { id: "lifetime", label: "Lifetime" },
                ].map((dur) => (
                  <TabsTrigger key={dur.id} value={dur.id} className="flex-1 justify-center">
                    {dur.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <Field label="Script" htmlFor="gen-script">
            <Select id="gen-script" value={genScriptId} onChange={(e) => setGenScriptId(e.target.value)}>
              <option value="all">Universal (all scripts)</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.slug})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" htmlFor="gen-notes" aside="Optional">
            <Input
              id="gen-notes"
              value={genNotes}
              onChange={(e) => setGenNotes(e.target.value)}
              placeholder="e.g. VIP customer, Discord promo, giveaway"
            />
          </Field>
        </div>
      </Modal>

      {/* Staff review key */}
      <Modal
        open={showStaffModal}
        onClose={() => setShowStaffModal(false)}
        title="Create staff review key"
        description="Staff keys skip IP binding, never expire, and can be used by several testers or admins at once."
        footer={
          <>
            <Button onClick={() => setShowStaffModal(false)}>Cancel</Button>
            <Button variant="primary" loading={staffGenerating} onClick={handleCreateStaffReviewKey}>
              Create staff key
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-fg-muted">Key string</span>
            <Tabs variant="segmented" value={staffKeyMode} onValueChange={(v) => setStaffKeyMode(v as "auto" | "custom")}>
              <TabsList className="flex w-full">
                <TabsTrigger value="auto" className="flex-1 justify-center">
                  Generate automatically
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1 justify-center">
                  Custom string
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {staffKeyMode === "custom" && (
            <Field label="Custom key string" htmlFor="staff-key">
              <Input
                id="staff-key"
                mono
                value={staffCustomKey}
                onChange={(e) => setStaffCustomKey(e.target.value.toUpperCase())}
                placeholder="STAFF-REVIEW-2026"
              />
            </Field>
          )}

          <Field label="Script scope" htmlFor="staff-script">
            <Select id="staff-script" value={staffScriptId} onChange={(e) => setStaffScriptId(e.target.value)}>
              <option value="all">Universal (all scripts)</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Staff note" htmlFor="staff-notes">
            <Input
              id="staff-notes"
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              placeholder="e.g. ScriptBlox moderator, tester #4"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

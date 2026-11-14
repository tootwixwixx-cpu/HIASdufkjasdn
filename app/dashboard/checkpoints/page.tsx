// app/dashboard/checkpoints/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import type { CheckpointItem, CreatorProfile, CreatorEmblem, ScriptRecord } from "@/lib/store";
import {
  CheckCircle2,
  ExternalLink,
  Plus,
  Trash2,
  Clock,
  Save,
  Check,
  Copy,
  AlertCircle,
  User,
  Shield,
  Crown,
  Flame,
  Zap,
  Star,
  Skull,
  Sparkles,
  Link2,
  Globe,
  Layers,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, Badge } from "@/components/ui";
import { SOCIAL_PLATFORMS, BADGE_PRESETS } from "@/lib/social-platforms";
import { WorkinkLogo } from "@/components/WorkinkLogo";
import CheckpointLogs from "@/components/CheckpointLogs";

export default function CheckpointsPage() {
  const [activeTab, setActiveTab] = useState<"checkpoints" | "profile" | "bypass_attempts">("checkpoints");
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [filterScript, setFilterScript] = useState<string>("all");

  // Checkpoint Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cpScriptId, setCpScriptId] = useState<string>("all");
  const [cpTitle, setCpTitle] = useState("");
  const [cpUrl, setCpUrl] = useState("");
  const [cpDuration, setCpDuration] = useState<number>(5);
  const [cpOrder, setCpOrder] = useState<number>(1);
  const [isWorkinkType, setIsWorkinkType] = useState<boolean>(false);
  const [destinationCopied, setDestinationCopied] = useState<boolean>(false);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [checkpointSuccess, setCheckpointSuccess] = useState(false);

  // Profile Form State (Guns.lol style)
  const [profile, setProfile] = useState<CreatorProfile>({
    display_name: "Revile",
    bio: "Lead Developer & Script Engineer. High performance Lua scripts with advanced protection.",
    avatar_url: "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21",
    emblems: [
      { id: "1", label: "Verified Developer", icon: "verified", color: "#3b82f6" },
      { id: "2", label: "Founder", icon: "crown", color: "#eab308" },
      { id: "3", label: "Tamper Proof", icon: "shield", color: "#10b981" },
    ],
    socials: {
      discord: "https://discord.gg/NdrTc27GxT",
      youtube: "https://youtube.com/@revile",
      twitter: "https://x.com/revile",
      x: "https://x.com/revile",
      github: "https://github.com/",
      tiktok: "",
      cashapp: "",
      paypal: "",
      spotify: "",
      roblox: "",
      telegram: "",
    },
    social_toggles: {},
    badge_toggles: {},
  });

  // Guns.lol Sync state
  const [gunsUsername, setGunsUsername] = useState("");
  const [syncingGuns, setSyncingGuns] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // New Emblem Inputs
  const [newEmblemLabel, setNewEmblemLabel] = useState("");
  const [newEmblemIcon, setNewEmblemIcon] = useState<string>("verified");
  const [newEmblemColor, setNewEmblemColor] = useState("#3b82f6");

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const handleSyncGuns = async () => {
    if (!gunsUsername.trim()) return;
    setSyncingGuns(true);
    setSyncError(null);
    setSyncSuccess(false);
    try {
      const res = await fetch("/api/creator-profile/guns-resolver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: gunsUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to sync Guns.lol profile.");

      if (data.data) {
        setProfile((prev) => {
          const mergedSocials = { ...prev.socials, ...(data.data.socials || {}) };
          return {
            ...prev,
            display_name: data.data.display_name || prev.display_name,
            bio: data.data.bio || prev.bio,
            avatar_url: data.data.avatar_url || prev.avatar_url,
            raw_avatar_url: data.data.raw_avatar_url || prev.raw_avatar_url,
            socials: mergedSocials,
          };
        });
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 3000);
      }
    } catch (err: unknown) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncingGuns(false);
    }
  };

  const toggleBadgePreset = (preset: typeof BADGE_PRESETS[0]) => {
    setProfile((prev) => {
      const existing = (prev.emblems || []).find((e) => e.label === preset.label);
      if (existing) {
        return { ...prev, emblems: (prev.emblems || []).filter((e) => e.label !== preset.label) };
      }
      return {
        ...prev,
        emblems: [...(prev.emblems || []), { id: crypto.randomUUID(), ...preset }],
      };
    });
  };

  const toggleSocialEnabled = (key: string) => {
    setProfile((prev) => ({
      ...prev,
      social_toggles: {
        ...(prev.social_toggles || {}),
        [key]: prev.social_toggles?.[key] === false ? true : false,
      },
    }));
  };

  useEffect(() => {
    fetchScripts();
    fetchCheckpoints();
    fetchProfile();
  }, []);

  const fetchScripts = async () => {
    try {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.scripts || []);
      if (list.length > 0) {
        setScripts(list);
        const active = list.filter((s: ScriptRecord) => s.is_active !== false);
        const preferred =
          active.find((s: ScriptRecord) => s.slug === "atomware-hub" || s.name.toLowerCase().includes("atom")) ||
          active[0];
        if (preferred) {
          setFilterScript(preferred.id);
          setCpScriptId(preferred.id);
        }
      }
    } catch (err) {
      console.error("Error fetching scripts", err);
    }
  };

  const fetchCheckpoints = async () => {
    try {
      const res = await fetch("/api/checkpoints?script_id=all");
      const data = await res.json();
      if (data.checkpoints) setCheckpoints(data.checkpoints);
    } catch (err) {
      console.error("Error fetching checkpoints", err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await fetch("/api/creator-profile");
      const data = await res.json();
      if (data.profile) setProfile(data.profile);
    } catch (err) {
      console.error("Error fetching creator profile", err);
    }
  };

  // Each script has its own checkpoint set. The form targets the script currently selected in the
  // list filter (it used to snap back to "All scripts" after every save, which silently put every
  // new checkpoint into one shared pool). Step numbers count within that script's set only.
  const countForScript = (sid: string) => checkpoints.filter((cp) => (cp.script_id || "all") === sid).length;

  const resetCheckpointForm = () => {
    setEditingId(null);
    setCpScriptId(filterScript);
    setCpTitle("");
    setCpUrl("");
    setCpDuration(5);
    setIsWorkinkType(false);
    setCpOrder(countForScript(filterScript) + 1);
    setCheckpointError(null);
  };

  const switchToWorkinkMode = () => {
    setEditingId(null);
    setIsWorkinkType(true);
    setCpDuration(0);
    setCpScriptId(filterScript);
    const nextOrder = countForScript(filterScript) + 1;
    setCpOrder(nextOrder);
    setCpTitle(`Work.ink Task #${nextOrder}`);
    setCpUrl("");
    setCheckpointError(null);
  };

  const handleEditCheckpoint = (cp: CheckpointItem) => {
    setEditingId(cp.id);
    setCpScriptId(cp.script_id || "all");
    setCpTitle(cp.title);
    setCpUrl(cp.url);
    const isWk = cp.duration_seconds === 0 || cp.url.includes("work.ink");
    setIsWorkinkType(isWk);
    setCpDuration(isWk ? 0 : cp.duration_seconds || 5);
    setCpOrder(cp.order || 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckpointError(null);

    if (!cpTitle.trim()) {
      setCheckpointError("Please provide a title for the checkpoint.");
      return;
    }
    if (!cpUrl.trim() || (!cpUrl.startsWith("http://") && !cpUrl.startsWith("https://"))) {
      setCheckpointError("Please provide a valid URL starting with http:// or https://");
      return;
    }

    setSavingCheckpoint(true);
    try {
      const res = await fetch("/api/checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId || undefined,
          script_id: cpScriptId,
          title: cpTitle.trim(),
          url: cpUrl.trim(),
          duration_seconds: (isWorkinkType || cpUrl.includes("work.ink")) ? 0 : cpDuration,
          order: cpOrder,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save checkpoint.");

      setCheckpointSuccess(true);
      setTimeout(() => setCheckpointSuccess(false), 2000);
      resetCheckpointForm();
      fetchCheckpoints();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error saving checkpoint";
      setCheckpointError(message);
    } finally {
      setSavingCheckpoint(false);
    }
  };

  const handleDeleteCheckpoint = async (id: string) => {
    if (!confirm("Are you sure you want to delete this checkpoint?")) return;
    try {
      const res = await fetch(`/api/checkpoints?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "Failed to delete checkpoint from database.");
      }
      setCheckpoints((prev) => prev.filter((cp) => cp.id !== id));
      fetchCheckpoints();
    } catch (err: unknown) {
      console.error("Error deleting checkpoint", err);
      const msg = err instanceof Error ? err.message : "Error deleting checkpoint";
      setCheckpointError(msg);
    }
  };

  const handleAddEmblem = () => {
    if (!newEmblemLabel.trim()) return;
    const newEmblem: CreatorEmblem = {
      id: crypto.randomUUID(),
      label: newEmblemLabel.trim(),
      icon: newEmblemIcon,
      color: newEmblemColor,
    };
    setProfile((prev) => ({
      ...prev,
      emblems: [...(prev.emblems || []), newEmblem],
    }));
    setNewEmblemLabel("");
  };

  const handleRemoveEmblem = (id: string) => {
    setProfile((prev) => ({
      ...prev,
      emblems: (prev.emblems || []).filter((e) => e.id !== id),
    }));
  };

  const handleSaveProfile = async () => {
    setProfileError(null);
    setSavingProfile(true);
    try {
      const res = await fetch("/api/creator-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save profile.");

      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving profile";
      setProfileError(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  const renderEmblemIcon = (icon: string) => {
    switch (icon) {
      case "crown":
        return <Crown className="w-3.5 h-3.5" />;
      case "shield":
        return <Shield className="w-3.5 h-3.5" />;
      case "flame":
        return <Flame className="w-3.5 h-3.5" />;
      case "zap":
        return <Zap className="w-3.5 h-3.5" />;
      case "star":
        return <Star className="w-3.5 h-3.5" />;
      case "skull":
        return <Skull className="w-3.5 h-3.5" />;
      case "verified":
      default:
        return <Sparkles className="w-3.5 h-3.5" />;
    }
  };

  // Show exactly one set: a script's own checkpoints, or the shared default set ("all").
  const filteredCheckpoints = checkpoints
    .filter((cp) => (cp.script_id || "all") === filterScript)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="border-b border-line pb-3">
        <h1 className="text-heading font-semibold text-fg">Checkpoints & creator profile</h1>
        <p className="mt-0.5 text-body-sm text-fg-muted">
          Configure checkpoint links, countdowns and script locks, plus the creator profile shown on the key claim page.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as "checkpoints" | "profile" | "bypass_attempts");
        }}
      >
        <TabsList>
          <TabsTrigger value="checkpoints">
            <Layers />
            Checkpoints
          </TabsTrigger>
          <TabsTrigger value="profile">
            <User />
            Creator profile
          </TabsTrigger>
          <TabsTrigger value="bypass_attempts">
            <ShieldAlert />
            Checkpoint logs
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ========================================================================= */}
      {/* TAB 1: CHECKPOINTS SETUP */}
      {/* ========================================================================= */}
      {activeTab === "checkpoints" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Checkpoint Creation / Edit Form */}
          <div className="lg:col-span-5 bg-surface-raised border border-line rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h2 className="text-caption font-bold text-fg flex items-center gap-2">
                <Plus className="w-4 h-4 text-success-text" />
                {editingId ? "Edit Checkpoint" : "Add Checkpoint"}
              </h2>
              {editingId && (
                <button
                  type="button"
                  onClick={resetCheckpointForm}
                  className="text-micro text-fg-muted hover:text-fg"
                >
                  Cancel Edit
                </button>
              )}
            </div>

            {checkpointError && (
              <div className="p-3 bg-danger/10 border border-danger/30 text-danger-text rounded-lg text-caption flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{checkpointError}</span>
              </div>
            )}

            {checkpointSuccess && (
              <div className="p-3 bg-success/10 border border-success/30 text-success-text rounded-lg text-caption flex items-center gap-2">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>Checkpoint saved successfully!</span>
              </div>
            )}

            {/* Mode Switcher: Standard vs Work.ink */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-surface border border-line rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setIsWorkinkType(false);
                  setCpDuration(15);
                  if (cpTitle.startsWith("Work.ink Task")) setCpTitle("");
                }}
                className={`py-2 px-3 rounded-lg font-semibold text-caption transition-all flex items-center justify-center gap-1.5 ${
                  !isWorkinkType
                    ? "bg-surface-hover text-fg"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                <Globe className="w-3.5 h-3.5 text-accent-text" />
                <span>Standard Link</span>
              </button>

              <button
                type="button"
                onClick={switchToWorkinkMode}
                className={`py-2 px-3 rounded-lg font-semibold text-caption transition-all flex items-center justify-center gap-1.5 ${
                  isWorkinkType
                    ? "bg-accent hover:bg-accent-hover text-accent-fg"
                    : "text-accent-text hover:text-fg bg-accent/10 border border-accent/20"
                }`}
              >
                <WorkinkLogo className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Work.ink Setup</span>
              </button>
            </div>

            {/* Work.ink Setup Guidance Card */}
            {isWorkinkType && (
              <div className="p-3.5 rounded-lg bg-accent/10 border border-accent/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-micro font-bold text-accent-text flex items-center gap-1.5">
                    <WorkinkLogo className="w-3.5 h-3.5 flex-shrink-0" />
                    Work.ink API Task (No Timer)
                  </span>
                  <span className="text-micro font-data px-2 py-0.5 rounded bg-accent/20 text-accent-text border border-accent/40">
                    API Verified
                  </span>
                </div>
                <p className="text-micro text-fg">
                  In your Work.ink dashboard, set your link's <strong>Target / Destination URL</strong> to:
                </p>
                <div className="flex items-center gap-1.5 bg-surface border border-accent/40 rounded-lg p-1.5 px-2 font-data text-micro text-accent-text justify-between">
                  <span className="truncate select-all">
                    {(() => {
                      const base = typeof window !== "undefined" ? window.location.origin : "https://atomprotect.vercel.app";
                      const selScript = scripts.find((s) => s.id === cpScriptId);
                      return selScript && cpScriptId !== "all"
                        ? `${base}/claim?script=${selScript.slug}&token={TOKEN}`
                        : `${base}/claim?token={TOKEN}`;
                    })()}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        const base = window.location.origin;
                        const selScript = scripts.find((s) => s.id === cpScriptId);
                        const full = selScript && cpScriptId !== "all"
                          ? `${base}/claim?script=${selScript.slug}&token={TOKEN}`
                          : `${base}/claim?token={TOKEN}`;
                        navigator.clipboard.writeText(full);
                        setDestinationCopied(true);
                        setTimeout(() => setDestinationCopied(false), 2000);
                      }
                    }}
                    className="p-1 rounded hover:bg-accent/20 text-accent-text transition-colors flex-shrink-0"
                    title="Copy Destination URL"
                  >
                    {destinationCopied ? <Check className="w-3.5 h-3.5 text-success-text" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-micro text-fg-muted">
                  Players are returned with a secure token. The human slider is unlocked <strong>strictly after Work.ink confirms completion</strong>.
                </p>
              </div>
            )}

            <form onSubmit={handleSaveCheckpoint} className="space-y-4 text-caption">
              {/* Target Script Selector */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  Target Script
                </label>
                <select
                  value={cpScriptId}
                  onChange={(e) => setCpScriptId(e.target.value)}
                  className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                >
                  <option value="all">Shared default (used by scripts with no checkpoints of their own)</option>
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (/{s.slug})
                    </option>
                  ))}
                </select>
                <p className="text-micro text-fg-subtle mt-1">
                  Bind this checkpoint to a specific script (e.g. Trident vs Rivals) or all scripts.
                </p>
              </div>

              {/* Title */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  Checkpoint Title
                </label>
                <input
                  type="text"
                  value={cpTitle}
                  onChange={(e) => setCpTitle(e.target.value)}
                  placeholder={isWorkinkType ? "e.g. Work.ink Step #1" : "e.g. Visit Community Sponsor, Subscribe on YouTube"}
                  className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                />
              </div>

              {/* Destination URL */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  {isWorkinkType ? "Work.ink Shortlink (URL)" : "Destination Link (URL)"}
                </label>
                <div className="relative">
                  <input
                    type="url"
                    value={cpUrl}
                    onChange={(e) => setCpUrl(e.target.value)}
                    placeholder={isWorkinkType ? "https://work.ink/..." : "https://linkvertise.com/... or https://discord.gg/..."}
                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent pr-9"
                  />
                  <Link2 className="w-4 h-4 text-fg-subtle absolute right-2.5 top-2.5" />
                </div>
                <p className="text-micro text-fg-subtle mt-1">
                  {isWorkinkType
                    ? "Paste your monetized Work.ink link generated in your publisher dashboard."
                    : "Users click this link in a new tab to complete this checkpoint step."}
                </p>
              </div>

              {/* Duration and Order */}
              <div className="grid grid-cols-2 gap-3">
                {isWorkinkType ? (
                  <div>
                    <label className="block text-fg font-semibold mb-1">
                      Timer Setting
                    </label>
                    <div className="w-full bg-surface border border-accent/40 rounded-lg px-3 py-2 text-accent-text flex items-center gap-1.5 font-data text-caption">
                      <WorkinkLogo className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>No Timer (API)</span>
                    </div>
                    <p className="text-micro text-fg-subtle mt-0.5">Verified by Work.ink server.</p>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between text-fg font-semibold mb-1">
                      <span>Duration (Timer)</span>
                      <span className="font-data text-success-text">{cpDuration}s</span>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={cpDuration}
                      onChange={(e) => setCpDuration(Number(e.target.value))}
                      className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                    />
                    <p className="text-micro text-fg-subtle mt-0.5">Seconds to wait</p>
                  </div>
                )}

                <div>
                  <label className="block text-fg font-semibold mb-1">
                    Step Order
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={cpOrder}
                    onChange={(e) => setCpOrder(Number(e.target.value))}
                    className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                  />
                  <p className="text-micro text-fg-subtle mt-0.5">Step sequence (#1, #2, #3)</p>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingCheckpoint}
                className={`w-full py-2.5 px-4 rounded-lg text-fg font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                  isWorkinkType
                    ? "bg-accent hover:bg-accent-hover"
                    : "bg-accent hover:bg-accent-hover"
                }`}
              >
                {savingCheckpoint ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    {isWorkinkType ? <WorkinkLogo className="w-4 h-4 flex-shrink-0" /> : <Save className="w-4 h-4" />}
                    <span>{editingId ? "Update Checkpoint" : isWorkinkType ? "Add Work.ink Checkpoint" : "Add Checkpoint"}</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Checkpoints List Panel */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-raised border border-line rounded-lg p-4">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-success-text" />
                <span className="text-caption font-bold text-fg">Configured Checkpoints</span>
                <span className="text-micro text-fg-subtle">({filteredCheckpoints.length})</span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={switchToWorkinkMode}
                  className="bg-accent hover:bg-accent-hover px-2.5 py-1 rounded-lg text-accent-fg font-semibold text-micro transition-all flex items-center gap-1.5"
                >
                  <WorkinkLogo className="w-3 h-3 flex-shrink-0" />
                  <span>+ Work.ink Checkpoint</span>
                </button>
                <span className="text-micro text-fg-muted">Filter:</span>
                <select
                  value={filterScript}
                  onChange={(e) => {
                    setFilterScript(e.target.value);
                    // Retarget the add form to the script being viewed (unless editing an existing checkpoint).
                    if (!editingId) {
                      setCpScriptId(e.target.value);
                      setCpOrder(countForScript(e.target.value) + 1);
                    }
                  }}
                  className="bg-surface border border-line-strong rounded-lg px-2.5 py-1 text-caption text-fg outline-none focus:border-accent"
                >
                  <option value="all">Shared default (scripts with none of their own)</option>
                  {scripts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {filteredCheckpoints.length === 0 ? (
              <div className="p-4 text-center bg-surface-raised border border-line rounded-lg text-fg-subtle text-caption">
                No checkpoints configured for this selection yet. Add your first checkpoint using the form on the left.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCheckpoints.map((cp, idx) => {
                  const boundScript = scripts.find((s) => s.id === cp.script_id);
                  const isWk = cp.duration_seconds === 0 || cp.url.includes("work.ink");
                  return (
                    <div
                      key={cp.id}
                      className="p-4 bg-surface-raised border border-line hover:border-line-strong rounded-lg flex items-center justify-between gap-4 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-data text-caption font-bold flex-shrink-0 ${
                            isWk
                              ? "bg-accent/10 border border-accent/30 text-accent-text"
                              : "bg-success/10 border border-success/20 text-success-text"
                          }`}
                        >
                          #{cp.order || idx + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-caption font-bold text-fg truncate">{cp.title}</h3>
                            <span
                              className={`text-micro px-2 py-0.5 rounded font-data ${
                                cp.script_id === "all" || !cp.script_id
                                  ? "bg-accent/10 text-accent-text border border-accent/20"
                                  : "bg-accent/10 text-accent-text border border-accent/20"
                              }`}
                            >
                              {boundScript ? boundScript.name : "Global (All Scripts)"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-micro text-fg-muted mt-1 truncate">
                            {isWk ? (
                              <span className="flex items-center gap-1.5 font-data text-accent-text font-semibold text-micro px-2 py-0.5 rounded bg-accent/10 border border-accent/30">
                                <WorkinkLogo className="w-3.5 h-3.5 flex-shrink-0" />
                                Work.ink (No Timer • API Verified)
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 font-data text-success-text text-micro">
                                <Clock className="w-3 h-3" />
                                {cp.duration_seconds}s timer
                              </span>
                            )}
                            <a
                              href={cp.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-fg-muted hover:text-fg flex items-center gap-1 truncate max-w-xs"
                            >
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{cp.url}</span>
                            </a>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEditCheckpoint(cp)}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-hover hover:bg-surface-active text-fg text-caption transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCheckpoint(cp.id)}
                          className="p-1.5 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger-text transition-colors"
                          title="Delete Checkpoint"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: GUNS.LOL CREATOR PROFILE CUSTOMIZER */}
      {/* ========================================================================= */}
      {activeTab === "profile" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Profile Form Controls */}
          <div className="lg:col-span-6 bg-surface-raised border border-line rounded-lg p-4 space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="text-caption font-bold text-fg flex items-center gap-2">
                  <User className="w-4 h-4 text-accent-text" />
                  Guns.lol Profile Settings
                </h2>
                <p className="text-micro text-fg-muted mt-0.5">
                  Customize avatar, display name, bio, social links, and emblems displayed to users on the claim key portal.
                </p>
              </div>

              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg text-caption font-semibold transition-all disabled:opacity-50"
              >
                {profileSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-success-text" />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingProfile ? "Saving..." : "Save Profile"}</span>
                  </>
                )}
              </button>
            </div>

            {profileError && (
              <div className="p-3 bg-danger/10 border border-danger/30 text-danger-text rounded-lg text-caption flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{profileError}</span>
              </div>
            )}

            <div className="space-y-4 text-caption">
              {/* One-Click Sync from Guns.lol */}
              <div className="p-3.5 border border-accent/30 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-micro font-bold text-accent-text flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent-text" />
                    One-Click Sync from Guns.lol
                  </span>
                  {syncSuccess && <span className="text-micro text-success-text font-medium font-data">✓ Profile Synced!</span>}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={gunsUsername}
                    onChange={(e) => setGunsUsername(e.target.value)}
                    placeholder="guns.lol username or URL (e.g. revile or https://guns.lol/revile)"
                    className="flex-1 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-caption text-fg outline-none focus:border-accent font-data"
                  />
                  <button
                    type="button"
                    disabled={syncingGuns || !gunsUsername.trim()}
                    onClick={handleSyncGuns}
                    className="px-3.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg font-semibold text-caption transition-all flex items-center gap-1.5"
                  >
                    {syncingGuns ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    <span>{syncingGuns ? "Syncing..." : "Sync from Guns.lol"}</span>
                  </button>
                </div>
                {syncError && <p className="text-micro text-danger-text mt-1">{syncError}</p>}
              </div>

              {/* Avatar URL & Presets */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  Profile Picture (PFP URL)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={profile.avatar_url}
                    onChange={(e) => setProfile((p) => ({ ...p, avatar_url: e.target.value }))}
                    placeholder="https://..."
                    className="flex-1 bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-micro text-fg-subtle">Avatar Presets:</span>
                  {[
                    "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21",
                    "https://api.dicebear.com/7.x/identicon/svg?seed=TridentApex",
                    "https://api.dicebear.com/7.x/thumbs/svg?seed=ShadowDev",
                  ].map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setProfile((p) => ({ ...p, avatar_url: preset }))}
                      className="w-6 h-6 rounded-full overflow-hidden border border-line-strong hover:border-accent/60 transition-colors"
                    >
                      <img src={preset} alt="preset" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={profile.display_name}
                  onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
                  placeholder="e.g. Revile"
                  className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                />
              </div>

              {/* Bio */}
              <div>
                <label className="block text-fg font-semibold mb-1">
                  Bio / Description
                </label>
                <textarea
                  rows={2}
                  value={profile.bio}
                  onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
                  placeholder="Tell users about your scripts and development community..."
                  className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
                />
              </div>

              {/* Quick Badge Toggles & Custom Emblems */}
              <div className="pt-2 border-t border-line space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-fg font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent-text" />
                    Guns.lol Emblems & Badges
                  </label>
                  <span className="text-micro text-fg-subtle font-data">
                    {profile.emblems?.length || 0} active
                  </span>
                </div>

                {/* Quick Toggle Presets */}
                <div className="space-y-1.5">
                  <span className="text-micro text-fg-muted block font-medium">Quick Preset Badges:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {BADGE_PRESETS.map((bp) => {
                      const isActive = (profile.emblems || []).some((e) => e.label === bp.label);
                      return (
                        <button
                          key={bp.label}
                          type="button"
                          onClick={() => toggleBadgePreset(bp)}
                          className={`px-2.5 py-1 rounded-full text-micro font-semibold border flex items-center gap-1 transition-all ${
                            isActive
                              ? "bg-accent/20 border-accent/60 text-accent-text"
                              : "bg-surface border-line text-fg-muted hover:text-fg hover:border-line-strong"
                          }`}
                        >
                          {renderEmblemIcon(bp.icon)}
                          <span>{bp.label}</span>
                          <span className="text-micro font-bold">{isActive ? "✓" : "+"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active emblems pills */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {(profile.emblems || []).map((emb) => (
                    <div
                      key={emb.id}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-micro font-semibold border"
                      style={{
                        backgroundColor: `${emb.color || "#3b82f6"}15`,
                        borderColor: `${emb.color || "#3b82f6"}40`,
                        color: emb.color || "#3b82f6",
                      }}
                    >
                      {renderEmblemIcon(emb.icon)}
                      <span>{emb.label}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveEmblem(emb.id)}
                        className="ml-1 opacity-60 hover:opacity-100 hover:text-danger-text"
                        title="Remove emblem"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add new emblem row */}
                <div className="grid grid-cols-12 gap-2 pt-1">
                  <input
                    type="text"
                    value={newEmblemLabel}
                    onChange={(e) => setNewEmblemLabel(e.target.value)}
                    placeholder="Custom badge label..."
                    className="col-span-5 bg-surface border border-line-strong rounded-lg px-2.5 py-1.5 text-caption text-fg outline-none focus:border-accent"
                  />

                  <select
                    value={newEmblemIcon}
                    onChange={(e) => setNewEmblemIcon(e.target.value)}
                    className="col-span-4 bg-surface border border-line-strong rounded-lg px-2 py-1.5 text-caption text-fg outline-none focus:border-accent"
                  >
                    <option value="verified">Verified</option>
                    <option value="crown">Crown</option>
                    <option value="shield">Shield</option>
                    <option value="flame">Flame</option>
                    <option value="zap">Zap</option>
                    <option value="star">Star</option>
                    <option value="skull">Skull</option>
                  </select>

                  <div className="col-span-2 flex items-center justify-center bg-surface border border-line-strong rounded-lg p-1">
                    <input
                      type="color"
                      value={newEmblemColor}
                      onChange={(e) => setNewEmblemColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0"
                      title="Emblem color"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleAddEmblem}
                    className="col-span-1 flex items-center justify-center rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-bold"
                    title="Add Emblem"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* 9 Social Platforms Section */}
              <div className="pt-2 border-t border-line space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-fg font-semibold flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-accent-text" />
                    Social Media Platforms (9 Supported)
                  </label>
                  <span className="text-micro text-fg-subtle">Toggle on/off & set custom links</span>
                </div>

                <div className="space-y-2.5">
                  {SOCIAL_PLATFORMS.map((platform) => {
                    const isEnabled = profile.social_toggles?.[platform.key] !== false;
                    const currentValue = (profile.socials as Record<string, string | undefined>)[platform.key] || "";

                    return (
                      <div
                        key={platform.key}
                        className={`p-2.5 rounded-lg border transition-all ${
                          isEnabled
                            ? "bg-surface border-line"
                            : "bg-surface border-line-subtle opacity-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-5 h-5 rounded-md flex items-center justify-center text-fg"
                              style={{ backgroundColor: `${platform.color}30`, color: platform.color }}
                            >
                              <svg className="w-3 h-3 fill-current" viewBox="0 0 24 24">
                                <path d={platform.path} />
                              </svg>
                            </span>
                            <span className="text-caption font-semibold text-fg">{platform.name}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleSocialEnabled(platform.key)}
                            className={`px-2 py-0.5 rounded text-micro font-bold transition-colors ${
                              isEnabled
                                ? "bg-success/15 text-success-text border border-success/30"
                                : "bg-surface-hover text-fg-subtle"
                            }`}
                          >
                            {isEnabled ? "Visible" : "Hidden"}
                          </button>
                        </div>

                        <input
                          type="text"
                          value={currentValue}
                          disabled={!isEnabled}
                          onChange={(e) =>
                            setProfile((p) => ({
                              ...p,
                              socials: {
                                ...p.socials,
                                [platform.key]: e.target.value,
                              },
                            }))
                          }
                          placeholder={platform.placeholder}
                          className="w-full bg-surface-raised border border-line-strong rounded-lg px-2.5 py-1.5 text-caption text-fg outline-none focus:border-accent font-data"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Live Guns.lol Profile Card Simulator */}
          <div className="lg:col-span-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-caption font-bold text-fg-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent"></span> Live Guns.lol Card Simulator
              </h3>
              <span className="text-micro text-fg-subtle font-data">
                Shown to Claimants on /claim
              </span>
            </div>

            {/* Guns.lol Card Canvas */}
            <div className="p-4 rounded-lg border border-line relative overflow-hidden text-center flex flex-col items-center">
              {/* Background ambient lighting */}

              {/* Avatar with guns.lol glowing ring & status pulse */}
              <div className="relative mb-3.5 group">
                <div className="bg-accent hover:bg-accent-hover w-20 h-20 rounded-full p-1">
                  <img
                    src={profile.avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21"}
                    alt="avatar"
                    className="w-full h-full rounded-full object-cover bg-canvas"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21";
                    }}
                  />
                </div>
                <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-success border-2 border-surface-raised" />
              </div>

              {/* Display Name with Badges */}
              <h2 className="text-lg font-extrabold text-fg tracking-wide flex items-center justify-center gap-1.5">
                <span>{profile.display_name || "Revile"}</span>
                <span title="Verified Developer">
                  <Sparkles className="w-4 h-4 text-accent-text" />
                </span>
              </h2>

              {/* Emblems List */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 my-3">
                {(profile.emblems || []).map((emb) => (
                  <div
                    key={emb.id}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-micro font-bold tracking-wide border"
                    style={{
                      backgroundColor: `${emb.color || "#3b82f6"}15`,
                      borderColor: `${emb.color || "#3b82f6"}50`,
                      color: emb.color || "#3b82f6",
                    }}
                  >
                    {renderEmblemIcon(emb.icon)}
                    <span>{emb.label}</span>
                  </div>
                ))}
              </div>

              {/* Bio */}
              <p className="text-caption text-fg max-w-sm leading-relaxed mb-4">
                {profile.bio || "Lead Developer & Script Engineer."}
              </p>

              {/* Branded Social Links Bar */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {SOCIAL_PLATFORMS.map((platform) => {
                  const isEnabled = profile.social_toggles?.[platform.key] !== false;
                  const link = (profile.socials as Record<string, string | undefined>)[platform.key];
                  if (!isEnabled || !link) return null;

                  return (
                    <a
                      key={platform.key}
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-surface-hover hover:brightness-125 text-fg hover:text-fg transition-all text-caption font-semibold flex items-center gap-1.5 border border-line-strong"
                      style={{ borderLeftColor: platform.color, borderLeftWidth: "3px" }}
                    >
                      <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24" style={{ color: platform.color }}>
                        <path d={platform.path} />
                      </svg>
                      <span>{platform.name}</span>
                    </a>
                  );
                })}
              </div>

              {/* Simulated Script Key Claim Badge */}
              <div className="mt-5 w-full pt-4 border-t border-line flex items-center justify-between text-micro text-fg-muted">
                <span className="font-data">Gate Status: Active</span>
                <span className="text-success-text font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Ready for Claimants
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CHECKPOINT LOGS (completion / drop-off + bypass attempts) */}
      {activeTab === "bypass_attempts" && <CheckpointLogs scripts={scripts} />}
    </div>
  );
}
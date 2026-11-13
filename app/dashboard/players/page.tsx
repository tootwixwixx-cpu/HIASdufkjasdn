// app/dashboard/players/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Users,
  AlertTriangle,
  ShieldBan,
  Send,
  ShieldAlert,
  Check,
  RefreshCw,
  Clock,
  Laptop,
  Activity,
  Trash2,
  LayoutGrid,
  List,
  WifiOff,
  Wifi,
  X,
  Shield,
  EyeOff,
  UserCheck,
  Code2,
  Megaphone,
  Compass,
  Radio,
  Tv,
  Gamepad2,
  Sparkles,
  Search,
  MessageSquare,
  Mail,
  Ban,
} from "lucide-react";
import {
  Badge,
  StatusBadge,
  Button,
  Input,
  Textarea,
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
  Card,
  CardHeader,
  CardBody,
} from "@/components/ui";
import ChatroomManager from "@/components/ChatroomManager";
import DmsManager from "@/components/DmsManager";

interface StaffReviewItem {
  id: string;
  key_id: string;
  script_id: string;
  script_name: string;
  key_label: string;
  status: "reviewing" | "completed";
  review_started: string;
  last_heartbeat: string;
  duration_seconds: number;
  created_at: string;
  is_reviewing?: boolean;
}

interface GlobalAnnouncementItem {
  id: string;
  script_id: string;
  title: string;
  message: string;
  duration_seconds: number;
  created_at: string;
}

interface FarmCluster {
  id: string;
  type: "ip" | "hwid";
  identifier: string;
  accounts: { username: string; user_id?: string | null; session_id: string }[];
  session_ids: string[];
  count: number;
}

interface SessionItem {
  id: string;
  key_id: string;
  script_id: string;
  ip_address: string;
  hwid: string | null;
  roblox_username: string | null;
  roblox_user_id: string | null;
  avatar_url?: string | null;
  place_id?: string | null;
  place_name?: string | null;
  job_id?: string | null;
  status: "loading" | "active" | "kicked" | "tampered" | "expired" | "disconnected";
  tamper_flags: string[];
  session_started: string;
  last_heartbeat: string;
  is_online: boolean;
  duration_seconds: number;
  is_banned: boolean;
  last_ping_sec?: number;
  time_since_disconnect_sec?: number;
  is_farming?: boolean;
  farming_count?: number;
  farm_accounts?: string[];
  farm_cluster_id?: string;
  farm_type?: "ip" | "hwid";
}

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
  const initials = username ? username.substring(0, 2).toUpperCase() : "EX";

  const sizeClass =
    size === "sm"
      ? "w-7 h-7 rounded-lg text-micro"
      : size === "lg"
      ? "w-12 h-12 rounded-lg text-body-sm"
      : "w-10 h-10 rounded-lg text-caption";

  if (userId && !imgError) {
    return (
      <div className={`${sizeClass} overflow-hidden bg-surface-hover border border-line-strong shrink-0 relative flex items-center justify-center`}>
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
      className={`${sizeClass} border border-accent/30 flex items-center justify-center font-bold text-accent-text shrink-0`}
    >
      {initials}
    </div>
  );
}

export default function PlayersPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [farmingClusters, setFarmingClusters] = useState<FarmCluster[]>([]);
  const [staffActive, setStaffActive] = useState<StaffReviewItem[]>([]);
  const [staffHistory, setStaffHistory] = useState<StaffReviewItem[]>([]);
  const [bannedIps, setBannedIps] = useState<Record<string, { reason: string; banned_at: string }>>({});
  const [announcements, setAnnouncements] = useState<GlobalAnnouncementItem[]>([]);
  const [scriptsList, setScriptsList] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"sessions" | "announcements" | "staff" | "bans" | "chatroom" | "dms">("sessions");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [now, setNow] = useState(Date.now());

  // Message modal state
  const [messageModal, setMessageModal] = useState<{ sessionId: string; username: string } | null>(null);
  const [messageText, setMessageText] = useState("");

  // Code injection modal state
  const [codeModal, setCodeModal] = useState<{ sessionId: string; username: string } | null>(null);
  const [codeText, setCodeText] = useState('print("AtomProtect: Hello from dashboard!")');

  // Teleport modal state
  const [teleportModal, setTeleportModal] = useState<{ sessionId: string; username: string; placeId?: string } | null>(null);
  const [teleportMode, setTeleportMode] = useState<"hop" | "place">("hop");
  const [targetPlaceId, setTargetPlaceId] = useState("");

  // Broadcast announcement modal state
  const [announcementModal, setAnnouncementModal] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [announcementDuration, setAnnouncementDuration] = useState("10");
  const [announcementScript, setAnnouncementScript] = useState("all");

  // Manual Ban IP Modal state
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [banIpInput, setBanIpInput] = useState("");
  const [banReasonInput, setBanReasonInput] = useState("Manual ban from Admin Console");
  const [banFilterSearch, setBanFilterSearch] = useState("");
  const [banningIp, setBanningIp] = useState(false);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const removedSessionIdsRef = useRef<Set<string>>(new Set());
  const serverSkewRef = useRef<number>(0);

  const fetchPlayers = async () => {
    try {
      const res = await fetch("/api/players");
      const data = await res.json();
      if (data.server_time) {
        serverSkewRef.current = Date.now() - new Date(data.server_time).getTime();
      }
      if (data.sessions) {
        // Exclude sessions already pruned locally and ensure only online sessions
        const fresh = (data.sessions as SessionItem[]).filter(
          (s) => !removedSessionIdsRef.current.has(s.id) && s.is_online !== false
        );
        setSessions(fresh);
      }
      if (data.farming_clusters) setFarmingClusters(data.farming_clusters);
      if (data.banned_ips) setBannedIps(data.banned_ips);
      if (data.staff_active) setStaffActive(data.staff_active);
      if (data.staff_history) setStaffHistory(data.staff_history);
      if (data.announcements) setAnnouncements(data.announcements);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/scripts")
      .then((res) => res.json())
      .then((json) => {
        if (json.scripts) setScriptsList(json.scripts);
      })
      .catch(() => {});
  }, []);

  // Local live clock ticker every 500ms to calculate live pings and freeze disconnected timers
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => clearInterval(clockInterval);
  }, []);

  // Telemetry polling from server every 2 seconds
  useEffect(() => {
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 2000);
    return () => clearInterval(interval);
  }, []);

  // Remove card handler
  const handleRemoveCard = async (sessionId: string) => {
    removedSessionIdsRef.current.add(sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_card", session_id: sessionId }),
      });
    } catch {
      // ignore
    }
  };

  // Let the server-side telemetry debounce (15s timeout with 15s grace period) govern session pruning smoothly.

  const handleKick = async (sessionId: string) => {
    if (!confirm("Kick this player off the script? Their in-game script will terminate immediately.")) return;
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kick", session_id: sessionId }),
      });
      showNotice("Player kicked from script.");
      fetchPlayers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleBanIp = async (ip: string) => {
    const reason = prompt("Enter ban reason:", "Violated Terms of Service / Script Tampering");
    if (!reason) return;
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ban_ip", ip_address: ip, reason }),
      });
      showNotice(`IP ${ip} has been permanently banned.`);
      fetchPlayers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUnbanIp = async (ip: string) => {
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unban_ip", ip_address: ip }),
      });
      showNotice(`IP ${ip} unbanned.`);
      fetchPlayers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDirectBanIp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!banIpInput.trim()) return;
    setBanningIp(true);
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ban_ip",
          ip_address: banIpInput.trim(),
          reason: banReasonInput.trim() || "Manual ban from Admin Console",
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice(`IP ${banIpInput.trim()} has been permanently banned.`);
        setBanIpInput("");
        setBanReasonInput("Manual ban from Admin Console");
        setBanModalOpen(false);
        fetchPlayers();
      } else {
        alert(data.error || "Failed to ban IP");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBanningIp(false);
    }
  };

  const handleKickFarm = async (cluster: FarmCluster) => {
    if (!confirm(`Terminate all ${cluster.count} concurrent sessions in this farming cluster?`)) return;
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "kick_farm",
          session_ids: cluster.session_ids,
          ip_address: cluster.type === "ip" ? cluster.identifier : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice(data.message || `Terminated ${cluster.count} farming sessions.`);
        fetchPlayers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBanFarm = async (cluster: FarmCluster) => {
    const ip = cluster.type === "ip" ? cluster.identifier : prompt("Enter IP to ban for this farming cluster:");
    if (!ip) return;
    if (!confirm(`Permanently ban IP ${ip} and terminate all ${cluster.count} alt sessions?`)) return;
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ban_farm",
          ip_address: ip,
          session_ids: cluster.session_ids,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice(data.message || `Banned IP ${ip} and terminated alt sessions.`);
        fetchPlayers();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendMessage = async () => {
    if (!messageModal || !messageText.trim()) return;
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          session_id: messageModal.sessionId,
          message: messageText,
        }),
      });
      showNotice(`Dismissable message sent to ${messageModal.username}!`);
      setMessageModal(null);
      setMessageText("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleExecuteCode = async () => {
    if (!codeModal || !codeText.trim()) return;
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_code",
          session_id: codeModal.sessionId,
          code: codeText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice(`Luau code dispatched to ${codeModal.username}!`);
        setCodeModal(null);
      } else {
        alert(data.error || "Failed to dispatch code.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTeleport = async () => {
    if (!teleportModal) return;
    const isHop = teleportMode === "hop";
    if (!isHop && !targetPlaceId.trim()) {
      alert("Please enter a valid Place ID to teleport the player.");
      return;
    }
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "teleport",
          session_id: teleportModal.sessionId,
          server_hop: isHop,
          place_id: isHop ? undefined : Number(targetPlaceId.trim()),
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice(
          isHop
            ? `Server hop sent to ${teleportModal.username}!`
            : `Teleport to place ${targetPlaceId} sent to ${teleportModal.username}!`
        );
        setTeleportModal(null);
        setTargetPlaceId("");
      } else {
        alert(data.error || "Teleport failed.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBroadcastAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      alert("Please enter both a title and message for the announcement.");
      return;
    }
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "broadcast_announcement",
          script_id: announcementScript,
          title: announcementTitle.trim(),
          message: announcementMessage.trim(),
          duration_seconds: Number(announcementDuration) || 10,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showNotice("In-Game Global Announcement broadcasted!");
        setAnnouncementModal(false);
        setAnnouncementTitle("");
        setAnnouncementMessage("");
        fetchPlayers();
      } else {
        alert(data.error || "Failed to broadcast announcement.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    try {
      await fetch("/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_announcement", id }),
      });
      showNotice("Announcement removed.");
      fetchPlayers();
    } catch (err) {
      console.error(err);
    }
  };

  const showNotice = (msg: string) => {
    setActionSuccess(msg);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  // Compute live properties for each player based on current timestamp
  // Ticker updates duration and ping smoothly; server poll sets the active player list
  const processedSessions = sessions.map((s) => {
    const adjustedNow = now - (serverSkewRef.current || 0);
    const lastPingTime = new Date(s.last_heartbeat).getTime();
    const startTime = s.session_started ? new Date(s.session_started).getTime() : lastPingTime;
    const pingElapsedMs = Math.max(0, adjustedNow - lastPingTime);

    return {
      ...s,
      is_online: true,
      duration_seconds: Math.max(0, Math.floor((adjustedNow - startTime) / 1000)),
      ping_sec: Math.max(0, Math.floor(pingElapsedMs / 1000)),
      removal_countdown_sec: 0,
      time_since_disconnect_sec: 0,
    };
  });

  const onlineCount = processedSessions.length;
  const bannedCount = Object.keys(bannedIps).length;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-heading font-semibold text-fg">
            Players & sessions
            <Badge tone="success" dot mono>
              {onlineCount} online
            </Badge>
          </h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Live player monitoring. Sessions disconnect after 15 seconds of silence and are cleared automatically.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setBanModalOpen(true)} title="Ban any IP address immediately">
            <ShieldBan />
            Ban IP
          </Button>
          <Button size="sm" onClick={() => setAnnouncementModal(true)} title="Broadcast a live announcement to in-game sessions">
            <Megaphone />
            Broadcast
          </Button>

          {/* Toggle view: cards vs table */}
          <Tabs variant="segmented" value={viewMode} onValueChange={(v) => setViewMode(v as "cards" | "table")}>
            <TabsList>
              <TabsTrigger value="cards" title="Player cards view" aria-label="Cards view">
                <LayoutGrid />
              </TabsTrigger>
              <TabsTrigger value="table" title="Table view" aria-label="Table view">
                <List />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button size="sm" iconOnly onClick={fetchPlayers} title="Refresh telemetry" aria-label="Refresh telemetry">
            <RefreshCw />
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-body-sm text-success-text">
          <Check className="size-4" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="sessions" count={onlineCount}>
            Active players
            {staffActive.length > 0 && (
              <Badge tone="accent" className="h-4 px-1">
                {staffActive.length} staff
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="announcements" count={announcements.length}>
            <Megaphone />
            Announcements
          </TabsTrigger>
          <TabsTrigger value="staff" count={staffHistory.length}>
            <Shield />
            Staff history
          </TabsTrigger>
          <TabsTrigger value="chatroom">
            <MessageSquare />
            Chatroom
          </TabsTrigger>
          <TabsTrigger value="dms">
            <Mail />
            DMs
          </TabsTrigger>
          <TabsTrigger value="bans" count={bannedCount}>
            <Ban />
            Banned IPs
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* SESSIONS TAB */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          {/* Active Staff Reviews (Zero Logging / Protected) */}
          {staffActive.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-accent" />
                  <h2 className="text-caption font-bold text-accent-text flex items-center gap-2">
                    <Shield className="w-4 h-4 text-accent-text" />
                    Staff Review Active ({staffActive.length})
                  </h2>
                </div>
                <span className="text-micro text-accent-text font-data">
                  Anonymous Session • Zero Telemetry Stored
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {staffActive.map((staff) => {
                  const startTime = new Date(staff.review_started).getTime();
                  const liveDuration = Math.max(0, Math.floor((now - startTime) / 1000));

                  return (
                    <div
                      key={staff.id}
                      className="border border-accent/30 bg-surface-raised rounded-lg p-4 flex flex-col justify-between relative overflow-hidden"
                    >
                      {/* Top Ambient Accent */}

                      <div>
                        {/* Header: Title and Status Badge */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center text-accent-text shrink-0">
                              <Shield className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-body-sm font-bold text-fg">Staff Reviewing</h3>
                                <span className="px-1.5 py-0.5 rounded text-micro font-data font-bold bg-accent/30 text-accent-text border border-accent/40">
                                  STAFF
                                </span>
                              </div>
                              <span className="text-micro text-accent-text block mt-0.5">
                                Official Script Review
                              </span>
                            </div>
                          </div>

                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-micro font-semibold bg-accent/20 text-accent-text border border-accent/40 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                            Reviewing
                          </span>
                        </div>

                        {/* Review Duration & Script Info */}
                        <div className="mt-4 p-3.5 rounded-lg bg-accent/10 border border-accent/20 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-micro text-fg-muted font-semibold flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-accent-text" />
                              Review Duration
                            </span>
                            <span className="text-body-sm font-data font-bold text-accent-text">
                              {formatDuration(liveDuration)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-accent/15 text-caption">
                            <span className="text-micro text-fg-muted font-medium">Target Script:</span>
                            <span className="font-semibold text-fg truncate max-w-[170px]" title={staff.script_name}>
                              {staff.script_name || "All Scripts"}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-caption">
                            <span className="text-micro text-fg-muted font-medium">Started At:</span>
                            <span className="font-data text-micro text-fg">
                              {new Date(staff.review_started).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>

                        {/* Anonymity / Zero-Logging Guarantee Notice */}
                        <div className="mt-3 p-2.5 rounded-lg bg-canvas/40 border border-accent/20 text-micro text-accent-text flex items-center gap-2">
                          <EyeOff className="w-4 h-4 text-accent-text shrink-0" />
                          <span>
                            Zero logs stored. Reviewer identity, IP, and HWID are fully protected and untracked.
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ALT / MULTI-ACCOUNT FARMING DETECTOR BANNER */}
          {farmingClusters.length > 0 && (
            <div className="p-4 rounded-lg border border-warning/40 bg-warning/[0.04] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-warning/20 border border-warning/40 flex items-center justify-center text-warning-text shrink-0">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-caption font-bold text-warning-text flex items-center gap-2">
                      Multi-Account Farming Detected ({farmingClusters.length} {farmingClusters.length === 1 ? "Cluster" : "Clusters"})
                    </h3>
                    <p className="text-micro text-warning-text">
                      Concurrent Roblox accounts detected operating from identical network IP addresses or hardware identifiers.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {farmingClusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className="p-3 rounded-lg bg-surface border border-warning/30 flex flex-col justify-between gap-3 text-caption"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-data text-fg font-semibold flex items-center gap-1.5">
                          <span className="text-micro px-1.5 py-0.5 rounded bg-surface-hover text-fg-muted font-bold">
                            {cluster.type.toUpperCase()}
                          </span>
                          {cluster.identifier}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-micro font-bold bg-warning/20 text-warning-text border border-warning/40">
                          {cluster.count} Linked Accounts
                        </span>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {cluster.accounts.map((acc, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface border border-line text-micro text-fg"
                          >
                            <RobloxAvatar userId={acc.user_id} username={acc.username} size="sm" />
                            <span className="font-medium text-fg">{acc.username}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-line">
                      <button
                        type="button"
                        onClick={() => handleKickFarm(cluster)}
                        className="flex-1 py-1 px-2 rounded-lg bg-warning/15 hover:bg-warning/30 text-warning-text border border-warning/30 text-micro font-semibold transition-colors flex items-center justify-center gap-1"
                        title="Kick all accounts in this cluster immediately"
                      >
                        <ShieldAlert className="w-3 h-3" />
                        Mass-Kick Farm ({cluster.count})
                      </button>

                      {cluster.type === "ip" && (
                        <button
                          type="button"
                          onClick={() => handleBanFarm(cluster)}
                          className="py-1 px-2.5 rounded-lg bg-danger/15 hover:bg-danger/30 text-danger-text border border-danger/30 text-micro font-semibold transition-colors flex items-center justify-center gap-1"
                          title="Ban this IP and terminate all concurrent alt sessions"
                        >
                          <ShieldBan className="w-3 h-3" />
                          Ban IP
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-caption text-fg-subtle bg-surface-raised rounded-lg border border-line">
              Loading player telemetry...
            </div>
          ) : processedSessions.length === 0 ? (
            staffActive.length === 0 && (
              <div className="text-center py-16 bg-surface-raised border border-line rounded-lg p-4">
                <Users className="w-10 h-10 text-fg-disabled mx-auto mb-3" />
                <p className="text-body-sm text-fg font-semibold">No active players right now</p>
                <p className="text-caption text-fg-subtle mt-1 max-w-md mx-auto">
                  Players currently executing your script in Roblox will show up here live with real-time ping telemetry.
                </p>
              </div>
            )
          ) : viewMode === "cards" ? (
            /* CARDS GRID VIEW */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {processedSessions.map((s) => {
                const cardKey = s.roblox_user_id && s.roblox_user_id !== "0"
                  ? `card_uid_${s.roblox_user_id}`
                  : s.roblox_username && s.roblox_username !== "Player"
                  ? `card_user_${s.roblox_username}`
                  : `card_id_${s.id}`;
                return (
                <div
                  key={cardKey}
                  className={`bg-surface border rounded-lg p-4 flex flex-col justify-between transition-all duration-300 relative overflow-hidden ${
                    s.is_farming
                      ? "border-warning/40 hover:border-warning/60"
                      : "border-success/30 hover:border-success/50"
                  }`}
                >
                  {/* Card Header: Avatar, Name, Status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar Headshot */}
                      <RobloxAvatar userId={s.roblox_user_id} username={s.roblox_username} size="md" />

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-body-sm font-bold text-fg truncate">
                            {s.roblox_username || "Executor User"}
                          </h3>
                          {s.is_farming && (
                            <span
                              className="px-1.5 py-0.5 rounded text-micro font-bold bg-warning/20 text-warning-text border border-warning/40 tracking-tight flex items-center gap-1"
                              title={`Alt Farming Cluster: Running alongside ${s.farm_accounts?.join(", ")}`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5 text-warning-text" />
                              FARM: {s.farming_count}x
                            </span>
                          )}
                        </div>
                        {s.roblox_user_id && (
                          <span className="text-micro font-data text-fg-subtle block truncate">
                            UID: {s.roblox_user_id}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Pill */}
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-micro font-semibold bg-success/10 text-success-text border border-success/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                        Active
                      </span>
                    </div>
                  </div>

                  {/* Disconnected Notice Banner on Card */}
                  {!s.is_online && (
                    <div className="mt-3 p-2 rounded-lg bg-danger/10 border border-danger/25 text-micro text-danger-text flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-danger"></span>
                        Session ended.
                      </span>
                      <span className="text-micro text-fg-muted font-data">
                        Clearing in {s.removal_countdown_sec}s
                      </span>
                    </div>
                  )}

                  {/* Alt Farming Cluster Notice on Card */}
                  {s.is_farming && s.farm_accounts && s.farm_accounts.length > 0 && (
                    <div className="mt-2.5 p-2 rounded-lg bg-warning/10 border border-warning/25 text-micro text-warning-text">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-warning-text" />
                          Multi-Account Farm
                        </span>
                        <span className="text-micro font-data bg-warning/20 px-1.5 py-0.5 rounded text-warning-text">
                          {s.farming_count} Alts Active
                        </span>
                      </div>
                      <p className="text-micro text-warning-text mt-1 truncate">
                        Linked Alts: {s.farm_accounts.join(", ")}
                      </p>
                    </div>
                  )}

                  {/* Stats Grid */}
                  <div className="grid grid-cols-2 gap-2 mt-4 py-3 border-y border-line-subtle text-caption">
                    <div>
                      <span className="text-micro text-fg-subtle block font-semibold">
                        Playtime (Frozen on Quit)
                      </span>
                      <div className="flex items-center gap-1.5 font-data text-fg mt-0.5">
                        <Clock className="w-3.5 h-3.5 text-accent-text" />
                        <span className="font-semibold">{formatDuration(s.duration_seconds)}</span>
                      </div>
                    </div>

                    <div>
                      <span className="text-micro text-fg-subtle block font-semibold">
                        Heartbeat Telemetry
                      </span>
                      <div className="flex items-center gap-1.5 font-data text-fg mt-0.5">
                        <Activity
                          className={`w-3.5 h-3.5 ${
                            s.is_online ? "text-success-text" : "text-fg-subtle"
                          }`}
                        />
                        <span>{s.is_online ? `${s.ping_sec}s ago` : "Lost connection"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Device, Network & Game Details */}
                  <div className="mt-3 space-y-1 text-micro text-fg-muted">
                    {s.place_id && (
                      <div className="flex items-center justify-between">
                        <span className="text-fg-subtle flex items-center gap-1">
                          <Gamepad2 className="w-3 h-3 text-accent-text" />
                          Game:
                        </span>
                        <span className="font-data text-accent-text font-semibold truncate max-w-[160px]" title={s.place_name || String(s.place_id)}>
                          {s.place_name || `Place #${s.place_id}`}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-fg-subtle">IP:</span>
                      <span className="font-data text-fg">
                        {s.ip_address}
                        {s.is_banned && (
                          <span className="text-danger-text font-bold ml-1">[BANNED]</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center justify-between truncate">
                      <span className="text-fg-subtle">HWID:</span>
                      <span className="font-data text-fg-muted truncate max-w-[150px]">
                        {s.hwid || "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-4 gap-1.5 mt-4 pt-3 border-t border-line-subtle">
                    <button
                      type="button"
                      onClick={() =>
                        setMessageModal({
                          sessionId: s.id,
                          username: s.roblox_username || s.ip_address,
                        })
                      }
                      className="py-1.5 px-2 rounded-lg bg-accent/15 hover:bg-accent/30 text-accent-text border border-accent/25 text-micro font-semibold transition-colors flex items-center justify-center gap-1"
                      title="Send In-Game Message"
                    >
                      <Send className="w-3 h-3" />
                      Msg
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setCodeModal({
                          sessionId: s.id,
                          username: s.roblox_username || s.ip_address,
                        })
                      }
                      className="py-1.5 px-2 rounded-lg bg-success/15 hover:bg-success/30 text-success-text border border-success/25 text-micro font-semibold transition-colors flex items-center justify-center gap-1"
                      title="Inject Luau Code into session"
                    >
                      <Code2 className="w-3 h-3" />
                      Code
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setTeleportModal({
                          sessionId: s.id,
                          username: s.roblox_username || s.ip_address,
                          placeId: s.place_id || undefined,
                        })
                      }
                      className="py-1.5 px-2 rounded-lg bg-accent/15 hover:bg-accent/30 text-accent-text border border-accent/25 text-micro font-semibold transition-colors flex items-center justify-center gap-1"
                      title="Server Hop or Teleport Place"
                    >
                      <Compass className="w-3 h-3" />
                      Hop
                    </button>

                    <button
                      type="button"
                      onClick={() => handleKick(s.id)}
                      className="py-1.5 px-2 rounded-lg bg-warning/15 hover:bg-warning/30 text-warning-text border border-warning/25 text-micro font-semibold transition-colors flex items-center justify-center"
                      title="Remote kick"
                    >
                      Kick
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          ) : (
            /* TABLE LIST VIEW */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Roblox player</TableHead>
                  <TableHead>IP address</TableHead>
                  <TableHead>HWID</TableHead>
                  <TableHead align="right">Session</TableHead>
                  <TableHead align="right">Heartbeat</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processedSessions.length === 0 ? (
                  <TableEmpty colSpan={7} title="No players online" description="Sessions appear here as soon as a loader sends its first heartbeat." />
                ) : (
                  processedSessions.map((s) => {
                    const rowKey = s.roblox_user_id && s.roblox_user_id !== "0"
                      ? `row_uid_${s.roblox_user_id}`
                      : s.roblox_username && s.roblox_username !== "Player"
                      ? `row_user_${s.roblox_username}`
                      : `row_id_${s.id}`;
                    return (
                      <TableRow key={rowKey}>
                        <TableCell>
                          <StatusBadge status="online" />
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center gap-2">
                            <RobloxAvatar userId={s.roblox_user_id} username={s.roblox_username} size="sm" />
                            <span className="font-medium text-fg">{s.roblox_username || "Executor user"}</span>
                            {s.roblox_user_id && (
                              <span className="font-data text-micro text-fg-subtle">{s.roblox_user_id}</span>
                            )}
                            {s.is_farming && (
                              <Badge tone="warning" mono>
                                farm {s.farming_count}x
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell mono>
                          <span className={s.is_banned ? "text-danger-text line-through" : ""}>{s.ip_address}</span>
                          {s.is_banned && <StatusBadge status="banned" dot={false} className="ml-1.5" />}
                        </TableCell>
                        <TableCell mono muted truncate={140} title={s.hwid || undefined}>
                          {s.hwid || "-"}
                        </TableCell>
                        <TableCell mono align="right">
                          {formatDuration(s.duration_seconds)}
                          {!s.is_online && <span className="ml-1 text-fg-subtle">(frozen)</span>}
                        </TableCell>
                        <TableCell mono muted align="right">
                          {s.is_online ? `${s.ping_sec}s ago` : "Offline"}
                        </TableCell>
                        <TableCell align="right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                setMessageModal({
                                  sessionId: s.id,
                                  username: s.roblox_username || s.ip_address,
                                })
                              }
                              title="Send message"
                            >
                              Message
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                setCodeModal({
                                  sessionId: s.id,
                                  username: s.roblox_username || s.ip_address,
                                })
                              }
                              title="Run Luau code"
                            >
                              Code
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() =>
                                setTeleportModal({
                                  sessionId: s.id,
                                  username: s.roblox_username || s.ip_address,
                                  placeId: s.place_id || undefined,
                                })
                              }
                              title="Server hop / teleport"
                            >
                              Hop
                            </Button>
                            {s.is_farming && (
                              <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => {
                                  const cl = farmingClusters.find((c) => c.identifier === s.ip_address || (s.hwid && c.identifier === s.hwid));
                                  if (cl) handleKickFarm(cl);
                                  else handleKick(s.id);
                                }}
                                className="text-warning-text hover:bg-warning/10 hover:text-warning-text"
                                title="Kick all alts in this farm cluster"
                              >
                                Kick farm
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleKick(s.id)}
                              className="hover:bg-warning/10 hover:text-warning-text"
                              title="Kick player"
                            >
                              Kick
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => handleBanIp(s.ip_address)}
                              className="hover:bg-danger/10 hover:text-danger-text"
                              title="Ban IP address"
                            >
                              Ban IP
                            </Button>
                            {!s.is_online && (
                              <Button
                                variant="ghost"
                                size="xs"
                                iconOnly
                                onClick={() => handleRemoveCard(s.id)}
                                title="Dismiss"
                                aria-label="Dismiss"
                              >
                                <X />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {/* STAFF HISTORY TAB */}
      {activeTab === "staff" && (
        <div className="space-y-2">
          <p className="text-body-sm text-fg-muted">
            Audit log of past and ongoing staff reviews and how long they ran. Reviewer details are never logged.
          </p>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Script</TableHead>
                <TableHead>Script ID</TableHead>
                <TableHead>Key label</TableHead>
                <TableHead>Started</TableHead>
                <TableHead align="right">Duration</TableHead>
                <TableHead align="right">Logging</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffHistory.length === 0 ? (
                <TableEmpty
                  colSpan={7}
                  title="No staff reviews yet"
                  description="When staff run your script with a staff review key, the review shows up here."
                />
              ) : (
                staffHistory.map((item) => {
                  const isCurrentlyActive = staffActive.some((a) => a.id === item.id);
                  const startTime = new Date(item.review_started).getTime();
                  const liveDurationSec = isCurrentlyActive
                    ? Math.max(0, Math.floor((now - startTime) / 1000))
                    : item.duration_seconds;

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        {isCurrentlyActive ? (
                          <Badge tone="accent" dot>
                            Reviewing
                          </Badge>
                        ) : (
                          <Badge>Completed</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{item.script_name || "All scripts"}</TableCell>
                      <TableCell mono muted truncate={160}>
                        {item.script_id}
                      </TableCell>
                      <TableCell mono>{item.key_label || "Staff review key"}</TableCell>
                      <TableCell mono muted>
                        {new Date(item.review_started).toLocaleDateString()} {new Date(item.review_started).toLocaleTimeString()}
                      </TableCell>
                      <TableCell mono align="right" className="text-fg">
                        {formatDuration(liveDurationSec)}
                      </TableCell>
                      <TableCell align="right">
                        <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
                          <EyeOff className="size-3" />
                          Nothing stored
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* BANNED IPS TAB */}
      {activeTab === "bans" && (
        <div className="space-y-4">
          {/* Quick manual ban */}
          <Card>
            <CardHeader
              divided
              title="Ban an IP"
              description="Blocks the IP from claiming keys, running loaders and verifying sessions, effective immediately."
            />
            <CardBody>
              <form onSubmit={handleDirectBanIp} className="grid grid-cols-1 items-end gap-3 md:grid-cols-12">
                <Field label="IP address" htmlFor="bans-ip" className="md:col-span-4">
                  <Input
                    id="bans-ip"
                    mono
                    value={banIpInput}
                    onChange={(e) => setBanIpInput(e.target.value)}
                    placeholder="e.g. 104.28.14.2"
                    required
                  />
                </Field>
                <Field label="Reason" htmlFor="bans-reason" className="md:col-span-5">
                  <Input
                    id="bans-reason"
                    value={banReasonInput}
                    onChange={(e) => setBanReasonInput(e.target.value)}
                    placeholder="e.g. Tampering, scraper, alt abuse"
                  />
                </Field>
                <div className="md:col-span-3">
                  <Button type="submit" variant="danger" className="w-full" loading={banningIp} disabled={!banIpInput.trim()}>
                    <ShieldBan />
                    Ban IP
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>

          {/* Active bans */}
          <div>
            <TableToolbar className="justify-between">
              <div className="flex items-baseline gap-2">
                <h3 className="text-title font-semibold text-fg">IP blacklist</h3>
                <span className="font-data text-caption text-fg-subtle">{Object.keys(bannedIps).length}</span>
              </div>
              <Input
                size="sm"
                value={banFilterSearch}
                onChange={(e) => setBanFilterSearch(e.target.value)}
                placeholder="Search IP or reason"
                aria-label="Search banned IPs"
                leading={<Search />}
                className="w-full sm:w-64"
              />
            </TableToolbar>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Banned at</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(bannedIps).length === 0 ? (
                  <TableEmpty colSpan={4} title="No banned IPs" description="Ban an IP above or from a player row." />
                ) : (
                  Object.entries(bannedIps)
                    .filter(([ip, data]) => {
                      if (!banFilterSearch.trim()) return true;
                      const q = banFilterSearch.toLowerCase();
                      return ip.toLowerCase().includes(q) || (data.reason || "").toLowerCase().includes(q);
                    })
                    .map(([ip, data]) => (
                      <TableRow key={ip}>
                        <TableCell mono className="text-danger-text">
                          {ip}
                        </TableCell>
                        <TableCell truncate={420}>{data.reason}</TableCell>
                        <TableCell mono muted>
                          {new Date(data.banned_at).toLocaleString()}
                        </TableCell>
                        <TableCell align="right">
                          <Button size="xs" onClick={() => handleUnbanIp(ip)}>
                            Unban
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* IN-GAME ANNOUNCEMENTS TAB */}
      {activeTab === "announcements" && (
        <div>
          <TableToolbar className="justify-between">
            <p className="text-body-sm text-fg-muted">
              Banners slide into players&apos; screens on their next heartbeat.
            </p>
            <Button variant="primary" size="sm" onClick={() => setAnnouncementModal(true)}>
              <Megaphone />
              New announcement
            </Button>
          </TableToolbar>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Announcement</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead align="right">Duration</TableHead>
                <TableHead>Sent at</TableHead>
                <TableHead align="right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {announcements.length === 0 ? (
                <TableEmpty
                  colSpan={5}
                  title="No announcements sent yet"
                  description="Broadcast one to show a live banner to every connected player."
                  action={
                    <Button size="sm" onClick={() => setAnnouncementModal(true)}>
                      <Megaphone />
                      New announcement
                    </Button>
                  }
                />
              ) : (
                announcements.map((a) => {
                  const targetScript = scriptsList.find((s) => s.id === a.script_id);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="py-1">
                        <span className="block font-medium text-fg">{a.title}</span>
                        <span className="block max-w-md truncate text-caption text-fg-muted" title={a.message}>
                          {a.message}
                        </span>
                      </TableCell>
                      <TableCell muted>
                        {a.script_id === "all" ? "All scripts" : targetScript ? targetScript.name : a.script_id}
                      </TableCell>
                      <TableCell mono align="right">
                        {a.duration_seconds}s
                      </TableCell>
                      <TableCell mono muted>
                        {new Date(a.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          variant="ghost"
                          size="xs"
                          iconOnly
                          onClick={() => handleDeleteAnnouncement(a.id)}
                          title="Delete announcement record"
                          aria-label="Delete announcement record"
                          className="hover:bg-danger/10 hover:text-danger-text"
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* GLOBAL CHATROOM TAB */}
      {activeTab === "chatroom" && <ChatroomManager />}

      {/* DMS / CONTACT DEV TAB */}
      {activeTab === "dms" && <DmsManager />}

      {/* In-game message */}
      <Modal
        open={!!messageModal}
        onClose={() => setMessageModal(null)}
        title="Send in-game message"
        description={
          <>
            Shows a dismissable popup to <strong className="font-data text-fg">{messageModal?.username}</strong>.
          </>
        }
        footer={
          <>
            <Button onClick={() => setMessageModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleSendMessage}>
              <Send />
              Send to player
            </Button>
          </>
        }
      >
        <Field label="Message" htmlFor="player-message">
          <Textarea
            id="player-message"
            rows={3}
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="e.g. Server maintenance starts in 5 minutes."
          />
        </Field>
      </Modal>

      {/* Remote Luau code */}
      <Modal
        open={!!codeModal}
        onClose={() => setCodeModal(null)}
        size="lg"
        title="Run Luau code remotely"
        description={
          <>
            Runs in <strong className="font-data text-fg">{codeModal?.username}</strong>&apos;s Roblox session on the next heartbeat.
          </>
        }
        footer={
          <>
            <Button onClick={() => setCodeModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleExecuteCode}>
              <Code2 />
              Run code
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-caption text-fg-subtle">Templates</span>
            <Button size="xs" onClick={() => setCodeText('print("Aero Auth: Hello from dashboard!")')}>
              Print test
            </Button>
            <Button
              size="xs"
              onClick={() =>
                setCodeText('pcall(function() game.Players.LocalPlayer.Character.Humanoid.WalkSpeed = 48 end)')
              }
            >
              Speed 48
            </Button>
            <Button
              size="xs"
              onClick={() =>
                setCodeText(
                  'game:GetService("StarterGui"):SetCore("SendNotification", { Title = "Aero Auth", Text = "Admin executed remote code in your session.", Duration = 6 })'
                )
              }
            >
              Client notification
            </Button>
          </div>
          <Textarea
            mono
            rows={10}
            value={codeText}
            onChange={(e) => setCodeText(e.target.value)}
            placeholder={"-- Luau code to run in game\nprint('Hello Roblox')"}
            aria-label="Luau code"
            spellCheck={false}
          />
        </div>
      </Modal>

      {/* Teleport / server hop */}
      <Modal
        open={!!teleportModal}
        onClose={() => setTeleportModal(null)}
        title="Teleport player"
        description={
          <>
            Move <strong className="font-data text-fg">{teleportModal?.username}</strong> to another server or place.
          </>
        }
        footer={
          <>
            <Button onClick={() => setTeleportModal(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleTeleport}>
              <Compass />
              Teleport
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Tabs variant="segmented" value={teleportMode} onValueChange={(v) => setTeleportMode(v as "hop" | "place")}>
            <TabsList className="flex w-full">
              <TabsTrigger value="hop" className="flex-1 justify-center">
                Server hop (same game)
              </TabsTrigger>
              <TabsTrigger value="place" className="flex-1 justify-center">
                Place ID
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {teleportMode === "hop" ? (
            <p className="text-body-sm text-fg-muted">
              Finds another public server of the same game through the Roblox Games API and teleports the player there.
            </p>
          ) : (
            <Field
              label="Roblox place ID"
              htmlFor="teleport-place"
              hint={
                <>
                  Calls <code className="font-data text-fg-muted">TeleportService:Teleport(placeId)</code> in the player&apos;s session.
                </>
              }
            >
              <Input
                id="teleport-place"
                mono
                value={targetPlaceId}
                onChange={(e) => setTargetPlaceId(e.target.value)}
                placeholder="e.g. 189707"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Global announcement */}
      <Modal
        open={announcementModal}
        onClose={() => setAnnouncementModal(false)}
        title="Broadcast announcement"
        description="Shows a banner at the top of every connected player's screen."
        footer={
          <>
            <Button onClick={() => setAnnouncementModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleBroadcastAnnouncement}>
              <Megaphone />
              Broadcast
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Script scope" htmlFor="ann-script">
            <Select id="ann-script" value={announcementScript} onChange={(e) => setAnnouncementScript(e.target.value)}>
              <option value="all">All scripts (global)</option>
              {scriptsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (/{s.slug})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Banner title" htmlFor="ann-title">
            <Input
              id="ann-title"
              value={announcementTitle}
              onChange={(e) => setAnnouncementTitle(e.target.value)}
              placeholder="e.g. System update"
            />
          </Field>
          <Field label="Message" htmlFor="ann-message">
            <Textarea
              id="ann-message"
              rows={3}
              value={announcementMessage}
              onChange={(e) => setAnnouncementMessage(e.target.value)}
              placeholder="e.g. v2.4 is out. Re-execute to get the new features."
            />
          </Field>
          <Field label="On screen for" htmlFor="ann-duration">
            <Select id="ann-duration" value={announcementDuration} onChange={(e) => setAnnouncementDuration(e.target.value)}>
              <option value="5">5 seconds</option>
              <option value="10">10 seconds (default)</option>
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
              <option value="60">60 seconds</option>
            </Select>
          </Field>
        </div>
      </Modal>

      {/* Manual IP ban */}
      <Modal
        open={banModalOpen}
        onClose={() => setBanModalOpen(false)}
        title="Ban IP address"
        footer={
          <>
            <Button onClick={() => setBanModalOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="ban-ip-form"
              variant="danger"
              loading={banningIp}
              disabled={!banIpInput.trim()}
            >
              <ShieldBan />
              Ban IP
            </Button>
          </>
        }
      >
        <form id="ban-ip-form" onSubmit={handleDirectBanIp} className="space-y-3">
          <Field label="IP address" htmlFor="ban-ip">
            <Input
              id="ban-ip"
              mono
              value={banIpInput}
              onChange={(e) => setBanIpInput(e.target.value)}
              placeholder="e.g. 104.28.14.2"
              required
              data-autofocus
            />
          </Field>
          <Field label="Reason" htmlFor="ban-reason">
            <Input
              id="ban-reason"
              value={banReasonInput}
              onChange={(e) => setBanReasonInput(e.target.value)}
              placeholder="e.g. Terms of service violation"
            />
          </Field>
          <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-caption text-danger-text">
            Banning an IP ends every active session on it and blocks future key claims, loader downloads and script runs from that network.
          </p>
        </form>
      </Modal>
    </div>
  );
}
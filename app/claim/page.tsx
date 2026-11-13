// app/claim/page.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import Navbar from "@/components/Navbar";
import {
  Key,
  ShieldAlert,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Shield,
  Flame,
  Zap,
  Star,
  Skull,
  Clock,
  Lock,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import type { CheckpointItem, CreatorProfile } from "@/lib/store";
import { SOCIAL_PLATFORMS } from "@/lib/social-platforms";
import { WorkinkLogo } from "@/components/WorkinkLogo";
import { Alert, Badge, Button, Card, Field, Input, buttonClasses } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

// Fast client-side Proof-of-Work solver (takes ~20ms in genuine browsers, defeats headless HTTP scrapers)
async function solvePoW(nonce: string, difficulty: number): Promise<string> {
  const prefix = "0".repeat(difficulty);
  const encoder = new TextEncoder();
  let i = 0;
  while (i < 300000) {
    const data = encoder.encode(nonce + i);
    const hashBuf = await window.crypto.subtle.digest("SHA-256", data);
    const hashArr = Array.from(new Uint8Array(hashBuf));
    const hashHex = hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hashHex.startsWith(prefix)) {
      return String(i);
    }
    i++;
  }
  return String(i);
}

// Anti-tamper check to detect typical browser bypass scripts / userscripts
function checkClientIntegrity(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const fetchStr = Function.prototype.toString.call(window.fetch);
    // If fetch has been replaced by an extension wrapper with typical bypass keywords
    if (
      fetchStr.includes("bypass") ||
      fetchStr.includes("linkvertise") ||
      fetchStr.includes("tampermonkey")
    ) {
      return false;
    }
  } catch {
    // ignore
  }
  return true;
}

// Interactive Slide to Claim Component (blocks bot .click() automation)
function SlideToClaim({
  onComplete,
  disabled,
  loading,
}: {
  onComplete: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  const [sliderPos, setSliderPos] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [completed, setCompleted] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartTimeRef = useRef(0);

  const handleStart = (clientX: number) => {
    if (disabled || loading || completed) return;
    setIsDragging(true);
    dragStartTimeRef.current = Date.now();
  };

  const handleMove = (clientX: number) => {
    if (!isDragging || !trackRef.current || completed) return;
    const rect = trackRef.current.getBoundingClientRect();
    const max = rect.width - 44;
    const current = Math.max(0, Math.min(max, clientX - rect.left - 20));
    setSliderPos(current);

    if (current >= max * 0.92) {
      // Must take at least 150ms of human drag movement (anti-bot instant drag spoof)
      if (Date.now() - dragStartTimeRef.current >= 140) {
        setCompleted(true);
        setIsDragging(false);
        setSliderPos(max);
        onComplete();
      }
    }
  };

  const handleEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (!completed) {
      setSliderPos(0);
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onMouseUp = () => handleEnd();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) handleMove(e.touches[0].clientX);
    };
    const onTouchEnd = () => handleEnd();

    if (isDragging) {
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      window.addEventListener("touchmove", onTouchMove);
      window.addEventListener("touchend", onTouchEnd);
    }
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isDragging]);

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative flex h-12 w-full select-none items-center overflow-hidden rounded-lg border transition-colors",
        disabled
          ? "cursor-not-allowed border-line bg-surface opacity-50"
          : completed
          ? "border-success/40 bg-success/[0.08]"
          : "border-line-strong bg-surface",
      )}
    >
      {/* Background progress fill */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 top-0 transition-all",
          completed ? "bg-success/15" : "bg-accent/15",
        )}
        style={{ width: `${sliderPos + 44}px` }}
      />

      {/* Guide Text */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pl-10 text-body-sm font-medium text-fg-muted">
        {loading ? (
          <span className="flex items-center gap-1.5 text-fg">
            <RefreshCw className="size-3.5 animate-spin motion-reduce:animate-none" /> Allocating license key...
          </span>
        ) : completed ? (
          <span className="flex items-center gap-1.5 text-success-text">
            <CheckCircle2 className="size-4" /> Verified, generating key...
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span>Slide to claim your key</span>
            <ArrowRight className="size-3.5 text-fg-subtle" />
          </span>
        )}
      </div>

      {/* Draggable Thumb */}
      <div
        onMouseDown={(e) => handleStart(e.clientX)}
        onTouchStart={(e) => e.touches[0] && handleStart(e.touches[0].clientX)}
        style={{ transform: `translateX(${sliderPos}px)` }}
        aria-hidden
        className={cn(
          "absolute left-1 flex h-10 w-10 cursor-grab items-center justify-center rounded-md shadow-popover transition-transform duration-75 active:cursor-grabbing",
          completed
            ? "cursor-default bg-success text-canvas"
            : disabled
            ? "bg-surface-active text-fg-disabled"
            : "bg-accent text-accent-fg hover:bg-accent-hover",
        )}
      >
        {completed ? <Check className="size-5" /> : <Key className="size-4" />}
      </div>
    </div>
  );
}

export default function ClaimKeyPage() {
  const [step, setStep] = useState<"verification" | "claimed">("verification");
  const [vpnDetected, setVpnDetected] = useState(false);
  const [loading, setLoading] = useState(false);

  // Dynamic IP Reset State
  const [ipResetting, setIpResetting] = useState(false);
  const [ipResetStatus, setIpResetStatus] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Script and HWID parameters from URL
  const [scriptSlug, setScriptSlug] = useState("");
  const [claimId, setClaimId] = useState("");
  const [targetScript, setTargetScript] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [availableScripts, setAvailableScripts] = useState<Array<{ id: string; name: string; slug: string }>>([]);

  // Checkpoints & Profile State
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [activeCpIndex, setActiveCpIndex] = useState(0);
  const [completedCpIds, setCompletedCpIds] = useState<string[]>([]);
  const [currentTimer, setCurrentTimer] = useState<number | null>(null);
  const [stepEndTime, setStepEndTime] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);

  // Anti-Bypass Security Session State
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStepToken, setCurrentStepToken] = useState<string | null>(null);
  const [powChallenge, setPowChallenge] = useState<{ nonce: string; difficulty: number } | null>(null);
  const [stepGatewayUrls, setStepGatewayUrls] = useState<string[]>([]);
  const [stepGatewayTokens, setStepGatewayTokens] = useState<string[]>([]);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [verifyingStep, setVerifyingStep] = useState(false);
  const [workinkVerifying, setWorkinkVerifying] = useState(false);
  const [workinkOpenedCpId, setWorkinkOpenedCpId] = useState<string | null>(null);
  const [workinkSuccessMessage, setWorkinkSuccessMessage] = useState<string | null>(null);

  // Refs for timer and background tab callbacks
  const currentStepTokenRef = useRef<string | null>(null);
  currentStepTokenRef.current = currentStepToken;
  const activeCpIndexRef = useRef(0);
  activeCpIndexRef.current = activeCpIndex;
  const checkpointsRef = useRef<CheckpointItem[]>([]);
  checkpointsRef.current = checkpoints;
  const powChallengeRef = useRef<{ nonce: string; difficulty: number } | null>(null);
  powChallengeRef.current = powChallenge;
  const targetScriptRef = useRef<{ id: string; name: string; slug: string } | null>(null);
  targetScriptRef.current = targetScript;
  const claimIdRef = useRef("");
  claimIdRef.current = claimId;

  // Creator Profile
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
      github: "https://github.com/",
    },
  });

  // Claim Result State
  const [claimedKey, setClaimedKey] = useState<string | null>(null);
  const [boundIp, setBoundIp] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLockedOut, setIsLockedOut] = useState(false);

  const [claimMethod, setClaimMethod] = useState<"checkpoints" | "discord_oauth">("checkpoints");
  const [discordInvite, setDiscordInvite] = useState("https://discord.gg/NdrTc27GxT");
  const [discordJoined, setDiscordJoined] = useState(false);
  const [discordUsername, setDiscordUsername] = useState("");

  const handleResetIp = async () => {
    if (!claimedKey) return;
    setIpResetting(true);
    setIpResetStatus(null);
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_ip", key: claimedKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset IP");
      setIpResetStatus({ message: data.message || "IP rebound successfully!", type: "success" });
      if (data.bound_ip) setBoundIp(data.bound_ip);
    } catch (err: unknown) {
      setIpResetStatus({
        message: err instanceof Error ? err.message : "Failed to reset IP",
        type: "error",
      });
    } finally {
      setIpResetting(false);
    }
  };

  const checkAlreadyClaimed = async (slugToCheck: string) => {
    try {
      const url = slugToCheck
        ? `/api/claim?script_slug=${encodeURIComponent(slugToCheck)}`
        : "/api/claim";
      const res = await fetch(url);
      const data = await res.json();
      if (data.already_claimed && data.key) {
        setClaimedKey(data.key);
        setBoundIp(data.bound_ip);
        setExpiresAt(data.expires_at);
        setAlreadyClaimed(true);
        setStep("claimed");
        if (data.discord_invite_url) {
          setDiscordInvite(data.discord_invite_url);
        }
      }
    } catch {
      // ignore
    }
  };

  // Initialize anti-bypass checkpoint session with server clock
  const initCheckpointSession = async (slug: string, hwidParam?: string) => {
    try {
      const activeHwid = hwidParam || claimId;
      const res = await fetch("/api/checkpoints/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          script_slug: slug,
          hwid: activeHwid,
        }),
      });
      const data = await res.json();
      if (data.locked_out) {
        setIsLockedOut(true);
        setError(data.error || "Access Denied: Your IP or device (HWID) is locked out from claiming keys.");
        return;
      }
      if (data.success) {
        setSessionId(data.sessionId || data.sessionToken);
        setPowChallenge(data.powChallenge);
        if (data.stepDetails && Array.isArray(data.stepDetails) && data.stepDetails.length > 0) {
          setCheckpoints(
            data.stepDetails.map((s: any) => ({
              id: s.id,
              script_id: "all",
              title: s.title,
              url: s.url || s.gatewayUrl,
              duration_seconds: s.duration_seconds,
              order: s.order,
              created_at: new Date().toISOString(),
              gatewayToken: s.gatewayToken,
              gatewayUrl: s.gatewayUrl,
              is_workink: s.is_workink,
            }))
          );
          setStepGatewayUrls(data.stepDetails.map((s: any) => s.gatewayUrl));
          setStepGatewayTokens(data.stepDetails.map((s: any) => s.gatewayToken));
        }
      }
    } catch (err) {
      console.error("Failed to init checkpoint session:", err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    let slug = params.get("script") || "";
    if (slug) {
      try { sessionStorage.setItem("atom_last_script", slug); } catch {}
    } else {
      try { slug = sessionStorage.getItem("atom_last_script") || ""; } catch {}
    }

    let cid = params.get("hwid") || params.get("claim_id") || params.get("id") || "";
    if (cid) {
      try { sessionStorage.setItem("atom_last_hwid", cid); } catch {}
    } else {
      try { cid = sessionStorage.getItem("atom_last_hwid") || ""; } catch {}
    }

    setScriptSlug(slug);
    setClaimId(cid);

    checkAlreadyClaimed(slug);

    // Fetch site settings
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        const actual = s?.settings || s;
        if (actual?.claim_method) setClaimMethod(actual.claim_method);
        if (actual?.discord_invite_url) setDiscordInvite(actual.discord_invite_url);
      })
      .catch(() => {});

    // Fetch list of active scripts
    fetch("/api/scripts")
      .then((r) => r.json())
      .then((data) => {
        const scriptList = Array.isArray(data) ? data : (data.scripts || []);
        const activeOnly = scriptList
          .filter((sc: { is_active?: boolean }) => sc.is_active !== false)
          .map((sc: { id: string; name: string; slug: string }) => ({
            id: sc.id,
            name: sc.name,
            slug: sc.slug,
          }));
        setAvailableScripts(activeOnly);

        let target: { id: string; name: string; slug: string } | null = null;
        if (slug) {
          target =
            activeOnly.find(
              (sc: { id: string; name: string; slug: string }) =>
                sc.slug.toLowerCase() === slug.toLowerCase() ||
                sc.id === slug ||
                sc.name.toLowerCase() === slug.toLowerCase()
            ) || null;
        }
        if (!target && activeOnly.length > 0) {
          target =
            activeOnly.find(
              (sc: { id: string; name: string; slug: string }) =>
                sc.slug === "rivals" || sc.slug === "atomware-hub" || sc.name.toLowerCase().includes("atom")
            ) ||
            activeOnly[activeOnly.length - 1] ||
            activeOnly[0] ||
            null;
        }
        if (target) {
          setTargetScript(target);
          if (!slug) {
            setScriptSlug(target.slug);
            checkAlreadyClaimed(target.slug);
            initCheckpointSession(target.slug, cid);
          }
        }
      })
      .catch(() => {});

    // Fetch checkpoints & profile
    const cpEndpoint = slug
      ? `/api/checkpoints?script_slug=${encodeURIComponent(slug)}`
      : "/api/checkpoints";

    fetch(cpEndpoint)
      .then((res) => {
        if (res.status === 403) {
          setVpnDetected(true);
          throw new Error("VPN_DETECTED");
        }
        return res.json();
      })
      .then((data) => {
        if (data.profile) setProfile(data.profile);
        if (data.checkpoints && Array.isArray(data.checkpoints) && data.checkpoints.length > 0) {
          setCheckpoints(data.checkpoints);
        }
        if (data.script) {
          setTargetScript(data.script);
          if (!slug && data.script.slug) {
            setScriptSlug(data.script.slug);
          }
        }
      })
      .catch(() => {});

    // Initialize anti-bypass session if slug present
    if (slug) {
      initCheckpointSession(slug, cid);
    }
  }, []);

  // Save checkpoint progress to localStorage & sessionStorage (3-minute retention)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `atom_cp_progress_${scriptSlug || "default"}`;
    if (completedCpIds.length > 0 || claimToken || sessionId || workinkOpenedCpId || currentStepToken) {
      try {
        const payload = JSON.stringify({
          completedCpIds,
          activeCpIndex,
          claimToken,
          sessionId,
          stepEndTime,
          currentStepToken,
          workinkOpenedCpId,
          powChallenge,
          savedAt: Date.now(),
        });
        localStorage.setItem(key, payload);
        sessionStorage.setItem(key, payload);
      } catch {}
    }
  }, [completedCpIds, activeCpIndex, claimToken, sessionId, stepEndTime, currentStepToken, workinkOpenedCpId, powChallenge, scriptSlug]);

  // Restore checkpoint progress from localStorage / sessionStorage on load/reload (3-minute validity)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `atom_cp_progress_${scriptSlug || "default"}`;
    try {
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const age = Date.now() - (parsed.savedAt || 0);
        const isValid = age <= 3 * 60 * 1000 || Boolean(parsed.claimToken);

        if (!isValid) {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
          return;
        }

        if (Array.isArray(parsed.completedCpIds) && parsed.completedCpIds.length > 0) {
          setCompletedCpIds(parsed.completedCpIds);
        }
        if (typeof parsed.activeCpIndex === "number") {
          setActiveCpIndex(parsed.activeCpIndex);
        }
        if (parsed.claimToken) {
          setClaimToken(parsed.claimToken);
        }
        if (parsed.sessionId) {
          setSessionId(parsed.sessionId);
        }
        if (parsed.workinkOpenedCpId) {
          setWorkinkOpenedCpId(parsed.workinkOpenedCpId);
        }
        if (parsed.powChallenge) {
          setPowChallenge(parsed.powChallenge);
        }
        if (parsed.currentStepToken) {
          setCurrentStepToken(parsed.currentStepToken);
        }
        if (parsed.stepEndTime && parsed.stepEndTime > Date.now()) {
          const rem = Math.ceil((parsed.stepEndTime - Date.now()) / 1000);
          setStepEndTime(parsed.stepEndTime);
          setCurrentTimer(rem);
          setTimerRunning(true);
        } else if (parsed.stepEndTime && parsed.currentStepToken) {
          setCurrentTimer(0);
          setTimerRunning(false);
        }
      }
    } catch {}
  }, [scriptSlug]);

  // Work.ink Token Return Auto-Verification (Strict Server API Check)
  useEffect(() => {
    if (typeof window === "undefined" || checkpoints.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const workinkToken = params.get("t") || params.get("token") || params.get("workink_token");

    if (!workinkToken) return;

    if ((window as any).__verifyingWorkinkToken === workinkToken) return;
    (window as any).__verifyingWorkinkToken = workinkToken;

    const verifyWorkinkReturn = async () => {
      setWorkinkVerifying(true);
      setError(null);

      const key = `atom_cp_progress_${scriptSlug || "default"}`;
      let currentIndex = activeCpIndex;
      let currentCompleted = [...completedCpIds];
      let storedSessionId = sessionId;

      try {
        const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          const age = Date.now() - (parsed.savedAt || 0);
          if (age <= 3 * 60 * 1000 || parsed.claimToken) {
            if (typeof parsed.activeCpIndex === "number") currentIndex = parsed.activeCpIndex;
            if (Array.isArray(parsed.completedCpIds)) currentCompleted = parsed.completedCpIds;
            if (parsed.sessionId) storedSessionId = parsed.sessionId;
          }
        }
      } catch {}

      // Identify which step is actually being completed (supports multiple sequential Work.ink checkpoints)
      const stepToVerify =
        currentCompleted.length < checkpoints.length
          ? currentCompleted.length
          : Math.min(checkpoints.length - 1, currentIndex);

      const activeCp = checkpoints[stepToVerify] || checkpoints[currentIndex] || checkpoints[0];

      try {
        const res = await fetch("/api/checkpoints/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify_workink",
            token: workinkToken,
            sessionId: storedSessionId,
            stepIndex: stepToVerify,
            totalSteps: checkpoints.length,
            script_id: targetScript?.id || scriptSlug,
          }),
        });

        const data = await res.json();
        if (data.success) {
          const newCompleted = Array.from(new Set([...currentCompleted, activeCp.id]));
          setCompletedCpIds(newCompleted);

          if (data.allCompleted && data.claimToken) {
            setClaimToken(data.claimToken);
            setActiveCpIndex(checkpoints.length);
            setWorkinkOpenedCpId(null);
            setWorkinkSuccessMessage("All Work.ink tasks verified. Use the slider below to unlock your key.");
          } else {
            const nextIdx = stepToVerify + 1;
            setActiveCpIndex(nextIdx);
            setWorkinkOpenedCpId(null);
            setWorkinkSuccessMessage(`Work.ink step ${stepToVerify + 1} completed. Continue to the next task.`);
          }

          // Immediately persist fresh completion progress so tab-close/refresh retains it
          try {
            const updatedState = {
              completedCpIds: newCompleted,
              activeCpIndex: data.allCompleted ? checkpoints.length : stepToVerify + 1,
              claimToken: data.claimToken || claimToken,
              sessionId: storedSessionId,
              workinkOpenedCpId: null,
              savedAt: Date.now(),
            };
            localStorage.setItem(key, JSON.stringify(updatedState));
            sessionStorage.setItem(key, JSON.stringify(updatedState));
          } catch {}

          // Clean token from URL history cleanly
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("t");
          cleanUrl.searchParams.delete("token");
          cleanUrl.searchParams.delete("workink_token");
          window.history.replaceState({}, document.title, cleanUrl.toString());
        } else {
          setError(data.error || "Work.ink tasks have not been completed. Please finish the tasks to unlock the slider.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Error validating Work.ink completion.";
        setError(msg);
      } finally {
        setWorkinkVerifying(false);
      }
    };

    verifyWorkinkReturn();
  }, [checkpoints, scriptSlug, activeCpIndex, completedCpIds, sessionId, targetScript]);

  // Timer Countdown Handler with wall-clock calculation & visibility/focus listener
  useEffect(() => {
    if (!timerRunning || !stepEndTime) return;

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((stepEndTime - Date.now()) / 1000));
      setCurrentTimer(remaining);
      if (remaining <= 0) {
        setTimerRunning(false);
        setStepEndTime(null);
        handleVerifyCurrentStep();
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        updateCountdown();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [timerRunning, stepEndTime]);

  // Click handler: opens secure gateway link and starts timer
  const handleStartCheckpoint = async (cp: CheckpointItem, index: number) => {
    if (completedCpIds.includes(cp.id)) return;
    if (index !== activeCpIndex) return;

    setError(null);

    // Verify browser integrity
    if (!checkClientIntegrity()) {
      setError("Tampermonkey / Bypasser script detected. Please disable any script extensions and reload.");
      return;
    }

    let gatewayToken = stepGatewayTokens[index] || (cp as any).gatewayToken;
    let gatewayUrl = stepGatewayUrls[index] || cp.url;

    // Fallback: If session not yet initialized or token missing, initialize now
    if (!gatewayToken) {
      try {
        const initRes = await fetch("/api/checkpoints/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            script_slug: scriptSlug || targetScript?.slug || "",
            hwid: claimId,
          }),
        });
        const initData = await initRes.json();
        if (initData.success && initData.stepDetails && initData.stepDetails[index]) {
          gatewayToken = initData.stepDetails[index].gatewayToken;
          gatewayUrl = initData.stepDetails[index].gatewayUrl;
          setSessionId(initData.sessionId);
          setPowChallenge(initData.powChallenge);
          setStepGatewayUrls(initData.stepDetails.map((s: any) => s.gatewayUrl));
          setStepGatewayTokens(initData.stepDetails.map((s: any) => s.gatewayToken));
        }
      } catch (err) {
        console.error("Init session fallback error:", err);
      }
    }

    const isWorkink = Boolean(
      cp.duration_seconds === 0 ||
      cp.url?.includes("work.ink") ||
      cp.url?.includes("workink.net") ||
      (cp as any).is_workink
    );

    // Save state to localStorage immediately before navigation so tab-close/reload retains it
    const key = `atom_cp_progress_${scriptSlug || "default"}`;
    try {
      const stateToPersist = {
        completedCpIds,
        activeCpIndex: index,
        claimToken,
        sessionId,
        currentStepToken,
        workinkOpenedCpId: cp.id,
        powChallenge,
        savedAt: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(stateToPersist));
      sessionStorage.setItem(key, JSON.stringify(stateToPersist));
    } catch {}

    // For Work.ink: navigate in SAME TAB so returning from Work.ink brings them right back into this tab!
    if (isWorkink) {
      setWorkinkOpenedCpId(cp.id);
      setTimerRunning(false);
      setCurrentTimer(null);
      setStepEndTime(null);
      if (gatewayUrl) {
        window.location.href = gatewayUrl;
      }
      return;
    }

    // For timed tasks: open destination in a new tab so the dwell timer ticks down on this page
    if (gatewayUrl) {
      window.open(gatewayUrl, "_blank", "noopener,noreferrer");
    }

    if (!gatewayToken) {
      setError("Unable to initialize secure task gateway. Please refresh and try again.");
      return;
    }

    // Call server to stamp start time on the server clock and get active step token
    try {
      const res = await fetch("/api/checkpoints/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_step",
          gatewayToken,
        }),
      });

      const data = await res.json();
      if (data.success && data.activeStepToken) {
        setCurrentStepToken(data.activeStepToken);
        if (data.powChallenge) {
          setPowChallenge(data.powChallenge);
        }

        const dur = data.duration || cp.duration_seconds || 5;
        const endTime = Date.now() + dur * 1000;
        setStepEndTime(endTime);
        setCurrentTimer(dur);
        setTimerRunning(true);
      } else {
        setError(data.error || "Failed to start checkpoint step.");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to connect to verification server.");
    }
  };

  // Verify step completion with server
  const handleVerifyCurrentStep = async (tokenOverride?: string, indexOverride?: number) => {
    const activeToken = tokenOverride || currentStepTokenRef.current;
    const activeIndex = indexOverride !== undefined ? indexOverride : activeCpIndexRef.current;
    const activeCp = checkpointsRef.current[activeIndex];
    if (!activeCp || !activeToken) return;

    setVerifyingStep(true);
    setError(null);

    try {
      // Compute proof of work in background
      let powSolution = "";
      const curPow = powChallengeRef.current;
      if (curPow) {
        powSolution = await solvePoW(curPow.nonce, curPow.difficulty);
      }

      const res = await fetch("/api/checkpoints/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_step",
          activeStepToken: activeToken,
          powSolution,
          powNonce: curPow?.nonce || "",
          hwid: claimIdRef.current,
          stepIndex: activeIndex,
          script_id: targetScriptRef.current?.id,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.locked_out) {
          setIsLockedOut(true);
          setError(data.error || "Access Denied: You have been locked out due to multiple bypass attempts.");
          return;
        }
        if (data.remainingSeconds) {
          setError(
            data.error ||
              `Task dwell time not reached. Please wait ${data.remainingSeconds}s on the destination page.`
          );
          const endTime = Date.now() + data.remainingSeconds * 1000;
          setStepEndTime(endTime);
          setCurrentTimer(data.remainingSeconds);
          setTimerRunning(true);
        } else {
          setError(data.error || "Verification failed. Please complete the task genuinely.");
          if (
            data.error?.includes("expired") ||
            data.error?.includes("interrupted") ||
            data.error?.includes("token") ||
            data.error?.includes("session")
          ) {
            setCurrentStepToken(null);
          }
        }
        return;
      }

      // Step successfully verified on server!
      setCompletedCpIds((prev) => [...prev, activeCp.id]);
      setStepEndTime(null);

      if (data.allCompleted && data.claimToken) {
        setClaimToken(data.claimToken);
      } else if (data.nextStep !== undefined) {
        setActiveCpIndex(data.nextStep);
        setCurrentStepToken(null);
        if (data.nextPowChallenge) {
          setPowChallenge(data.nextPowChallenge);
        }
      }
    } catch (err) {
      console.error(err);
      setError("Failed to verify step with server. Please try again.");
    } finally {
      setVerifyingStep(false);
    }
  };

  const allCheckpointsDone =
    checkpoints.length > 0 && checkpoints.every((cp) => completedCpIds.includes(cp.id));

  // Claim key handler (validates claim_token with server)
  const handleClaimKey = async () => {
    if (!scriptSlug && availableScripts.length > 0) {
      setError("Please select which script you want to claim a key for.");
      return;
    }

    if (claimMethod === "discord_oauth" && !discordUsername.trim()) {
      setError("Please enter your Discord username to claim your license key.");
      return;
    }

    if (claimMethod === "checkpoints" && (!sessionId || !claimToken)) {
      setError("Missing checkpoint authorization token. Please complete all tasks.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sanitizedTag = discordUsername.trim();
      const sanitizedId = sanitizedTag.toLowerCase().replace(/[^a-z0-9_]/g, "") || "discord_user";

      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script_slug: scriptSlug,
          claim_id: claimId,
          hwid: claimId,
          session_id: sessionId,
          claim_token: claimToken,
          discord_user:
            claimMethod === "discord_oauth"
              ? { id: sanitizedId, tag: sanitizedTag }
              : null,
        }),
      });

      const data = await res.json();

      if (data.locked_out) {
        setIsLockedOut(true);
        throw new Error(data.error || "Access Denied: You have been locked out due to multiple bypass attempts.");
      }

      if (res.status === 403 && data.error?.includes("VPN")) {
        setVpnDetected(true);
        throw new Error(data.error);
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to claim license key");
      }

      setClaimedKey(data.key);
      setBoundIp(data.bound_ip);
      setExpiresAt(data.expires_at);
      setAlreadyClaimed(data.already_claimed || false);
      setStep("claimed");
      try {
        sessionStorage.removeItem(`atom_cp_progress_${scriptSlug || "default"}`);
      } catch {}
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error claiming key";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (!claimedKey) return;
    navigator.clipboard.writeText(claimedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderEmblemIcon = (iconName: string) => {
    switch (iconName) {
      case "shield":
        return <Shield className="w-3 h-3" />;
      case "flame":
        return <Flame className="w-3 h-3" />;
      case "zap":
        return <Zap className="w-3 h-3" />;
      case "star":
        return <Star className="w-3 h-3" />;
      case "skull":
        return <Skull className="w-3 h-3" />;
      default:
        return <ShieldCheck className="w-3 h-3" />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <Navbar />

      <main className="mx-auto flex w-full max-w-6xl flex-1 items-start justify-center p-4 sm:p-6 lg:items-center lg:p-8">
        <div className="grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-12 lg:gap-6">
          {/* LEFT COLUMN: CREATOR PROFILE CARD */}
          <Card className="flex flex-col items-center p-6 text-center lg:col-span-5">
            {/* Avatar */}
            <div className="relative mb-3.5">
              <div className="size-20 rounded-full p-0.5 ring-1 ring-line-strong">
                <img
                  src={profile.avatar_url || "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21"}
                  alt="Creator avatar"
                  className="h-full w-full rounded-full bg-canvas object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      "https://api.dicebear.com/7.x/bottts/svg?seed=Revile21";
                  }}
                />
              </div>
              <span
                aria-hidden
                className="absolute bottom-1 right-1 size-3.5 rounded-full border-2 border-surface-raised bg-success"
              />
            </div>

            {/* Display Name */}
            <div className="flex items-center gap-2">
              <h2 className="text-heading font-semibold text-fg">{profile.display_name || "Revile"}</h2>
              <Badge tone="success" dot>
                Official
              </Badge>
            </div>

            {/* Emblems (colors are creator-configured) */}
            {profile.emblems && profile.emblems.length > 0 && (
              <div className="my-3 flex flex-wrap items-center justify-center gap-1.5">
                {profile.emblems.map((emb) => {
                  const color = emb.color || "#5e9bff";
                  return (
                    <Badge
                      key={emb.id}
                      className="bg-surface"
                      style={{ color, ["--tw-ring-color" as string]: `${color}55` } as React.CSSProperties}
                    >
                      {renderEmblemIcon(emb.icon)}
                      <span>{emb.label}</span>
                    </Badge>
                  );
                })}
              </div>
            )}

            {/* Bio */}
            <p className="mb-4 max-w-sm text-body-sm text-fg-muted">
              {profile.bio || "Lead Developer & Script Engineer."}
            </p>

            {/* Social links (third-party brand colors kept on the icons) */}
            <div className="flex w-full flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
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
                    className={buttonClasses({ variant: "secondary", size: "sm" })}
                  >
                    <svg className="fill-current" viewBox="0 0 24 24" style={{ color: platform.color }} aria-hidden>
                      <path d={platform.path} />
                    </svg>
                    <span>{platform.name}</span>
                  </a>
                );
              })}
            </div>

            {claimId && (
              <div className="mt-4 w-full truncate border-t border-line pt-3 font-data text-caption text-fg-subtle">
                HWID: {claimId.slice(0, 16)}...
              </div>
            )}
          </Card>

          {/* RIGHT COLUMN: MAIN KEY CLAIM CONTAINER */}
          <Card className="relative p-5 sm:p-6 lg:col-span-7">
            <div className="mb-5 flex items-start justify-between gap-3 border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent-text">
                  <Key className="size-4" />
                </span>
                <div>
                  <h1 className="text-title font-semibold text-fg">License key gateway</h1>
                  <p className="text-body-sm text-fg-muted">
                    Complete the checkpoint tasks below to get your key.
                  </p>
                </div>
              </div>

              <Badge tone="success" className="hidden sm:inline-flex">
                <ShieldCheck className="size-3" />
                Anti-bypass shield
              </Badge>
            </div>

            {/* Lockout Banner */}
            {isLockedOut && (
              <Alert
                tone="danger"
                icon={<Skull />}
                title="Access permanently locked out"
                className="mb-4"
                action={
                  <>
                    <span className="text-caption text-fg-subtle">Think this is an error? Appeal in Discord.</span>
                    <a
                      href={discordInvite}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonClasses({ variant: "secondary", size: "xs" })}
                    >
                      Join Discord
                    </a>
                  </>
                }
              >
                Your network IP and device HWID have been locked out due to repeated checkpoint bypass violations (3/3
                attempts). You can no longer claim license keys.
              </Alert>
            )}

            {/* VPN Detected Banner */}
            {vpnDetected && (
              <Alert
                tone="danger"
                icon={<ShieldAlert />}
                title="VPN or proxy detected"
                className="mb-4"
                action={
                  <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                    <RefreshCw />
                    <span>Reload page</span>
                  </Button>
                }
              >
                To prevent abuse, keys can&apos;t be claimed through a VPN or proxy network. Turn off your VPN, then
                reload this page.
              </Alert>
            )}

            {/* Error Banner */}
            {error && !vpnDetected && (
              <Alert tone="danger" icon={<AlertCircle />} className="mb-4">
                {error}
              </Alert>
            )}

            {/* STAGE 1: CHECKPOINTS */}
            {step === "verification" && !vpnDetected && (
              <div className="space-y-5">
                {!scriptSlug && availableScripts.length > 0 ? (
                  <Card variant="inset" className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-body-sm font-semibold text-fg">
                        <Lock className="size-4 text-fg-subtle" />
                        Select a script
                      </span>
                      <Badge tone="warning">Required</Badge>
                    </div>
                    <p className="text-body-sm text-fg-muted">Each key works for one script only.</p>
                    <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                      {availableScripts.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setScriptSlug(s.slug);
                            setTargetScript(s);
                            setError(null);
                            checkAlreadyClaimed(s.slug);
                            initCheckpointSession(s.slug);
                            fetch(`/api/checkpoints?script_slug=${encodeURIComponent(s.slug)}`)
                              .then((r) => r.json())
                              .then((data) => {
                                if (data.checkpoints && Array.isArray(data.checkpoints) && data.checkpoints.length > 0) {
                                  setCheckpoints(data.checkpoints);
                                }
                              })
                              .catch(() => {});
                          }}
                          className={cn(
                            "group flex items-center justify-between rounded-md border border-line bg-surface-raised p-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-surface-hover",
                            focusRing,
                          )}
                        >
                          <div className="min-w-0">
                            <span className="block truncate text-body-sm font-semibold text-fg">{s.name}</span>
                            <span className="font-data text-caption text-fg-subtle">/{s.slug}</span>
                          </div>
                          <ChevronRight className="size-4 shrink-0 text-fg-subtle group-hover:text-fg" />
                        </button>
                      ))}
                    </div>
                  </Card>
                ) : targetScript ? (
                  <Card variant="inset" className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2 text-body-sm text-fg-muted">
                      <Lock className="size-3.5 shrink-0 text-fg-subtle" />
                      <span className="truncate">
                        Script: <strong className="font-semibold text-fg">{targetScript.name}</strong>{" "}
                        <span className="font-data text-caption text-fg-subtle">/{targetScript.slug}</span>
                      </span>
                    </div>
                    {availableScripts.length > 1 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setScriptSlug("");
                          setTargetScript(null);
                          setCompletedCpIds([]);
                          setActiveCpIndex(0);
                          setClaimToken(null);
                          setCurrentStepToken(null);
                        }}
                      >
                        Change
                      </Button>
                    )}
                  </Card>
                ) : null}

                {claimMethod === "discord_oauth" ? (
                  <Card variant="inset" className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2 text-body-sm font-semibold text-fg">
                      <span>Step 1: Join the Discord community</span>
                      {discordJoined ? (
                        <Badge tone="success">
                          <CheckCircle2 className="size-3" />
                          Done
                        </Badge>
                      ) : (
                        <Badge tone="warning">Required</Badge>
                      )}
                    </div>
                    <p className="text-body-sm text-fg-muted">
                      Active membership in our Discord server is required to claim a key.
                    </p>
                    <a
                      href={discordInvite}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setDiscordJoined(true)}
                      className={buttonClasses({
                        variant: "primary",
                        size: "lg",
                        className: "w-full bg-[#5865F2] text-white hover:bg-[#4752C4] active:bg-[#4752C4]",
                      })}
                    >
                      <span>Join Discord server</span>
                      <ExternalLink />
                    </a>

                    <div className="border-t border-line pt-3">
                      <Field label="Step 2: Enter your Discord username" htmlFor="claim-discord-username">
                        <Input
                          id="claim-discord-username"
                          type="text"
                          mono
                          value={discordUsername}
                          onChange={(e) => setDiscordUsername(e.target.value)}
                          placeholder="e.g. revile"
                        />
                      </Field>
                    </div>
                  </Card>
                ) : (
                  /* Checkpoints List */
                  <div className="space-y-2">
                    <div className="mb-1 flex items-center justify-between text-body-sm">
                      <span className="text-fg-muted">Checkpoints</span>
                      <span className="font-data text-caption text-fg-muted">
                        <span className={cn(allCheckpointsDone ? "text-success-text" : "text-fg")}>
                          {completedCpIds.length}
                        </span>{" "}
                        of {checkpoints.length} completed
                      </span>
                    </div>

                    {workinkSuccessMessage && (
                      <Alert tone="success" icon={<CheckCircle2 />}>
                        {workinkSuccessMessage}
                      </Alert>
                    )}

                    <ol className="space-y-2">
                      {checkpoints.map((cp, idx) => {
                        const isCompleted = completedCpIds.includes(cp.id);
                        const isCurrent = idx === activeCpIndex && !isCompleted;
                        const isLocked = idx > activeCpIndex && !isCompleted;
                        const isWorkink = Boolean(
                          cp.duration_seconds === 0 ||
                          cp.url?.includes("work.ink") ||
                          cp.url?.includes("workink.net") ||
                          (cp as any).is_workink
                        );

                        return (
                          <li
                            key={cp.id}
                            aria-current={isCurrent ? "step" : undefined}
                            className={cn(
                              "rounded-lg border p-3.5 transition-colors",
                              isCompleted
                                ? "border-success/25 bg-success/[0.05]"
                                : isCurrent
                                ? "border-accent/45 bg-accent/[0.05]"
                                : "border-line bg-surface",
                              isLocked && "opacity-60",
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <div
                                  className={cn(
                                    "flex size-7 shrink-0 items-center justify-center rounded-md font-data text-caption font-semibold",
                                    isCompleted
                                      ? "bg-success/15 text-success-text"
                                      : isCurrent
                                      ? "bg-accent text-accent-fg"
                                      : "bg-surface-active text-fg-subtle",
                                  )}
                                >
                                  {isCompleted ? <Check className="size-4" /> : idx + 1}
                                </div>

                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <h4
                                      className={cn(
                                        "truncate text-body-sm font-semibold",
                                        isCompleted ? "text-success-text" : isCurrent ? "text-fg" : "text-fg-muted",
                                      )}
                                    >
                                      {cp.title}
                                    </h4>
                                    {isWorkink && (
                                      <Badge>
                                        <WorkinkLogo className="h-3.5 w-3.5 flex-shrink-0" />
                                        Work.ink
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="truncate text-caption text-fg-subtle">
                                    {isCompleted
                                      ? "Verified by Work.ink API ✓"
                                      : isWorkink
                                      ? workinkOpenedCpId === cp.id
                                        ? "Task in progress. Complete on Work.ink to unlock automatically..."
                                        : "Complete Work.ink task (No timer required)"
                                      : isCurrent && timerRunning
                                      ? `Wait ${currentTimer}s on the destination task page...`
                                      : `Visit task and spend ${cp.duration_seconds}s.`}
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0">
                                {isCompleted ? (
                                  <Badge tone="success">
                                    <CheckCircle2 className="size-3" />
                                    Done
                                  </Badge>
                                ) : isCurrent ? (
                                  workinkVerifying || verifyingStep ? (
                                    <Badge tone="accent" className="h-7 px-2.5">
                                      <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" />
                                      Verifying
                                    </Badge>
                                  ) : isWorkink ? (
                                    workinkOpenedCpId === cp.id ? (
                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          variant="secondary"
                                          size="xs"
                                          onClick={() => handleStartCheckpoint(cp, idx)}
                                          title="Reopen link"
                                        >
                                          <ExternalLink />
                                          <span>Reopen</span>
                                        </Button>
                                        <Badge tone="accent" className="motion-safe:animate-pulse">
                                          <WorkinkLogo className="h-3 w-3 flex-shrink-0" />
                                          Awaiting task
                                        </Badge>
                                      </div>
                                    ) : (
                                      <Button variant="primary" size="sm" onClick={() => handleStartCheckpoint(cp, idx)}>
                                        <WorkinkLogo className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span>Go to Work.ink</span>
                                      </Button>
                                    )
                                  ) : timerRunning ? (
                                    <Badge mono className="h-7 px-2.5 text-caption">
                                      <Clock className="size-3.5 text-fg-subtle" />
                                      {currentTimer}s
                                    </Badge>
                                  ) : currentStepToken ? (
                                    <Button variant="primary" size="sm" onClick={() => handleVerifyCurrentStep()}>
                                      <Check />
                                      <span>Verify task</span>
                                    </Button>
                                  ) : (
                                    <Button variant="primary" size="sm" onClick={() => handleStartCheckpoint(cp, idx)}>
                                      <span>Visit task</span>
                                      <ExternalLink />
                                    </Button>
                                  )
                                ) : (
                                  <span className="flex items-center gap-1 text-caption text-fg-disabled">
                                    <Lock className="size-3" />
                                    Locked
                                  </span>
                                )}
                              </div>
                            </div>

                            {!isWorkink && isCurrent && timerRunning && currentTimer !== null && (
                              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
                                <div
                                  className="h-1 bg-accent transition-all duration-1000"
                                  style={{
                                    width: `${
                                      ((cp.duration_seconds - currentTimer) /
                                        cp.duration_seconds) *
                                      100
                                    }%`,
                                  }}
                                />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}

                {/* Final Claim Section */}
                {claimMethod === "checkpoints" ? (
                  allCheckpointsDone && claimToken ? (
                    /* Interactive Slide-to-Claim to prevent automated headless bypass bots */
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between gap-2 px-0.5 text-body-sm">
                        <span className="flex items-center gap-1.5 font-medium text-success-text">
                          <CheckCircle2 className="size-3.5" /> All tasks completed
                        </span>
                        <span className="text-caption text-fg-subtle">Drag the slider to unlock your key</span>
                      </div>
                      <SlideToClaim
                        onComplete={handleClaimKey}
                        disabled={loading}
                        loading={loading}
                      />
                    </div>
                  ) : (
                    <Card variant="inset" className="space-y-1 p-4 text-center">
                      <div className="flex items-center justify-center gap-2 text-body-sm font-medium text-fg-muted">
                        <Lock className="size-3.5 text-fg-subtle" />
                        <span>Slider locked</span>
                      </div>
                      <p className="text-caption text-fg-subtle">
                        Complete the checkpoint tasks above to unlock the slider and claim your key.
                      </p>
                    </Card>
                  )
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={handleClaimKey}
                    disabled={loading || !discordJoined || !discordUsername.trim()}
                    className="w-full"
                  >
                    {loading ? (
                      <span>Allocating key from pool...</span>
                    ) : (
                      <>
                        <span>Generate license key</span>
                        <ArrowRight />
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* STAGE 2: CLAIMED */}
            {step === "claimed" && claimedKey && (
              <div className="space-y-4">
                <Alert
                  tone={alreadyClaimed ? "warning" : "success"}
                  role="status"
                  icon={alreadyClaimed ? <Key /> : <ShieldCheck />}
                  title={alreadyClaimed ? "You already have a key" : "License key generated"}
                >
                  {alreadyClaimed
                    ? "Your IP already has an active key. Copy it into your script."
                    : "Your key has been allocated and cryptographically bound to your IP."}
                </Alert>

                {/* Key Display */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-line-strong bg-canvas py-2 pl-3.5 pr-2">
                  <div className="select-all truncate font-data text-body font-semibold tracking-wide text-fg">
                    {claimedKey}
                  </div>
                  <Button variant="primary" size="sm" onClick={copyKey} aria-live="polite">
                    {copied ? (
                      <>
                        <Check />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Key Metadata */}
                <dl className="grid grid-cols-2 gap-2">
                  <Card variant="inset" className="px-3 py-2.5">
                    <dt className="text-caption text-fg-subtle">Bound IP</dt>
                    <dd className="truncate font-data text-body-sm text-fg">{boundIp || "Your network"}</dd>
                  </Card>
                  <Card variant="inset" className="px-3 py-2.5">
                    <dt className="text-caption text-fg-subtle">Status</dt>
                    <dd className="mt-0.5">
                      <Badge tone="success" dot>
                        Active
                      </Badge>
                    </dd>
                  </Card>
                </dl>

                {/* Dynamic IP Reset Self-Service */}
                <div className="border-t border-line pt-4">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleResetIp}
                    disabled={ipResetting}
                    className="w-full"
                  >
                    <RefreshCw className={ipResetting ? "animate-spin motion-reduce:animate-none" : undefined} />
                    <span>{ipResetting ? "Rebinding IP..." : "Reset bound IP to current location"}</span>
                  </Button>

                  {ipResetStatus && (
                    <Alert
                      tone={ipResetStatus.type === "success" ? "success" : "danger"}
                      icon={ipResetStatus.type === "success" ? <CheckCircle2 /> : <AlertCircle />}
                      className="mt-2"
                    >
                      {ipResetStatus.message}
                    </Alert>
                  )}
                </div>

                {/* Discord Help */}
                <div className="pt-1 text-center">
                  <a
                    href={discordInvite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm text-body-sm text-accent-text underline-offset-2 hover:underline",
                      focusRing,
                    )}
                  >
                    <span>Need help with your key? Join Discord</span>
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

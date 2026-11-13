"use client";

import React, { useState, useEffect } from "react";
import { Activity, Copy, Check, RefreshCw, Zap, Lock, Cpu, AlertTriangle } from "lucide-react";
import { Badge, Button, Card, Input, LogoMark, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { cn } from "@/lib/utils";

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card variant="inset" className="px-3 py-2.5">
      <span className="mb-1 block text-caption text-fg-subtle">{label}</span>
      <div className="flex min-h-5 items-center gap-1.5">{children}</div>
    </Card>
  );
}

export default function InteractiveTelemetryDemo() {
  const [keyInput, setKeyInput] = useState("ATOM-89F2-C14D-7E80");
  const [status, setStatus] = useState<"idle" | "verifying" | "verified" | "tampered">("verified");
  const [latency, setLatency] = useState(11);
  const [pulseCount, setPulseCount] = useState(42);
  const [copiedCode, setCopiedCode] = useState(false);
  const [activeTab, setActiveTab] = useState<"telemetry" | "loadstring">("telemetry");

  // Simulated 1s heartbeat ticker
  useEffect(() => {
    if (status !== "verified") return;
    const interval = setInterval(() => {
      setPulseCount((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const handleRunVerification = () => {
    setStatus("verifying");
    const simulatedLatency = Math.floor(Math.random() * 8) + 8; // 8 - 15ms
    setLatency(simulatedLatency);

    setTimeout(() => {
      setStatus("verified");
    }, 450);
  };

  const handleSimulateTamper = () => {
    setStatus("tampered");
  };

  const handleGenerateKey = () => {
    const chars = "ABCDEF0123456789";
    const segment = (len: number) =>
      Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const newKey = `ATOM-${segment(4)}-${segment(4)}-${segment(4)}`;
    setKeyInput(newKey);
    setStatus("idle");
  };

  const sampleLoadstring = `-- AtomProtect direct loadstring
local AtomProtect = loadstring(game:HttpGet("https://YOUR_DOMAIN/api/loader/universal"))()
AtomProtect:Verify("${keyInput || "ATOM-XXXX-XXXX-XXXX"}")`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sampleLoadstring);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <Card className="mx-auto w-full max-w-4xl overflow-hidden text-left shadow-popover">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "telemetry" | "loadstring")} variant="segmented">
        {/* Title bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2 text-caption text-fg-subtle">
            <LogoMark size={16} />
            <span className="font-data">telemetry-node v2.4.0</span>
          </div>
          <TabsList aria-label="Demo view">
            <TabsTrigger value="telemetry">Live monitor</TabsTrigger>
            <TabsTrigger value="loadstring">Loadstring preview</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="telemetry" className="space-y-4 p-4 sm:p-5">
          {/* Key input + actions */}
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Input
              size="lg"
              mono
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                if (status !== "idle") setStatus("idle");
              }}
              placeholder="Enter license key (e.g. ATOM-...)"
              aria-label="License key"
              leading={<Lock />}
              className="flex-1"
            />

            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={handleRunVerification}
                disabled={status === "verifying"}
                className="flex-1 sm:flex-initial"
              >
                {status === "verifying" ? (
                  <>
                    <RefreshCw className="animate-spin motion-reduce:animate-none" />
                    <span>Verifying</span>
                  </>
                ) : (
                  <>
                    <Zap />
                    <span>Test handshake</span>
                  </>
                )}
              </Button>

              <Button
                variant="secondary"
                size="lg"
                iconOnly
                onClick={handleGenerateKey}
                title="Generate sample key"
                aria-label="Generate sample key"
              >
                <RefreshCw />
              </Button>

              <Button
                variant="secondary"
                size="lg"
                onClick={handleSimulateTamper}
                title="Simulate hook attempt to test kill-switch"
                aria-label="Simulate hook attempt"
                className={cn(
                  "hover:text-danger-text",
                  status === "tampered" && "border-danger/40 bg-danger/[0.12] text-danger-text hover:bg-danger/[0.16]",
                )}
              >
                <AlertTriangle />
                <span className="hidden sm:inline">Simulate hook</span>
              </Button>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Handshake">
              {status === "verified" && (
                <Badge tone="success" dot>
                  Authorized
                </Badge>
              )}
              {status === "verifying" && (
                <Badge tone="warning" dot>
                  Checking
                </Badge>
              )}
              {status === "tampered" && (
                <Badge tone="danger" dot>
                  Revoked
                </Badge>
              )}
              {status === "idle" && <Badge dot>Ready</Badge>}
            </Metric>

            <Metric label="Network latency">
              <Activity className="size-3.5 text-fg-subtle" />
              <span className="font-data text-body-sm text-fg">{latency} ms</span>
            </Metric>

            <Metric label="IP binding">
              <Cpu className="size-3.5 text-fg-subtle" />
              <span className="font-data text-body-sm text-fg-muted">198.51.100.24</span>
            </Metric>

            <Metric label="Heartbeat loop">
              <span className="relative flex size-2">
                {status === "verified" && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
                )}
                <span
                  className={cn("relative inline-flex size-2 rounded-full", status === "verified" ? "bg-success" : "bg-fg-disabled")}
                />
              </span>
              <span className="font-data text-body-sm text-fg-muted">
                {status === "verified" ? `${pulseCount} pulses (1s)` : "Inactive"}
              </span>
            </Metric>
          </div>

          {/* Simulated log */}
          <div
            aria-live="polite"
            className="space-y-1 overflow-x-auto rounded-md border border-line-subtle bg-canvas p-3.5 font-data text-caption leading-relaxed"
          >
            <div className="text-fg-subtle">[00:00:01] Initializing AtomProtect client runtime...</div>
            <div className="text-fg-muted">[00:00:02] Client network identified: IP bound to session slot 0</div>
            {status === "verifying" && (
              <div className="text-warning-text">[00:00:03] Cryptographic check underway for key {keyInput}...</div>
            )}
            {status === "verified" && (
              <>
                <div className="text-success-text">
                  [00:00:03] Key validated in {latency}ms. Single-device lock confirmed.
                </div>
                <div className="text-fg">
                  [00:00:04] 1-second telemetry heartbeat active. Session token:{" "}
                  <span className="text-accent-text">sess_9a8f7c1d3e2b</span>
                </div>
                <div className="text-fg-subtle">
                  [00:00:{pulseCount < 10 ? `0${pulseCount}` : pulseCount}] Heartbeat ping #{pulseCount} confirmed (200 OK)
                </div>
              </>
            )}
            {status === "tampered" && (
              <>
                <div className="font-semibold text-danger-text">
                  [ALERT] Tamper detected: getrawmetatable hook intercepted.
                </div>
                <div className="font-semibold text-danger-text">
                  [KILL-SWITCH] Session revoked immediately. Memory cleared. Execution halted.
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="loadstring" className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-sm text-fg-muted">Universal Roblox loadstring</span>
            <Button variant="secondary" size="sm" onClick={handleCopyCode}>
              {copiedCode ? (
                <>
                  <Check className="text-success-text" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy />
                  <span>Copy code</span>
                </>
              )}
            </Button>
          </div>

          <pre className="overflow-x-auto rounded-md border border-line-subtle bg-canvas p-4 font-data text-caption text-fg">
            <code>{sampleLoadstring}</code>
          </pre>

          <p className="text-body-sm text-fg-muted">
            Paste this snippet into any standard executor. The loader opens the verification UI, checks the key, and runs
            the script.
          </p>
        </TabsContent>
      </Tabs>
    </Card>
  );
}

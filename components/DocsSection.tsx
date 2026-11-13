"use client";

import React, { useState } from "react";
import { Code2, Key, Shield, HelpCircle, Copy, Check, ChevronDown } from "lucide-react";
import { Button, Card, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

type DocsTabId = "execution" | "keys" | "telemetry" | "faq";

interface DocsTab {
  id: DocsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const LOADER_SNIPPET = `loadstring(game:HttpGet("https://YOUR_DOMAIN/api/loader/YOUR_SCRIPT_SLUG"))()`;

function CodeWell({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-md border border-line-subtle bg-canvas p-4 font-data text-caption text-fg",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default function DocsSection() {
  const [activeTab, setActiveTab] = useState<DocsTabId>("execution");
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  const tabs: DocsTab[] = [
    { id: "execution", label: "In-game execution", icon: Code2 },
    { id: "keys", label: "Key whitelisting", icon: Key },
    { id: "telemetry", label: "Heartbeat and telemetry", icon: Shield },
    { id: "faq", label: "FAQ and troubleshooting", icon: HelpCircle },
  ];

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const faqs = [
    {
      q: "Why does the site say 'VPN or Proxy Detected'?",
      a: "AtomProtect locks keys to your network IP address to prevent multi-device sharing and duplicate key farming. Commercial VPNs, Tor nodes, and datacenter proxies are rejected automatically during claiming. Turn off your VPN before claiming.",
    },
    {
      q: "How long does a claimed key remain valid?",
      a: "Default claimed keys are valid for 24 hours from generation. Once expired, you can return to the claim portal and obtain a fresh key for your IP address.",
    },
    {
      q: "Does the 1-second heartbeat drop my in-game FPS?",
      a: "No. Heartbeat validation runs asynchronously on a non-blocking thread using Roblox HttpService/request. It uses less than 0.5% CPU and average ping is under 15ms.",
    },
    {
      q: "What happens if my internet disconnects or my IP changes?",
      a: "If the client fails 3 consecutive heartbeats or reports a different network IP, the server closes the session and unloads script functions from memory.",
    },
  ];

  const infoTile = "p-4";

  return (
    <section id="docs" className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6">
      <div className="mb-8 max-w-2xl">
        <h2 className="text-display font-semibold text-fg">Developer reference and setup guide</h2>
        <p className="mt-2 text-body text-fg-muted">
          How scripts execute, how IP binding works, and how to troubleshoot client verification.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocsTabId)}>
        <TabsList aria-label="Documentation topics" className="overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.id} value={tab.id}>
                <Icon />
                <span>{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <Card className="mt-5 p-5 sm:p-6">
          {/* In-game execution */}
          <TabsContent value="execution" className="space-y-6">
            <div>
              <h3 className="mb-1.5 text-title font-semibold text-fg">Executing AtomProtect scripts</h3>
              <p className="max-w-3xl text-body-sm text-fg-muted">
                AtomProtect protected scripts run through a unified loader. When you execute the loadstring, the loader
                checks for a locally saved key in your executor workspace. If none exists, an in-game UI opens
                automatically so you can paste your license key.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body-sm text-fg-muted">Standard Roblox loadstring</span>
                <Button variant="secondary" size="xs" onClick={() => handleCopy(LOADER_SNIPPET, "std-loader")}>
                  {copiedIndex === "std-loader" ? (
                    <>
                      <Check className="text-success-text" />
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
              <CodeWell>
                <code>{LOADER_SNIPPET}</code>
              </CodeWell>
            </div>

            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
              <Card variant="inset" className={infoTile}>
                <span className="mb-1 block text-body-sm font-semibold text-fg">Compatible executors</span>
                <p className="text-caption text-fg-muted">
                  Runs on Level 7/8 Windows, Android, and macOS executors that support standard HttpGet and
                  makefolder/writefile.
                </p>
              </Card>
              <Card variant="inset" className={infoTile}>
                <span className="mb-1 block text-body-sm font-semibold text-fg">Automatic key caching</span>
                <p className="text-caption text-fg-muted">
                  Your validated key is saved to <code className="font-data text-fg">AtomProtect/&lt;slug&gt;_key.txt</code>{" "}
                  so you don&apos;t retype it every execution.
                </p>
              </Card>
              <Card variant="inset" className={infoTile}>
                <span className="mb-1 block text-body-sm font-semibold text-fg">Direct memory delivery</span>
                <p className="text-caption text-fg-muted">
                  Script logic streams into memory without saving raw protected code to the player&apos;s drive.
                </p>
              </Card>
            </div>
          </TabsContent>

          {/* Key whitelisting */}
          <TabsContent value="keys" className="space-y-6">
            <div>
              <h3 className="mb-1.5 text-title font-semibold text-fg">Network binding and key protocol</h3>
              <p className="max-w-3xl text-body-sm text-fg-muted">
                Keys generated through AtomProtect enforce a single-network restriction. Each key record contains the
                client IP hash, generation timestamp, and expiration limit.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Card variant="inset" className="space-y-2 p-4">
                <span className="block text-body-sm font-semibold text-fg">Network locking rule</span>
                <p className="text-body-sm text-fg-muted">
                  When a player submits their key inside Roblox, the backend checks that the executing network matches
                  the IP recorded at claim time.
                </p>
                <CodeWell className="p-2.5 text-success-text">Claim IP: 203.0.113.15 == Exec IP: 203.0.113.15 [OK]</CodeWell>
              </Card>

              <Card variant="inset" className="space-y-2 p-4">
                <span className="block text-body-sm font-semibold text-fg">Anti-sharing protection</span>
                <p className="text-body-sm text-fg-muted">
                  If another player on a different network uses the same key, the server rejects authentication with
                  code <code className="font-data text-fg">ERR_IP_MISMATCH</code>.
                </p>
                <CodeWell className="p-2.5 text-danger-text">
                  Claim IP: 203.0.113.15 != Exec IP: 198.51.100.99 [DENIED]
                </CodeWell>
              </Card>
            </div>
          </TabsContent>

          {/* Telemetry */}
          <TabsContent value="telemetry" className="space-y-6">
            <div>
              <h3 className="mb-1.5 text-title font-semibold text-fg">1-second heartbeat and tamper detection</h3>
              <p className="max-w-3xl text-body-sm text-fg-muted">
                Active sessions continuously exchange ping signatures with the AtomProtect API to verify the execution
                environment.
              </p>
            </div>

            <CodeWell className="space-y-1.5">
              <div className="text-fg-subtle">{"// Telemetry heartbeat specification"}</div>
              <div>POST /api/session/heartbeat HTTP/1.1</div>
              <div>Host: YOUR_DOMAIN</div>
              <div>Content-Type: application/json</div>
              <div className="text-accent-text">
                &#123;&quot;session_id&quot;: &quot;sess_...&quot;, &quot;script_slug&quot;: &quot;universal&quot;,
                &quot;client_time&quot;: 1729227000&#125;
              </div>
            </CodeWell>

            <div className="space-y-3">
              <h4 className="text-body-sm font-semibold text-fg">Active tamper defenses</h4>
              <ul className="grid grid-cols-1 gap-2 text-body-sm text-fg-muted sm:grid-cols-2">
                {[
                  ["Hook detection", "Checks raw metatables and HttpGet hooks."],
                  ["Immediate session kill", "Tampered instances terminate in under 1 second."],
                  ["Memory purge", "Variables and functions clear on termination."],
                  ["Error telemetry", "Crash logs go to the staff console for debugging."],
                ].map(([title, body]) => (
                  <li key={title} className="flex items-start gap-2 rounded-md border border-line-subtle bg-surface p-3">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success-text" />
                    <span>
                      <strong className="font-semibold text-fg">{title}:</strong> {body}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          {/* FAQ */}
          <TabsContent value="faq" className="space-y-2">
            <h3 className="mb-3 text-title font-semibold text-fg">Frequently asked questions</h3>
            {faqs.map((faq, idx) => {
              const open = expandedFaq === idx;
              return (
                <div key={idx} className="overflow-hidden rounded-md border border-line bg-surface">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setExpandedFaq(open ? null : idx)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 p-3.5 text-left text-body-sm font-medium text-fg transition-colors hover:bg-surface-hover",
                      focusRing,
                    )}
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
                    />
                  </button>
                  {open && (
                    <div className="border-t border-line-subtle px-3.5 pb-3.5 pt-2.5 text-body-sm text-fg-muted">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Card>
      </Tabs>
    </section>
  );
}

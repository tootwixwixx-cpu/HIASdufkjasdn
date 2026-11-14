// app/page.tsx
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Key, ShieldCheck, Cpu, Lock, Terminal, ChevronRight, ExternalLink, FileCode, Activity, Check } from "lucide-react";
import { dbService } from "@/lib/store";
import ClaimScriptModal, { ScriptSummary } from "@/components/ClaimScriptModal";
import InteractiveTelemetryDemo from "@/components/InteractiveTelemetryDemo";
import { Badge, Card, LogoMark, buttonClasses } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

export const revalidate = 0;

const FEATURES = [
  {
    icon: Key,
    title: "Single-device network binding",
    body: "Every key is cryptographically bound to the claimant network IP during generation. If another user on a different network attempts execution with the same key, authentication is rejected instantly.",
    note: "VPN and datacenter proxy filtering",
  },
  {
    icon: Cpu,
    title: "In-game UI loader",
    body: "The universal loadstring draws a verification interface inside the Roblox client. Users paste their key once; later launches authenticate automatically against a locally cached token.",
    note: "Works on Windows, Android, and macOS executors",
  },
  {
    icon: Activity,
    title: "1-second anti-tamper heartbeat",
    body: "The client thread keeps a handshake going every 1000ms. Tampering with global metatables, detouring HTTP requests, or attaching debuggers halts the heartbeat and drops script memory.",
    note: "Sub-15ms round-trip validation",
  },
  {
    icon: Terminal,
    title: "Modular memory streaming",
    body: "Scripts never save raw Lua payloads to player storage. Code chunks stream encrypted over HTTPS straight into executor memory, which defeats static file dumps.",
    note: "Remote script updates and hot-patching",
  },
] as const;

export default async function HomePage() {
  const [settings, allScripts] = await Promise.all([
    dbService.getSettings(),
    // Metadata only: the public landing page must never pull every script's multi-MB payload columns.
    dbService.getScriptsLite(),
  ]);

  const activeScripts: ScriptSummary[] = (allScripts || [])
    .filter((s) => s.is_active !== false)
    .map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      use_auth: s.use_auth !== false,
      watermark_text: s.watermark_text,
    }));

  const discordUrl =
    settings.discord_invite_url &&
    settings.discord_invite_url !== "https://discord.gg/" &&
    settings.discord_invite_url !== "https://discord.gg/yourserver"
      ? settings.discord_invite_url
      : "https://discord.gg/NdrTc27GxT";

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <Navbar scripts={activeScripts} discordUrl={discordUrl} />

      {/* Hero: the live telemetry demo is the centerpiece */}
      <section className="relative overflow-hidden border-b border-line bg-dot-matrix px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-canvas/40 via-canvas/70 to-canvas" />

        <div className="relative z-10 mx-auto max-w-5xl">
          <div className="max-w-3xl">
            <h1 className="text-balance text-display font-semibold text-fg sm:text-hero">
              Single-device IP whitelisting and live heartbeat protection
            </h1>
            <p className="mt-5 max-w-2xl text-body text-fg-muted sm:text-[16px] sm:leading-[26px]">
              Distribute Roblox scripts securely. Generate license keys bound to claimant network IPs, verify players
              through an in-game UI loader, and monitor sessions in real time.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <ClaimScriptModal scripts={activeScripts} buttonText="Claim license key" variant="primary" size="lg" />
              <a
                href={discordUrl}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "secondary", size: "lg" })}
              >
                <span>Join Discord</span>
                <ExternalLink className="text-fg-subtle" />
              </a>
              <a href="#scripts" className={buttonClasses({ variant: "ghost", size: "lg" })}>
                <FileCode />
                <span>Available scripts</span>
              </a>
            </div>
          </div>

          <div id="telemetry" className="mt-14 scroll-mt-20">
            <InteractiveTelemetryDemo />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="features" className="mx-auto w-full max-w-5xl scroll-mt-16 px-4 py-20 sm:px-6">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-display font-semibold text-fg">Built for zero-leak script execution</h2>
          <p className="mt-2 text-body text-fg-muted">
            Four defensive layers keep script source from being dumped, shared across networks, or cracked.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body, note }) => (
            <Card key={title} className="flex flex-col p-5">
              <span className="flex size-9 items-center justify-center rounded-md border border-line bg-surface text-accent-text">
                <Icon className="size-4" />
              </span>
              <h3 className="mt-4 text-title font-semibold text-fg">{title}</h3>
              <p className="mt-1.5 flex-1 text-body-sm text-fg-muted">{body}</p>
              <p className="mt-4 flex items-center gap-1.5 border-t border-line-subtle pt-3 text-caption text-fg-subtle">
                <Check className="size-3.5 text-success-text" />
                {note}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {/* Scripts */}
      {activeScripts.length > 0 && (
        <section id="scripts" className="w-full scroll-mt-16 border-t border-line">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div className="flex items-center gap-2.5">
                <h2 className="text-heading font-semibold text-fg">Protected scripts</h2>
                <Badge mono>{activeScripts.length}</Badge>
              </div>
              <p className="text-body-sm text-fg-subtle">Pick a script to claim a key for it.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {activeScripts.map((s) => (
                <Card key={s.id} className="flex flex-col">
                  <div className="flex-1 space-y-2.5 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-title font-semibold text-fg">{s.name}</h3>
                      {s.use_auth !== false ? (
                        <Badge tone="accent">
                          <Lock className="size-3" />
                          IP locked
                        </Badge>
                      ) : (
                        <Badge>Direct</Badge>
                      )}
                    </div>

                    <p className="text-body-sm text-fg-muted">
                      {s.use_auth !== false
                        ? "Requires a license key bound to the claimant's IP."
                        : "Runs directly without license verification."}
                    </p>

                    <div className="flex items-center justify-between gap-2 rounded-md border border-line-subtle bg-canvas px-2.5 py-2 font-data text-caption text-fg-muted">
                      <span className="truncate">loadstring(game:HttpGet(&quot;.../api/loader/{s.slug}&quot;))()</span>
                      <span className="shrink-0 text-fg-subtle">/{s.slug}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                    <span className="truncate text-caption text-fg-subtle">{s.watermark_text || "AtomProtect"}</span>
                    <Link
                      href={`/claim?script=${encodeURIComponent(s.slug)}`}
                      className={buttonClasses({ variant: "secondary", size: "sm" })}
                    >
                      <span>Claim key</span>
                      <ChevronRight />
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Terms of service */}
      <section className="mt-auto border-t border-line bg-surface px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-fg-subtle" />
            <h2 className="text-title font-semibold text-fg">Terms of service and usage policy</h2>
          </div>

          <div className="mt-4 max-w-3xl whitespace-pre-line rounded-lg border border-line bg-canvas p-4 text-body-sm text-fg-muted">
            {settings.tos_content ||
              "Keys are bound to claimant IP addresses. VPNs and proxies are blocked. Multi-device key sharing results in automatic revocation."}
          </div>

          <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-caption text-fg-subtle">
            <li>Keys are bound to your network IP</li>
            <li>Commercial VPN and proxy traffic is blocked</li>
            <li>One active key per IP address</li>
          </ul>
        </div>
      </section>

      {/* Footer (lock icon is the staff console link) */}
      <footer className="border-t border-line bg-canvas px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 text-caption text-fg-subtle">
          <span className="flex items-center gap-2">
            <LogoMark size={14} tone="mono" className="text-fg-subtle" />
            &copy; {new Date().getFullYear()} AtomProtect. All rights reserved.
          </span>
          <div className="flex items-center gap-3">
            <a
              href={discordUrl}
              target="_blank"
              rel="noreferrer"
              className={cn("rounded-sm transition-colors hover:text-fg", focusRing)}
            >
              Community Discord
            </a>
            <Link
              href="/login"
              className={cn("rounded-sm p-1 text-fg-disabled transition-colors hover:text-fg-muted", focusRing)}
              title="Staff console"
              aria-label="Staff console"
            >
              <Lock className="size-3" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

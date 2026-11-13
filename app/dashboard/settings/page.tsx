// app/dashboard/settings/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import type { SystemSettings } from "@/lib/store";
import { Check, Code, Save, ShieldBan, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Switch,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableToolbar,
} from "@/components/ui";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>({
    claim_method: "checkpoints",
    checkpoint_delay_seconds: 5,
    discord_guild_id: "",
    discord_bot_token: "",
    discord_invite_url: "https://discord.gg/",
    vpn_detection_enabled: true,
    tos_content: "",
  });

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [schemaCopied, setSchemaCopied] = useState(false);

  // IP Blacklist State
  const [bannedIps, setBannedIps] = useState<Record<string, { reason: string; banned_at: string }>>({});
  const [newBanIp, setNewBanIp] = useState("");
  const [newBanReason, setNewBanReason] = useState("");
  const [banningIp, setBanningIp] = useState(false);
  const [banSearchQuery, setBanSearchQuery] = useState("");
  const [banNotice, setBanNotice] = useState<string | null>(null);

  const fetchBannedIps = async () => {
    try {
      const res = await fetch("/api/ip-bans");
      const data = await res.json();
      if (data.banned_ips) setBannedIps(data.banned_ips);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
      })
      .catch((err) => console.error(err));
    fetchBannedIps();
  }, []);

  const handleBanIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanIp.trim()) return;
    setBanningIp(true);
    try {
      const res = await fetch("/api/ip-bans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: newBanIp.trim(),
          reason: newBanReason.trim() || "Manual blacklist from Settings console",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setBanNotice(`IP ${newBanIp.trim()} blacklisted successfully.`);
        setTimeout(() => setBanNotice(null), 3000);
        setNewBanIp("");
        setNewBanReason("");
        fetchBannedIps();
      } else {
        alert(data.error || "Failed to ban IP");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setBanningIp(false);
    }
  };

  const handleUnbanIp = async (ip: string) => {
    try {
      const res = await fetch(`/api/ip-bans?ip=${encodeURIComponent(ip)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setBanNotice(`IP ${ip} removed from blacklist.`);
        setTimeout(() => setBanNotice(null), 3000);
        fetchBannedIps();
      } else {
        alert(data.error || "Failed to unban IP");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const copySqlSchema = () => {
    fetch("/supabase_schema.sql")
      .then((res) => res.text())
      .then((sql) => {
        navigator.clipboard?.writeText(sql);
        setSchemaCopied(true);
        setTimeout(() => setSchemaCopied(false), 2000);
      })
      .catch(() => {
        // Fallback: copy generic instruction
        navigator.clipboard?.writeText("-- Please copy supabase_schema.sql from project root");
      });
  };

  const claimOptions = [
    {
      id: "checkpoints" as const,
      title: "Security checkpoints",
      body: "Users pass a timed validation with an anti-VPN check. No Discord bot needed.",
    },
    {
      id: "discord_oauth" as const,
      title: "Discord verification",
      body: "Users must join your Discord server before claiming. The key binds to their Discord ID.",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="text-heading font-semibold text-fg">Settings</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Database, claim verification, anti-VPN gateway, IP blacklist and terms of service.
          </p>
        </div>

        <Button variant="primary" onClick={handleSave} loading={saving}>
          {saveSuccess ? <Check /> : <Save />}
          {saveSuccess ? "Saved" : "Save settings"}
        </Button>
      </div>

      {/* Supabase */}
      <Card>
        <CardHeader
          divided
          title="Supabase backend"
          description="PostgreSQL schema, migrations and API connectivity."
          actions={
            <Button size="sm" onClick={copySqlSchema}>
              {schemaCopied ? <Check className="text-success-text" /> : <Code />}
              {schemaCopied ? "Schema copied" : "Copy Supabase SQL"}
            </Button>
          }
        />
        <CardBody className="space-y-2 text-body-sm text-fg-muted">
          <p>
            1. In Supabase, open <strong className="text-fg">SQL Editor</strong>, paste the copied schema and run it to create every
            table and index.
          </p>
          <p>
            2. Set these in <code className="font-data text-fg">.env.local</code>:
          </p>
          <pre className="rounded-md border border-line-subtle bg-canvas px-3 py-2 font-data text-caption text-fg select-all">
            NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co{"\n"}SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
          </pre>
          <p className="text-caption text-fg-subtle">Without Supabase keys the site keeps running on a local database fallback.</p>
        </CardBody>
      </Card>

      {/* Claim method */}
      <Card>
        <CardHeader divided title="Key claim verification" />
        <CardBody className="space-y-3">
          <div role="radiogroup" aria-label="Claim method" className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {claimOptions.map((opt) => {
              const selected = settings.claim_method === opt.id;
              return (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                    selected ? "border-accent/60 bg-accent/[0.07]" : "border-line bg-surface hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="claim_method"
                    checked={selected}
                    onChange={() => setSettings({ ...settings, claim_method: opt.id })}
                    className="mt-0.5 accent-[rgb(var(--accent))]"
                  />
                  <span>
                    <span className="block text-body-sm font-medium text-fg">{opt.title}</span>
                    <span className="block text-caption text-fg-muted">{opt.body}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {settings.claim_method === "discord_oauth" && (
            <div className="space-y-3 border-t border-line pt-3">
              <Field label="Discord server invite URL" htmlFor="discord-invite">
                <Input
                  id="discord-invite"
                  value={settings.discord_invite_url}
                  onChange={(e) => setSettings({ ...settings, discord_invite_url: e.target.value })}
                  placeholder="https://discord.gg/yourserver"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Guild (server) ID" htmlFor="discord-guild">
                  <Input
                    id="discord-guild"
                    mono
                    value={settings.discord_guild_id}
                    onChange={(e) => setSettings({ ...settings, discord_guild_id: e.target.value })}
                    placeholder="e.g. 119283746592837465"
                  />
                </Field>
                <Field label="Bot token" htmlFor="discord-token" aside="Optional">
                  <Input
                    id="discord-token"
                    mono
                    type="password"
                    value={settings.discord_bot_token}
                    onChange={(e) => setSettings({ ...settings, discord_bot_token: e.target.value })}
                    placeholder="Bot token"
                  />
                </Field>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Anti-VPN */}
      <Card>
        <CardHeader divided title="Security & anti-VPN" />
        <CardBody>
          <Switch
            checked={settings.vpn_detection_enabled}
            onCheckedChange={(checked) => setSettings({ ...settings, vpn_detection_enabled: checked })}
            label="Block VPNs and datacenter proxies on key claim"
            description="Rejects VPN and proxy IPs and asks the claimant to turn off their VPN before getting a key."
          />
        </CardBody>
      </Card>

      {/* IP blacklist */}
      <Card>
        <CardHeader
          divided
          title={
            <span className="flex items-center gap-2">
              IP blacklist
              <Badge tone="danger" mono>
                {Object.keys(bannedIps).length}
              </Badge>
            </span>
          }
          description="Block abusive networks, bot farms and scrapers from loaders and API endpoints."
        />
        <CardBody className="space-y-3">
          {banNotice && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-body-sm text-success-text">
              <Check className="size-4" />
              <span>{banNotice}</span>
            </div>
          )}

          <form onSubmit={handleBanIp} className="grid grid-cols-1 items-end gap-3 md:grid-cols-12">
            <Field label="IP address" htmlFor="settings-ban-ip" className="md:col-span-4">
              <Input
                id="settings-ban-ip"
                mono
                value={newBanIp}
                onChange={(e) => setNewBanIp(e.target.value)}
                placeholder="e.g. 45.33.32.1"
                required
              />
            </Field>
            <Field label="Reason" htmlFor="settings-ban-reason" className="md:col-span-5">
              <Input
                id="settings-ban-reason"
                value={newBanReason}
                onChange={(e) => setNewBanReason(e.target.value)}
                placeholder="e.g. Key cracking, scraper bot, DDoS"
              />
            </Field>
            <div className="md:col-span-3">
              <Button type="submit" variant="danger" className="w-full" loading={banningIp} disabled={!newBanIp.trim()}>
                <ShieldBan />
                Ban IP
              </Button>
            </div>
          </form>

          <div>
            <TableToolbar className="justify-between">
              <span className="text-caption font-medium text-fg-muted">Current blacklist</span>
              <Input
                size="sm"
                leading={<Search />}
                value={banSearchQuery}
                onChange={(e) => setBanSearchQuery(e.target.value)}
                placeholder="Search IP or reason"
                aria-label="Search blacklist"
                className="w-56"
              />
            </TableToolbar>
            <Table containerClassName="max-h-60">
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead align="right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.keys(bannedIps).length === 0 ? (
                  <TableEmpty colSpan={4} title="No banned IPs" />
                ) : (
                  Object.entries(bannedIps)
                    .filter(([ip, data]) => {
                      if (!banSearchQuery.trim()) return true;
                      const q = banSearchQuery.toLowerCase();
                      return ip.toLowerCase().includes(q) || (data.reason || "").toLowerCase().includes(q);
                    })
                    .map(([ip, data]) => (
                      <TableRow key={ip}>
                        <TableCell mono className="text-danger-text">
                          {ip}
                        </TableCell>
                        <TableCell truncate={360}>{data.reason}</TableCell>
                        <TableCell mono muted>
                          {new Date(data.banned_at).toLocaleDateString()}
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
        </CardBody>
      </Card>

      {/* Terms of service */}
      <Card>
        <CardHeader divided title="Terms of service" description="Shown publicly on the homepage." />
        <CardBody>
          <Textarea
            mono
            rows={8}
            value={settings.tos_content}
            onChange={(e) => setSettings({ ...settings, tos_content: e.target.value })}
            aria-label="Terms of service content"
          />
        </CardBody>
      </Card>
    </div>
  );
}

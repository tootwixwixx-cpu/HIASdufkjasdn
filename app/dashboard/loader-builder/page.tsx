// app/dashboard/loader-builder/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import RobloxLoaderPreview, {
  LayoutElementId,
  ElementPosition,
  LayoutPositions,
  DEFAULT_LAYOUT_POSITIONS,
} from "@/components/RobloxLoaderPreview";
import type { LoaderConfigRecord, ScriptRecord } from "@/lib/store";
import {
  Sliders,
  Save,
  Check,
  AlertCircle,
  Bell,
  RotateCcw,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  Layers,
  Maximize2,
  ListOrdered,
  Type,
  MessageSquare,
  Sparkles,
  Plus,
} from "lucide-react";
import { Button, Card, CardHeader, CardBody, Field, Input, Select, Switch, Tabs, TabsList, TabsTrigger } from "@/components/ui";

export default function LoaderBuilderPage() {
  const [configs, setConfigs] = useState<LoaderConfigRecord[]>([]);
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Form State
  const [configId, setConfigId] = useState<string>("");
  const [name, setName] = useState("Dark Theme (Default)");
  const [brandName, setBrandName] = useState("AtomProtect");
  const [title, setTitle] = useState("Key System");
  const [customSubtitle, setCustomSubtitle] = useState("Enter your license key below");
  const [keyPlaceholder, setKeyPlaceholder] = useState("Paste your license key here...");
  const [verifyButtonText, setVerifyButtonText] = useState("VERIFY KEY");
  const [claimButtonText, setClaimButtonText] = useState("CLAIM YOUR KEY (COPY LINK)");
  const [showDiscordButton, setShowDiscordButton] = useState(false);
  const [discordButtonText, setDiscordButtonText] = useState("JOIN DISCORD");
  const [discordInviteUrl, setDiscordInviteUrl] = useState("https://discord.gg/NdrTc27GxT");
  const [showWatermark, setShowWatermark] = useState(true);
  const [watermarkText, setWatermarkText] = useState("AtomProtect");

  // Custom Status Messages
  const [statusVerifying, setStatusVerifying] = useState("Checking license key...");
  const [statusVerified, setStatusVerified] = useState("Access Granted! Loading script...");
  const [statusExpired, setStatusExpired] = useState("License key expired or invalid.");
  const [statusError, setStatusError] = useState("Verification failed. Check network or key.");

  // Colors & Geometry
  const [accentColor, setAccentColor] = useState("#00a2ff");
  const [backgroundColor, setBackgroundColor] = useState("#16161e");
  const [cardColor, setCardColor] = useState("#21222e");
  const [textColor, setTextColor] = useState("#ffffff");
  const [subtextColor, setSubtextColor] = useState("#9ca3af");
  const [cornerRadius, setCornerRadius] = useState(10);
  const [frameWidth, setFrameWidth] = useState(360);
  const [frameHeight, setFrameHeight] = useState(250);
  const [fontFace, setFontFace] = useState("GothamMedium");

  // Layout Positions State (Figma drag & drop)
  const [layoutPositions, setLayoutPositions] = useState<LayoutPositions>(DEFAULT_LAYOUT_POSITIONS);
  const [selectedElementId, setSelectedElementId] = useState<LayoutElementId | null>("keyBox");

  // Webhook State
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testWebhookStatus, setTestWebhookStatus] = useState<"success" | "error" | null>(null);

  const handleTestWebhook = async () => {
    const url = webhookUrl.trim();
    if (!url || !url.startsWith("https://discord.com/api/webhooks/")) {
      setValidationError("Please enter a valid Discord webhook URL before testing.");
      return;
    }
    setTestingWebhook(true);
    setTestWebhookStatus(null);
    setValidationError(null);
    try {
      const res = await fetch("/api/loader-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_webhook",
          webhook_url: url,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestWebhookStatus("success");
      } else {
        setTestWebhookStatus("error");
        setValidationError(data.error || "Discord rejected the webhook.");
      }
    } catch (err: unknown) {
      setTestWebhookStatus("error");
      setValidationError(err instanceof Error ? err.message : "Failed to connect to Discord.");
    } finally {
      setTestingWebhook(false);
      setTimeout(() => setTestWebhookStatus(null), 5000);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchScripts();
  }, []);

  const fetchConfigs = async (targetId?: string) => {
    try {
      const res = await fetch("/api/loader-configs");
      const data = await res.json();
      if (data.configs && data.configs.length > 0) {
        setConfigs(data.configs);
        if (targetId) {
          const found = data.configs.find((c: LoaderConfigRecord) => c.id === targetId);
          if (found) loadConfig(found);
        } else if (!configId) {
          loadConfig(data.configs[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchScripts = async () => {
    try {
      const res = await fetch("/api/scripts");
      const data = await res.json();
      if (data.scripts) {
        setScripts(data.scripts);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadConfig = (cfg: LoaderConfigRecord) => {
    setConfigId(cfg.id);
    setName(cfg.name);
    setBrandName(cfg.brand_name);
    setTitle(cfg.title);
    setCustomSubtitle(cfg.custom_subtitle);
    setKeyPlaceholder(cfg.key_placeholder || "Paste your license key here...");
    setVerifyButtonText(cfg.verify_button_text || "VERIFY KEY");
    setClaimButtonText(cfg.claim_button_text || "CLAIM YOUR KEY (COPY LINK)");
    setShowDiscordButton(Boolean(cfg.show_discord_button));
    setDiscordButtonText(cfg.discord_button_text || "JOIN DISCORD");
    setDiscordInviteUrl(cfg.discord_invite_url || "https://discord.gg/NdrTc27GxT");
    setShowWatermark(cfg.show_watermark !== false);
    setWatermarkText(cfg.watermark_text || "AtomProtect");
    setStatusVerifying(cfg.status_verifying || "Checking license key...");
    setStatusVerified(cfg.status_verified || "Access Granted! Loading script...");
    setStatusExpired(cfg.status_expired || "License key expired or invalid.");
    setStatusError(cfg.status_error || "Verification failed. Check network or key.");

    setAccentColor(cfg.accent_color);
    setBackgroundColor(cfg.background_color);
    setCardColor(cfg.card_color);
    setTextColor(cfg.text_color);
    setSubtextColor(cfg.subtext_color);
    setCornerRadius(cfg.corner_radius);
    setFrameWidth(cfg.frame_width);
    setFrameHeight(cfg.frame_height);
    setFontFace(cfg.font_face);
    setWebhookEnabled(Boolean(cfg.webhook_enabled));
    setWebhookUrl(cfg.webhook_url || "");

    if (cfg.layout_positions && Object.keys(cfg.layout_positions).length > 0) {
      setLayoutPositions({
        ...DEFAULT_LAYOUT_POSITIONS,
        ...cfg.layout_positions,
      } as LayoutPositions);
    } else {
      setLayoutPositions(DEFAULT_LAYOUT_POSITIONS);
    }

    const boundScript = scripts.find((s) => s.loader_config_id === cfg.id);
    setSelectedScriptId(boundScript ? boundScript.id : "all");

    setValidationError(null);
  };

  const applyColorTheme = (theme: { accent: string; bg: string; card: string }) => {
    setAccentColor(theme.accent);
    setBackgroundColor(theme.bg);
    setCardColor(theme.card);
  };

  const handlePositionChange = (elementId: LayoutElementId, pos: ElementPosition) => {
    setLayoutPositions((prev) => ({
      ...prev,
      [elementId]: pos,
    }));
  };

  const handleCenterElement = () => {
    if (!selectedElementId) return;
    const current = layoutPositions[selectedElementId];
    const elemWidth = current.w || frameWidth - 30;
    const centeredX = Math.max(0, Math.round((frameWidth - elemWidth) / 2));
    handlePositionChange(selectedElementId, {
      ...current,
      x: centeredX,
    });
  };

  const handleAlignLeft = () => {
    if (!selectedElementId) return;
    const current = layoutPositions[selectedElementId];
    handlePositionChange(selectedElementId, {
      ...current,
      x: 15,
    });
  };

  const handleFullWidth = () => {
    if (!selectedElementId) return;
    const current = layoutPositions[selectedElementId];
    handlePositionChange(selectedElementId, {
      ...current,
      x: 15,
      w: Math.max(160, frameWidth - 30),
    });
  };

  const handleAutoDistribute = () => {
    const visibleElements: LayoutElementId[] = showDiscordButton
      ? ["subtitle", "keyBox", "verifyBtn", "claimBtn", "discordBtn"]
      : ["subtitle", "keyBox", "verifyBtn", "claimBtn"];

    const topY = 50;
    const bottomMargin = 14;
    const availableH = frameHeight - topY - bottomMargin;

    const heights: Record<LayoutElementId, number> = {
      subtitle: layoutPositions.subtitle?.h || 20,
      keyBox: layoutPositions.keyBox?.h || 40,
      verifyBtn: layoutPositions.verifyBtn?.h || 38,
      claimBtn: layoutPositions.claimBtn?.h || 34,
      discordBtn: layoutPositions.discordBtn?.h || 30,
    };

    const totalElemH = visibleElements.reduce((acc, id) => acc + heights[id], 0);
    const remainingSpace = Math.max(0, availableH - totalElemH);
    const gap = visibleElements.length > 1 ? Math.floor(remainingSpace / (visibleElements.length - 1)) : 8;

    let curY = topY;
    const updated = { ...layoutPositions };
    for (const id of visibleElements) {
      updated[id] = {
        ...updated[id],
        y: curY,
      };
      curY += heights[id] + gap;
    }
    setLayoutPositions(updated);
  };

  const handleResetLayout = () => {
    const defaultW = Math.max(160, frameWidth - 30);
    setLayoutPositions({
      subtitle: { x: 15, y: 52, w: defaultW, h: 20 },
      keyBox: { x: 15, y: 78, w: defaultW, h: 40 },
      verifyBtn: { x: 15, y: 132, w: defaultW, h: 38 },
      claimBtn: { x: 15, y: 178, w: defaultW, h: 34 },
      discordBtn: { x: 15, y: 218, w: defaultW, h: 30 },
    });
  };

  const handleSave = async () => {
    setValidationError(null);

    if (webhookEnabled) {
      if (!webhookUrl.trim() || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
        setValidationError(
          "You enabled Discord Webhook Logging, so you must enter a valid Discord webhook URL to save."
        );
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/loader-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: configId || undefined,
          name,
          brand_name: brandName,
          title,
          custom_subtitle: customSubtitle,
          key_placeholder: keyPlaceholder,
          verify_button_text: verifyButtonText,
          claim_button_text: claimButtonText,
          show_discord_button: showDiscordButton,
          discord_button_text: discordButtonText,
          discord_invite_url: discordInviteUrl,
          show_watermark: showWatermark,
          watermark_text: watermarkText,
          status_verifying: statusVerifying,
          status_verified: statusVerified,
          status_expired: statusExpired,
          status_error: statusError,
          accent_color: accentColor,
          background_color: backgroundColor,
          card_color: cardColor,
          text_color: textColor,
          subtext_color: subtextColor,
          corner_radius: cornerRadius,
          frame_width: frameWidth,
          frame_height: frameHeight,
          font_face: fontFace,
          webhook_enabled: webhookEnabled,
          webhook_url: webhookUrl.trim(),
          layout_positions: layoutPositions,
        }),
      });

      const data = await res.json();
      if (data.config) {
        // Always link scripts so execution webhooks and loader styles apply
        if (selectedScriptId && selectedScriptId !== "all") {
          const targetScript = scripts.find((s) => s.id === selectedScriptId);
          if (targetScript) {
            await fetch("/api/scripts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...targetScript,
                loader_config_id: data.config.id,
              }),
            });
          }
        } else {
          // Link all scripts that do not have a custom loader config or when "all" is selected
          for (const s of scripts) {
            if (!s.loader_config_id || s.loader_config_id === data.config.id || selectedScriptId === "all") {
              await fetch("/api/scripts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...s,
                  loader_config_id: data.config.id,
                }),
              });
            }
          }
        }

        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
        await fetchConfigs(data.config.id);
      }
    } catch (err) {
      console.error("Error saving config", err);
      setValidationError("Failed to save loader configuration.");
    } finally {
      setSaving(false);
    }
  };

  const currentPreviewConfig: Partial<LoaderConfigRecord> = {
    brand_name: brandName,
    title,
    custom_subtitle: customSubtitle,
    key_placeholder: keyPlaceholder,
    verify_button_text: verifyButtonText,
    claim_button_text: claimButtonText,
    show_discord_button: showDiscordButton,
    discord_button_text: discordButtonText,
    discord_invite_url: discordInviteUrl,
    show_watermark: showWatermark,
    watermark_text: watermarkText,
    accent_color: accentColor,
    background_color: backgroundColor,
    card_color: cardColor,
    text_color: textColor,
    subtext_color: subtextColor,
    corner_radius: cornerRadius,
    frame_width: frameWidth,
    frame_height: frameHeight,
    font_face: fontFace,
    layout_positions: layoutPositions,
  };

  const selectedPos = selectedElementId ? layoutPositions[selectedElementId] : null;

  const themePresets = [
    { label: "Cyan", swatch: "#00a2ff", theme: { accent: "#00a2ff", bg: "#16161e", card: "#21222e" } },
    { label: "Neon purple", swatch: "#a855f7", theme: { accent: "#a855f7", bg: "#13111c", card: "#1e1b2e" } },
    { label: "Emerald", swatch: "#10b981", theme: { accent: "#10b981", bg: "#0d1612", card: "#13231c" } },
    { label: "Crimson", swatch: "#f43f5e", theme: { accent: "#f43f5e", bg: "#190e11", card: "#281419" } },
  ];

  const textFields: { id: string; label: string; value: string; set: (v: string) => void; placeholder?: string; wide?: boolean }[] = [
    { id: "lb-brand", label: "Brand name", value: brandName, set: setBrandName },
    { id: "lb-title", label: "Window title", value: title, set: setTitle },
    { id: "lb-subtitle", label: "Subtitle / prompt", value: customSubtitle, set: setCustomSubtitle, wide: true },
    { id: "lb-key-ph", label: "Key box placeholder", value: keyPlaceholder, set: setKeyPlaceholder },
    { id: "lb-verify", label: "Verify button", value: verifyButtonText, set: setVerifyButtonText },
    { id: "lb-claim", label: "Claim button", value: claimButtonText, set: setClaimButtonText, wide: true },
  ];

  const statusFields: { id: string; label: string; value: string; set: (v: string) => void; placeholder: string }[] = [
    { id: "lb-st-verifying", label: "Verifying", value: statusVerifying, set: setStatusVerifying, placeholder: "Checking license key..." },
    { id: "lb-st-verified", label: "Verified", value: statusVerified, set: setStatusVerified, placeholder: "Access Granted! Loading script..." },
    { id: "lb-st-expired", label: "Expired key", value: statusExpired, set: setStatusExpired, placeholder: "License key expired or invalid." },
    { id: "lb-st-error", label: "Network error", value: statusError, set: setStatusError, placeholder: "Verification failed. Check network or key." },
  ];

  const colorFields = [
    { label: "Accent", value: accentColor, set: setAccentColor },
    { label: "Background", value: backgroundColor, set: setBackgroundColor },
    { label: "Card", value: cardColor, set: setCardColor },
  ];

  const sizeFields = [
    { label: "Radius", value: cornerRadius, set: setCornerRadius, min: 0, max: 20 },
    { label: "Width", value: frameWidth, set: setFrameWidth, min: 280, max: 440 },
    { label: "Height", value: frameHeight, set: setFrameHeight, min: 220, max: 380 },
  ];

  const sectionTitle = "text-caption font-medium text-fg-muted";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="text-heading font-semibold text-fg">Auth loader builder</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Lay out the Roblox key screen: drag and resize elements, edit text and colors, then save to generate the Luau.
          </p>
        </div>

        <Button variant="primary" onClick={handleSave} loading={saving}>
          {savedSuccess ? <Check /> : <Save />}
          {savedSuccess ? "Saved & attached" : "Save loader style"}
        </Button>
      </div>

      {validationError && (
        <div className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-body-sm text-danger-text">
          <AlertCircle className="size-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        {/* Editor panel */}
        <Card className="divide-y divide-line lg:col-span-5">
          {/* Presets */}
          <div className="space-y-3 px-4 py-3">
            <Field label="Saved preset" htmlFor="lb-preset">
              <div className="flex items-center gap-2">
                <Select
                  id="lb-preset"
                  value={configId}
                  onChange={(e) => {
                    const found = configs.find((c) => c.id === e.target.value);
                    if (found) loadConfig(found);
                  }}
                >
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button
                  onClick={() => {
                    setConfigId("");
                    setName("Custom Theme (Copy)");
                  }}
                >
                  <Plus />
                  New
                </Button>
              </div>
            </Field>

            <div className="flex flex-col gap-1.5">
              <span className={sectionTitle}>Quick palette</span>
              <div className="grid grid-cols-4 gap-1.5">
                {themePresets.map((t) => (
                  <Button key={t.label} size="sm" onClick={() => applyColorTheme(t.theme)} className="justify-start">
                    <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: t.swatch }} />
                    <span className="truncate">{t.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Text */}
          <div className="space-y-3 px-4 py-3">
            <h3 className={sectionTitle}>Titles & button labels</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              {textFields.map((f) => (
                <Field key={f.id} label={f.label} htmlFor={f.id} className={f.wide ? "col-span-2" : undefined}>
                  <Input id={f.id} size="sm" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} />
                </Field>
              ))}
            </div>

            <h3 className={`${sectionTitle} pt-1`}>Status messages</h3>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              {statusFields.map((f) => (
                <Field key={f.id} label={f.label} htmlFor={f.id}>
                  <Input id={f.id} size="sm" value={f.value} onChange={(e) => f.set(e.target.value)} placeholder={f.placeholder} />
                </Field>
              ))}
            </div>
          </div>

          {/* Discord button */}
          <div className="space-y-2.5 px-4 py-3">
            <Switch
              checked={showDiscordButton}
              onCheckedChange={setShowDiscordButton}
              label="Discord community button"
              description="Adds a button on the loader that opens your Discord invite."
            />
            {showDiscordButton && (
              <div className="grid grid-cols-2 gap-3 pl-11">
                <Field label="Button text" htmlFor="lb-discord-text">
                  <Input id="lb-discord-text" size="sm" value={discordButtonText} onChange={(e) => setDiscordButtonText(e.target.value)} />
                </Field>
                <Field label="Invite URL" htmlFor="lb-discord-url">
                  <Input
                    id="lb-discord-url"
                    size="sm"
                    type="url"
                    mono
                    value={discordInviteUrl}
                    onChange={(e) => setDiscordInviteUrl(e.target.value)}
                    placeholder="https://discord.gg/..."
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Watermark */}
          <div className="space-y-2.5 px-4 py-3">
            <Switch
              checked={showWatermark}
              onCheckedChange={setShowWatermark}
              label="In-game watermark"
              description="Shows a small title bar at the top of the player's screen while the script runs."
            />
            {showWatermark && (
              <div className="pl-11">
                <Field label="Watermark title" htmlFor="lb-watermark">
                  <Input id="lb-watermark" size="sm" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} />
                </Field>
              </div>
            )}
          </div>

          {/* Webhook */}
          <div className="space-y-2.5 px-4 py-3">
            <Switch
              checked={webhookEnabled}
              onCheckedChange={setWebhookEnabled}
              label="Execution webhook"
              description="Sends each run (user, IP, ISP, OS, executor, key last 4, pass/fail) to a Discord channel."
            />
            {webhookEnabled && (
              <div className="pl-11">
                <Field
                  label="Discord webhook URL"
                  htmlFor="lb-webhook"
                  aside="Required"
                  hint={testWebhookStatus === "success" ? "Test sent. Check your Discord channel." : undefined}
                >
                  <div className="flex gap-2">
                    <Input
                      id="lb-webhook"
                      size="sm"
                      type="url"
                      mono
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://discord.com/api/webhooks/..."
                    />
                    <Button size="sm" loading={testingWebhook} disabled={!webhookUrl} onClick={handleTestWebhook}>
                      {testWebhookStatus === "success" ? <Check className="text-success-text" /> : null}
                      {testWebhookStatus === "success" ? "Sent" : "Send test"}
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </div>

          {/* Colors & dimensions */}
          <div className="space-y-3 px-4 py-3">
            <h3 className={sectionTitle}>Colors</h3>
            <div className="grid grid-cols-3 gap-2">
              {colorFields.map((c) => (
                <label
                  key={c.label}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-2 hover:border-ink-500"
                >
                  <input
                    type="color"
                    value={c.value}
                    onChange={(e) => c.set(e.target.value)}
                    aria-label={`${c.label} color`}
                    className="size-4 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-micro leading-3 text-fg-subtle">{c.label}</span>
                    <span className="block truncate font-data text-micro leading-3 text-fg">{c.value}</span>
                  </span>
                </label>
              ))}
            </div>

            <h3 className={`${sectionTitle} pt-1`}>Dimensions</h3>
            <div className="grid grid-cols-3 gap-3">
              {sizeFields.map((s) => (
                <label key={s.label} className="block">
                  <span className="mb-1 flex justify-between text-caption text-fg-subtle">
                    <span>{s.label}</span>
                    <span className="font-data text-fg">{s.value}px</span>
                  </span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    value={s.value}
                    onChange={(e) => s.set(Number(e.target.value))}
                    className="w-full accent-[rgb(var(--accent))]"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Script assignment */}
          <div className="px-4 py-3">
            <Field
              label="Apply to script"
              htmlFor="lb-script"
              hint="Binds this loader style and the execution webhook to the selected script(s)."
            >
              <Select id="lb-script" value={selectedScriptId} onChange={(e) => setSelectedScriptId(e.target.value)}>
                <option value="all">All scripts (default)</option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (/{s.slug})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        {/* Preview canvas + inspector */}
        <div className="space-y-3 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="text-title font-semibold text-fg">Preview</h2>
            <span className="text-caption text-fg-subtle">Drag to move, drag edges to resize</span>
          </div>

          <RobloxLoaderPreview
            config={currentPreviewConfig}
            layoutPositions={layoutPositions}
            onPositionChange={handlePositionChange}
            selectedElementId={selectedElementId}
            onSelectElement={setSelectedElementId}
          />

          {/* Inspector */}
          <Card>
            <CardHeader
              divided
              title={
                <span className="flex items-center gap-2">
                  <Layers className="size-4 text-fg-subtle" />
                  Layout inspector
                </span>
              }
              actions={
                <>
                  <Button size="xs" onClick={handleAutoDistribute} title="Evenly distribute vertical spacing of elements">
                    <ListOrdered />
                    Distribute
                  </Button>
                  <Button size="xs" variant="ghost" onClick={handleResetLayout} title="Reset layout positions to default">
                    <RotateCcw />
                    Reset
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-3">
              <Tabs
                variant="segmented"
                value={selectedElementId ?? ""}
                onValueChange={(v) => setSelectedElementId(v as LayoutElementId)}
              >
                <TabsList className="flex w-full flex-wrap">
                  {(
                    [
                      { id: "subtitle", label: "Subtitle" },
                      { id: "keyBox", label: "Key input" },
                      { id: "verifyBtn", label: "Verify" },
                      { id: "claimBtn", label: "Claim" },
                      ...(showDiscordButton ? [{ id: "discordBtn", label: "Discord" }] : []),
                    ] as const
                  ).map((elem) => (
                    <TabsTrigger key={elem.id} value={elem.id} className="flex-1 justify-center">
                      {elem.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {selectedElementId && selectedPos && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        { key: "x", label: "X", value: selectedPos.x },
                        { key: "y", label: "Y", value: selectedPos.y },
                        { key: "w", label: "W", value: selectedPos.w || frameWidth - 30 },
                        { key: "h", label: "H", value: selectedPos.h || (selectedElementId === "keyBox" ? 40 : 34) },
                      ] as const
                    ).map((f) => (
                      <Input
                        key={f.key}
                        size="sm"
                        mono
                        type="number"
                        aria-label={`${f.label} position in pixels`}
                        value={f.value}
                        onChange={(e) =>
                          handlePositionChange(selectedElementId, {
                            ...selectedPos,
                            [f.key]: Number(e.target.value),
                          })
                        }
                        leading={<span className="font-data text-caption">{f.label}</span>}
                        trailing={<span className="pr-1.5 text-micro">px</span>}
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" onClick={handleCenterElement}>
                      <AlignHorizontalJustifyCenter />
                      Center horizontally
                    </Button>
                    <Button size="sm" onClick={handleAlignLeft}>
                      <AlignLeft />
                      Left margin (15px)
                    </Button>
                    <Button size="sm" onClick={handleFullWidth}>
                      <Maximize2 />
                      Full width
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

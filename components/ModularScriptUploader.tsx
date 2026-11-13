// components/ModularScriptUploader.tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import JSZip from "jszip";
import {
  UploadCloud,
  FileCode,
  CheckCircle2,
  Copy,
  Check,
  AlertCircle,
  GitBranch,
  RefreshCw,
  FolderGit2,
  Shield,
  Cpu,
  Terminal,
  ChevronDown,
  ChevronUp,
  Circle,
  Zap,
} from "lucide-react";
import { LoaderConfigRecord, ScriptRecord } from "@/lib/store";
import { Card, CardHeader, CardBody, Switch, Tabs, TabsList, TabsTrigger } from "@/components/ui";

interface Props {
  loaderConfigs: LoaderConfigRecord[];
  onScriptCreated: (script: ScriptRecord) => void;
}

interface CompletedStats {
  rawSize: string;
  protectedSize: string;
  expansionRatio: string;
  duration: string;
  preset: string;
  layers?: string[];
}

const OBF_STEPS: { id: string; label: string }[] = [
  { id: "bundling", label: "Modular VFS Bundling" },
  { id: "compile", label: "Luau Bytecode Compilation" },
  { id: "lift", label: "Opcode Lifting & VM Instruction Encoding" },
  { id: "string-encrypt", label: "RC4 Dynamic Keystream String Encryption" },
  { id: "dead-code", label: "Polymorphic Control Flow & Dead Code" },
  { id: "vm", label: "Luau Virtual Machine Serialization" },
  { id: "verifying", label: "Luau Compiler Bytecode Verification" },
  { id: "saving", label: "Disk & Database Storage Sync" },
];

export default function ModularScriptUploader({ loaderConfigs, onScriptCreated }: Props) {
  const [filesMap, setFilesMap] = useState<Record<string, string>>({});
  const [scriptName, setScriptName] = useState("");
  const [scriptSlug, setScriptSlug] = useState("");
  const [entryFile, setEntryFile] = useState("");
  const [selectedLoaderConfig, setSelectedLoaderConfig] = useState(loaderConfigs[0]?.id || "");
  const [vmPreset, setVmPreset] = useState<"balanced" | "maximum" | "ultra">("balanced");
  const [watermarkText, setWatermarkText] = useState("AERO PROTECT");
  const [useAuth, setUseAuth] = useState(true);
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    "This script is currently under maintenance. Please check our Discord for updates."
  );
  const [sourceMode, setSourceMode] = useState<"upload" | "github">("upload");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubDirectory, setGithubDirectory] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubAutoPull, setGithubAutoPull] = useState(true);
  const [githubLastCommit, setGithubLastCommit] = useState<string | null>(null);
  const [isFetchingGitHub, setIsFetchingGitHub] = useState(false);
  const [githubSuccessMsg, setGithubSuccessMsg] = useState<string | null>(null);

  // Real-time Obfuscation Pipeline State
  const [isUploading, setIsUploading] = useState(false);
  const [obfProgress, setObfProgress] = useState<{ step: string; percent: number; message: string } | null>(null);
  const [obfLogs, setObfLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [completedStats, setCompletedStats] = useState<CompletedStats | null>(null);

  const [createdLoadstring, setCreatedLoadstring] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showLogs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [obfLogs, showLogs]);

  const handleFilesList = async (files: FileList | File[]) => {
    setError(null);
    setCompletedStats(null);
    setObfProgress(null);
    setCreatedLoadstring(null);
    const newFilesMap: Record<string, string> = {};

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relPath = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name;

      if (file.name.endsWith(".zip")) {
        try {
          const zip = await JSZip.loadAsync(file);
          for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
            if (!zipEntry.dir && (relativePath.endsWith(".lua") || relativePath.endsWith(".luau") || relativePath.endsWith(".txt"))) {
              const content = await zipEntry.async("string");
              newFilesMap[relativePath] = content;
            }
          }
        } catch {
          setError("Failed to extract zip file. Please make sure it is a valid zip archive.");
        }
      } else if (file.name.endsWith(".lua") || file.name.endsWith(".luau") || file.name.endsWith(".txt")) {
        const text = await file.text();
        newFilesMap[relPath] = text;
      }
    }

    if (Object.keys(newFilesMap).length === 0) {
      setError("No .lua or .luau files were found in the selected folder/files.");
      return;
    }

    setFilesMap(newFilesMap);

    // Auto-detect script name from folder or first file
    const fileKeys = Object.keys(newFilesMap);
    if (!scriptName) {
      const firstPath = fileKeys[0];
      const rootFolder = firstPath.includes("/") ? firstPath.split("/")[0] : "My Modular Script";
      setScriptName(rootFolder);
      setScriptSlug(rootFolder.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
    }

    // Auto-detect entry file if common names exist
    const defaultInit = fileKeys.find((k) => k.endsWith("init.lua") || k.endsWith("main.lua") || k === "init.lua") || fileKeys[0];
    setEntryFile(defaultInit);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesList(e.dataTransfer.files);
    }
  };

  const handleFetchFromGitHub = async () => {
    if (!githubRepo.trim()) {
      setError("Please enter a GitHub repository (e.g. revileDev/TestFork)");
      return;
    }
    setIsFetchingGitHub(true);
    setError(null);
    setGithubSuccessMsg(null);
    setCompletedStats(null);
    setObfProgress(null);
    setCreatedLoadstring(null);

    try {
      const res = await fetch("/api/scripts/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: githubRepo.trim(),
          branch: githubBranch.trim() || "main",
          directory: githubDirectory.trim(),
          token: githubToken.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch files from GitHub");

      setFilesMap(data.modules || {});
      setGithubLastCommit(data.commitSha || null);
      if (data.entryFile) setEntryFile(data.entryFile);

      if (!scriptName) {
        const repoName = githubRepo.split("/").pop() || "Modular Script";
        const dirName = githubDirectory ? ` - ${githubDirectory}` : "";
        setScriptName(repoName + dirName);
        setScriptSlug((repoName + dirName).toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
      }

      setGithubSuccessMsg(`Successfully imported ${data.filesCount} modules from GitHub (${data.commitSha ? data.commitSha.substring(0, 7) : "latest"})!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error connecting to GitHub";
      setError(msg);
    } finally {
      setIsFetchingGitHub(false);
    }
  };

  const handleSaveScript = async () => {
    if (!scriptName.trim()) {
      setError("Please specify a name for this script.");
      return;
    }
    if (!entryFile) {
      setError("Please designate which file is the main init script.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setCreatedLoadstring(null);
    setCompletedStats(null);
    setObfLogs([`[${new Date().toLocaleTimeString()}] Initializing Luau VM pipeline (Preset: ${vmPreset.toUpperCase()})...`]);
    setObfProgress({
      step: "bundling",
      percent: 5,
      message: "Preparing modules for virtual filesystem bundling...",
    });

    try {
      const res = await fetch("/api/scripts/obfuscate-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scriptName,
          slug: scriptSlug || scriptName.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
          entry_file: entryFile,
          modules: filesMap,
          preset: vmPreset,
          loader_config_id: selectedLoaderConfig,
          watermark_text: watermarkText,
          show_watermark: true,
          use_auth: useAuth,
          is_maintenance: isMaintenance,
          maintenance_message: isMaintenance ? maintenanceMessage : null,
          github_repo: githubRepo.trim() || null,
          github_branch: githubBranch.trim() || "main",
          github_directory: githubDirectory.trim() || "",
          github_token: githubToken.trim() || null,
          github_auto_pull: githubAutoPull,
          github_last_commit: githubLastCommit || null,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Server responded with status ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Unable to establish real-time SSE stream.");
      }

      const decoder = new TextDecoder();
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const parts = streamBuffer.split("\n\n");
        streamBuffer = parts.pop() || "";

        for (const block of parts) {
          if (!block.trim()) continue;

          const eventMatch = block.match(/event:\s*([^\n]+)/);
          const dataMatch = block.match(/data:\s*([^\n]+)/);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1].trim();
          let parsedData: any = {};
          try {
            parsedData = JSON.parse(dataMatch[1].trim());
          } catch {
            continue;
          }

          if (eventName === "progress") {
            setObfProgress({
              step: parsedData.step,
              percent: parsedData.percent,
              message: parsedData.message,
            });
            setObfLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${parsedData.message}`]);
          } else if (eventName === "complete") {
            setObfProgress({
              step: "complete",
              percent: 100,
              message: "VM Obfuscation & Luau Verification Complete!",
            });
            setObfLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] Protection complete! Bytecode verified with 0 errors.`,
            ]);
            setCompletedStats(parsedData.stats);
            setCreatedLoadstring(parsedData.loadstring);
            onScriptCreated(parsedData.script);
          } else if (eventName === "error") {
            throw new Error(parsedData.error || "Obfuscation pipeline encountered an error.");
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error saving script";
      setError(message);
      setObfProgress(null);
    } finally {
      setIsUploading(false);
    }
  };

  const copyLoadstring = () => {
    if (!createdLoadstring) return;
    navigator.clipboard?.writeText(createdLoadstring);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fileCount = Object.keys(filesMap).length;

  const getStepStatus = (stepId: string) => {
    if (!obfProgress) return "pending";
    if (obfProgress.step === "complete") return "completed";

    const stepOrder = OBF_STEPS.map((s) => s.id);
    const currentIndex = stepOrder.indexOf(obfProgress.step);
    const stepIndex = stepOrder.indexOf(stepId);

    if (currentIndex === -1) return "pending";
    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  return (
    <Card>
      <CardHeader
        divided
        title="Upload a script"
        description="Drop a modular Lua folder. Modules are bundled into an in-memory virtual filesystem and protected with the Luau VM."
        actions={
          <Tabs
            variant="segmented"
            value={sourceMode}
            onValueChange={(v) => {
              setSourceMode(v as "upload" | "github");
              setError(null);
            }}
          >
            <TabsList>
              <TabsTrigger value="upload">
                <UploadCloud />
                Folder / ZIP
              </TabsTrigger>
              <TabsTrigger value="github">
                <GitBranch />
                GitHub repo
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />
      <CardBody className="p-4">

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-body-sm text-danger-text">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {githubSuccessMsg && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-success/10 border border-success/20 text-success-text rounded-lg text-caption">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{githubSuccessMsg}</span>
        </div>
      )}

      {/* Mode 1: GitHub Connect Card */}
      {sourceMode === "github" && fileCount === 0 && (
        <div className="border border-line rounded-lg p-4 bg-surface space-y-4 mb-4">
          <div className="flex items-center justify-between pb-3 border-b border-line">
            <div className="flex items-center gap-2 text-fg font-semibold text-body-sm">
              <FolderGit2 className="w-4 h-4 text-accent-text" />
              <span>Connect GitHub Repository</span>
            </div>
            <span className="text-micro text-fg-muted">Pulls .lua, .luau, and .txt files automatically</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-caption">
            <div>
              <label className="block text-fg font-medium mb-1">GitHub Repository</label>
              <input
                type="text"
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="owner/repo (e.g. revileDev/TestFork)"
                className="w-full bg-surface-raised border border-line-strong rounded-lg px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-data text-caption"
              />
            </div>
            <div>
              <label className="block text-fg font-medium mb-1">Branch</label>
              <input
                type="text"
                value={githubBranch}
                onChange={(e) => setGithubBranch(e.target.value)}
                placeholder="main"
                className="w-full bg-surface-raised border border-line-strong rounded-lg px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-data text-caption"
              />
            </div>
            <div>
              <label className="block text-fg font-medium mb-1">Specific Subdirectory (Optional)</label>
              <input
                type="text"
                value={githubDirectory}
                onChange={(e) => setGithubDirectory(e.target.value)}
                placeholder="e.g. Rivals (leave blank for root)"
                className="w-full bg-surface-raised border border-line-strong rounded-lg px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-data text-caption"
              />
            </div>
            <div>
              <label className="block text-fg font-medium mb-1">Personal Access Token (Private Repos)</label>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_... (leave empty for public repos)"
                className="w-full bg-surface-raised border border-line-strong rounded-lg px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-data text-caption"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-line">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={githubAutoPull}
                onChange={(e) => setGithubAutoPull(e.target.checked)}
                className="w-4 h-4 rounded text-accent-text focus:ring-accent focus:ring-offset-canvas bg-surface-hover border-line-strong"
              />
              <span className="text-caption text-fg font-medium">
                Enable Auto-Pull (Automatically pull updated files from latest commits)
              </span>
            </label>

            <button
              type="button"
              onClick={handleFetchFromGitHub}
              disabled={isFetchingGitHub}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg text-caption font-semibold transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingGitHub ? "animate-spin" : ""}`} />
              {isFetchingGitHub ? "Connecting & Pulling..." : "Fetch Files from GitHub"}
            </button>
          </div>
        </div>
      )}

      {/* Upload Drop Zone */}
      {sourceMode === "upload" && fileCount === 0 ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="border border-dashed border-line-strong hover:border-accent/60 rounded-lg p-5 flex flex-col items-center justify-center text-center bg-surface transition-all"
        >
          <div className="w-14 h-14 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent-text mb-3">
            <UploadCloud className="w-7 h-7" />
          </div>
          <p className="text-body-sm font-semibold text-fg">
            Drag & drop files, or pick how you want to add this script
          </p>
          <p className="text-caption text-fg-muted mt-1">
            A single .lua/.luau file, several files at once, a whole folder of modules, or a ZIP
          </p>

          {/* BUGFIX: the whole box used to have its own onClick that silently opened the
              FOLDER picker no matter where you clicked, so clicking anywhere except the
              exact pixels of the small "Select Files / Zip" button below it always gave
              you a folder-only OS dialog -- which is exactly the "I only ever get a
              folder picker" symptom. Removed that ambiguous whole-box default; now only
              these two explicitly-labeled, equally-sized buttons open anything. */}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg text-caption font-semibold transition-all"
            >
              <FileCode className="w-4 h-4" />
              Choose file(s) or ZIP
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-surface-hover hover:bg-surface-active text-caption font-medium text-fg border border-line-strong transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              Choose a folder
            </button>
          </div>
          <p className="text-micro text-fg-subtle mt-2.5">
            "Choose file(s)" lets you pick exactly one script if that's all you need --
            it's not folder-only.
          </p>

          {/* Hidden inputs */}
          <input
            type="file"
            ref={folderInputRef}
            /* @ts-expect-error webkitdirectory is non-standard but supported */
            webkitdirectory=""
            directory=""
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFilesList(e.target.files)}
          />
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept=".lua,.luau,.zip,.txt"
            className="hidden"
            onChange={(e) => e.target.files && handleFilesList(e.target.files)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Discovered files overview */}
          <div className="bg-surface border border-line rounded-lg p-3.5">
            <div className="flex items-center justify-between text-caption mb-2">
              <span className="font-semibold text-fg">
                Discovered Files ({fileCount} modules):
              </span>
              <button
                type="button"
                onClick={() => {
                  setFilesMap({});
                  setObfProgress(null);
                  setCompletedStats(null);
                  setCreatedLoadstring(null);
                }}
                className="text-caption text-danger-text hover:underline"
              >
                Clear / Re-upload
              </button>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1 pr-1 font-data text-micro">
              {Object.keys(filesMap).map((path) => (
                <div
                  key={path}
                  onClick={() => setEntryFile(path)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition-all ${
                    entryFile === path
                      ? "bg-accent/20 text-accent-text border border-accent/30 font-semibold"
                      : "bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  <span className="truncate">{path}</span>
                  {entryFile === path && (
                    <span className="text-micro bg-accent/20 text-accent-text px-1.5 py-0.5 rounded font-sans">
                      Main Init Script ★
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-caption">
            <div>
              <label className="block text-fg font-medium mb-1">Script Name</label>
              <input
                type="text"
                value={scriptName}
                onChange={(e) => {
                  setScriptName(e.target.value);
                  setScriptSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
                }}
                placeholder="e.g. Combat Master V3"
                className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-fg font-medium mb-1">
                Designated Main Init Script <span className="text-accent-text">*</span>
              </label>
              <select
                value={entryFile}
                onChange={(e) => setEntryFile(e.target.value)}
                className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent font-data"
              >
                {Object.keys(filesMap).map((k) => (
                  <option key={k} value={k}>
                    {k} {k === entryFile ? "(Current Entry Point)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-fg font-medium mb-1 flex items-center justify-between">
                <span>Luau VM Obfuscator Preset</span>
                <span className="text-micro text-accent-text font-normal">Native Compiler Powered</span>
              </label>
              <select
                value={vmPreset}
                onChange={(e) => setVmPreset(e.target.value as "balanced" | "maximum" | "ultra")}
                className="w-full bg-surface border border-accent/40 rounded-lg px-3 py-2 text-fg outline-none focus:border-accent font-medium"
              >
                <option value="balanced">Balanced (Recommended) — 0 FPS drop, verified for huge scripts</option>
                <option value="maximum">Maximum — Aggressive string encryption, anti-tamper, table flattening</option>
                <option value="ultra">Ultra — Maximum VM polymorphism & dead code branches</option>
              </select>
              <p className="text-micro text-fg-muted mt-1">
                {vmPreset === "balanced" && "⚡ Optimized VM bytecode verified with luau-compile. Zero frame drops even in heavy 3D games."}
                {vmPreset === "maximum" && "🛡️ Heavy security transform layers with dynamic constants and bytecode virtualization."}
                {vmPreset === "ultra" && "🔥 Extreme security layer serialization. Best for compact scripts and critical licensing logic."}
              </p>
            </div>

            <div>
              <label className="block text-fg font-medium mb-1">
                Attach Custom Auth Loader
              </label>
              <select
                value={selectedLoaderConfig}
                onChange={(e) => setSelectedLoaderConfig(e.target.value)}
                className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
              >
                {loaderConfigs.map((cfg) => (
                  <option key={cfg.id} value={cfg.id}>
                    {cfg.name} ({cfg.brand_name})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-fg font-medium mb-1">
                In-Game Watermark Brand Text
              </label>
              <input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="e.g. AERO PROTECT"
                className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-fg outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Auth Gate Toggle Option */}
          <div className="p-3.5 rounded-lg border border-line bg-surface flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-caption font-semibold text-fg">Require Auth Loader & License Key</span>
                <span className={`text-micro px-2 py-0.5 rounded font-bold ${useAuth ? "bg-success/10 text-success-text border border-success/20" : "bg-surface-hover text-fg-muted"}`}>
                  {useAuth ? "Protected" : "Direct Run"}
                </span>
              </div>
              <p className="text-micro text-fg-muted mt-1 leading-relaxed">
                {useAuth
                  ? "The Auth Loader loads first in-game. Your script's modules remain strictly stored on our backend and are ONLY pulled dynamically after successful license key verification."
                  : "Direct Mode: The script runs immediately in executor without showing an Auth Loader or asking for a key."}
              </p>
            </div>

            <Switch
              checked={useAuth}
              onCheckedChange={setUseAuth}
              aria-label="Require auth loader and license key"
              className="mt-0.5"
            />
          </div>

          {/* Maintenance Mode Kill-Switch */}
          <div className="p-3.5 rounded-lg border border-warning/30 bg-warning/5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-caption font-semibold text-fg">Maintenance Mode Kill-Switch</span>
                  <span
                    className={`text-micro px-2 py-0.5 rounded font-bold ${
                      isMaintenance
                        ? "bg-warning/20 text-warning-text border border-warning/40"
                        : "bg-surface-hover text-fg-muted"
                    }`}
                  >
                    {isMaintenance ? "Locked (Under Maintenance)" : "Operational"}
                  </span>
                </div>
                <p className="text-micro text-fg-muted mt-1 leading-relaxed">
                  When enabled, all public players attempting to execute this script will receive a notification and script execution is blocked. Staff review keys bypass this automatically.
                </p>
              </div>

              <Switch
                checked={isMaintenance}
                onCheckedChange={setIsMaintenance}
                aria-label="Maintenance mode kill-switch"
                className="mt-0.5"
              />
            </div>

            {isMaintenance && (
              <div className="pt-2">
                <label className="text-micro font-semibold text-fg block mb-1">
                  In-Game Player Notice Message:
                </label>
                <input
                  type="text"
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                  placeholder="e.g. This script is currently under maintenance. Please check our Discord for updates."
                  className="w-full bg-surface border border-line-strong rounded-lg px-3 py-1.5 text-caption text-fg outline-none focus:border-accent"
                />
              </div>
            )}
          </div>

          {/* Real-Time Obfuscation Progress Card */}
          {(isUploading || obfProgress) && (
            <div className="rounded-lg border border-accent/30 bg-surface p-4 space-y-3.5 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-accent-text" />
                  <span className="text-caption font-bold text-fg tracking-wide">
                    Luau Virtual Machine Pipeline
                  </span>
                  <span className="text-micro bg-accent/10 text-accent-text border border-accent/25 px-2 py-0.5 rounded-full font-data font-semibold">
                    Preset: {vmPreset.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-caption font-data font-bold text-accent-text">
                    {obfProgress?.percent || 0}%
                  </span>
                  {obfProgress?.step === "complete" ? (
                    <span className="text-micro bg-success/20 text-success-text border border-success/30 px-2 py-0.5 rounded font-semibold">
                      READY
                    </span>
                  ) : (
                    <span className="text-micro bg-accent/20 text-accent-text border border-accent/30 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      PROCESSING
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-surface rounded-full h-2.5 overflow-hidden p-0.5 border border-line">
                <div
                  className="bg-accent hover:bg-accent-hover h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.max(5, obfProgress?.percent || 0)}%` }}
                />
              </div>

              {/* Current status message */}
              <div className="text-micro text-fg flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-warning-text shrink-0" />
                <span className="truncate">{obfProgress?.message || "Initializing pipeline..."}</span>
              </div>

              {/* Multi-Stage Step Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-line">
                {OBF_STEPS.map((step) => {
                  const status = getStepStatus(step.id);
                  return (
                    <div
                      key={step.id}
                      className={`flex items-center gap-2 text-micro px-2 py-1.5 rounded transition-colors ${
                        status === "active"
                          ? "bg-accent/15 text-accent-text border border-accent/30 font-medium"
                          : status === "completed"
                          ? "text-fg"
                          : "text-fg-subtle opacity-60"
                      }`}
                    >
                      {status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-success-text shrink-0" />}
                      {status === "active" && <RefreshCw className="w-3.5 h-3.5 text-accent-text animate-spin shrink-0" />}
                      {status === "pending" && <Circle className="w-3.5 h-3.5 text-fg-disabled shrink-0" />}
                      <span className="truncate">{step.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Completed Metrics Summary */}
              {completedStats && (
                <div className="pt-2 border-t border-line">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-surface border border-line rounded-lg p-2 text-center">
                      <span className="text-micro text-fg-muted block">Input Source</span>
                      <span className="text-caption font-bold text-fg">{completedStats.rawSize}</span>
                    </div>
                    <div className="bg-surface border border-line rounded-lg p-2 text-center">
                      <span className="text-micro text-fg-muted block">Protected VM Size</span>
                      <span className="text-caption font-bold text-accent-text">{completedStats.protectedSize}</span>
                    </div>
                    <div className="bg-surface border border-line rounded-lg p-2 text-center">
                      <span className="text-micro text-fg-muted block">Expansion Ratio</span>
                      <span className="text-caption font-bold text-accent-text">{completedStats.expansionRatio}</span>
                    </div>
                    <div className="bg-surface border border-line rounded-lg p-2 text-center">
                      <span className="text-micro text-fg-muted block">VM Pipeline Time</span>
                      <span className="text-caption font-bold text-success-text">{completedStats.duration}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Collapsible Live Log Console */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowLogs(!showLogs)}
                  className="flex items-center gap-1.5 text-micro text-fg-muted hover:text-fg transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5 text-accent-text" />
                  <span>{showLogs ? "Hide" : "Show"} Diagnostic Stream Logs ({obfLogs.length})</span>
                  {showLogs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showLogs && (
                  <div className="mt-2 bg-canvas border border-line rounded-lg p-3 font-data text-micro text-fg max-h-36 overflow-y-auto space-y-1">
                    {obfLogs.map((log, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 leading-relaxed">
                        <span className="text-accent-text select-none">&gt;</span>
                        <span>{log}</span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={handleSaveScript}
            disabled={isUploading}
            className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-fg font-semibold text-caption transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Obfuscating with Luau VM Pipeline...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                Bundle Modules & Obfuscate with Luau VM
              </>
            )}
          </button>
        </div>
      )}

      {/* Generated Loadstring Modal / Box */}
      {createdLoadstring && (
        <div className="mt-5 p-4 rounded-lg bg-success/10 border border-success/30">
          <div className="flex items-center gap-2 text-success-text font-semibold text-caption mb-2">
            <CheckCircle2 className="w-4 h-4" />
            Script Successfully Obfuscated & Stored in Backend!
          </div>
          <p className="text-micro text-fg mb-2">
            Here is your official loadstring. Give this to your users. It displays your custom Auth Loader and streams your Luau VM protected modular code dynamically after license verification:
          </p>
          <div className="flex items-center gap-2 bg-surface border border-line rounded-lg p-2.5 font-data text-caption text-accent-text overflow-x-auto">
            <span className="flex-1 truncate">{createdLoadstring}</span>
            <button
              type="button"
              onClick={copyLoadstring}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent hover:bg-accent-hover text-accent-fg text-caption font-semibold whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      </CardBody>
    </Card>
  );
}
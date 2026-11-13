// components/ScriptUpdateModal.tsx
"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  FileCode,
  UploadCloud,
  Edit3,
  Copy,
  Check,
  AlertCircle,
  Plus,
  Trash2,
  Lock,
  Star,
  CheckCircle2,
  RotateCcw,
  ClipboardPaste,
  GitBranch,
  RefreshCw,
  FolderGit2,
  Shield,
  Cpu,
} from "lucide-react";
import { ScriptRecord } from "@/lib/store";
import { Modal, Button, Badge, Tabs, TabsList, TabsTrigger } from "@/components/ui";

interface Props {
  script: ScriptRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onScriptUpdated: (updatedScript: ScriptRecord) => void;
}

export default function ScriptUpdateModal({
  script,
  isOpen,
  onClose,
  onScriptUpdated,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [modulesMap, setModulesMap] = useState<Record<string, string>>({});
  const [originalMap, setOriginalMap] = useState<Record<string, string>>({});
  const [entryFile, setEntryFile] = useState<string>("");
  const [vmPreset, setVmPreset] = useState<"balanced" | "maximum" | "ultra">("balanced");
  const [activeTab, setActiveTab] = useState<"upload" | "editor" | "github">("upload");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubDirectory, setGithubDirectory] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubAutoPull, setGithubAutoPull] = useState(false);
  const [githubLastCommit, setGithubLastCommit] = useState<string | null>(null);
  const [githubLastPulledAt, setGithubLastPulledAt] = useState<string | null>(null);
  const [isSyncingGitHub, setIsSyncingGitHub] = useState(false);
  const [githubSyncMsg, setGithubSyncMsg] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedLoadstring, setCopiedLoadstring] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize when script changes or modal opens
  useEffect(() => {
    if (script && isOpen) {
      const mods = { ...(script.modules || {}) };
      setModulesMap(mods);
      setOriginalMap(mods);
      setEntryFile(script.entry_file || Object.keys(mods)[0] || "init.lua");
      setVmPreset((script.vm_preset as any) || "balanced");

      const fileKeys = Object.keys(mods);
      if (fileKeys.length > 0) {
        // Prefer entry file or first file
        const defaultChoice = mods[script.entry_file] !== undefined ? script.entry_file : fileKeys[0];
        setSelectedFile(defaultChoice);
      } else {
        setSelectedFile("");
      }

      setUploadedFileName(null);
      setSaveSuccess(null);
      setError(null);
      setIsAddingFile(false);
      setNewFileNameInput("");
    }
  }, [script, isOpen]);

  if (!isOpen || !script) return null;

  const currentContent = selectedFile ? modulesMap[selectedFile] || "" : "";
  const originalContent = selectedFile ? originalMap[selectedFile] || "" : "";
  const isCurrentFileModified = currentContent !== originalContent;

  const fileKeys = Object.keys(modulesMap);

  const getLoadstring = () => {
    if (typeof window === "undefined") return "";
    return `loadstring(game:HttpGet("${window.location.protocol}//${window.location.host}/api/loader/${script.slug}"))()`;
  };

  const handleCopyLoadstring = () => {
    const ls = getLoadstring();
    navigator.clipboard?.writeText(ls);
    setCopiedLoadstring(true);
    setTimeout(() => setCopiedLoadstring(false), 2000);
  };

  const handleFileContentChange = (newVal: string) => {
    if (!selectedFile) return;
    setModulesMap((prev) => ({
      ...prev,
      [selectedFile]: newVal,
    }));
    setSaveSuccess(null);
    setError(null);
  };

  // Upload replacement file
  const handleUploadedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedFile) return;

    const file = files[0];
    try {
      const text = await file.text();
      handleFileContentChange(text);
      setUploadedFileName(file.name);
      setSaveSuccess(`Loaded replacement from "${file.name}" into ${selectedFile}. Review and click "Save & Deploy Update" below.`);
    } catch {
      setError("Failed to read file from disk.");
    }

    if (e.target) e.target.value = "";
  };

  // Paste from clipboard
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        handleFileContentChange(text);
        setSaveSuccess(`Pasted ${text.length} characters from clipboard.`);
      }
    } catch {
      setError("Clipboard access denied. Please paste directly into the editor.");
    }
  };

  // Revert changes
  const handleRevert = () => {
    if (!selectedFile) return;
    handleFileContentChange(originalContent);
    setUploadedFileName(null);
    setSaveSuccess(null);
  };

  // Add a new file
  const handleAddNewFile = () => {
    const trimmed = newFileNameInput.trim();
    if (!trimmed) {
      setError("Please provide a valid file name (e.g. custom.lua)");
      return;
    }
    const finalName = trimmed.endsWith(".lua") || trimmed.endsWith(".luau") ? trimmed : `${trimmed}.lua`;

    if (modulesMap[finalName] !== undefined) {
      setError(`File "${finalName}" already exists in this script.`);
      return;
    }

    setModulesMap((prev) => ({
      ...prev,
      [finalName]: `-- [[ ${finalName} ]]\n\nlocal module = {}\n\nreturn module\n`,
    }));
    setSelectedFile(finalName);
    setIsAddingFile(false);
    setNewFileNameInput("");
    setError(null);
  };

  // Delete a file
  const handleDeleteFile = (fileName: string) => {
    if (fileKeys.length <= 1) {
      setError("Cannot delete the only file in the script.");
      return;
    }
    if (!confirm(`Are you sure you want to remove "${fileName}" from this script?`)) return;

    const updated = { ...modulesMap };
    delete updated[fileName];
    setModulesMap(updated);

    // If deleting the currently selected file, switch to another
    if (selectedFile === fileName) {
      const remaining = Object.keys(updated);
      setSelectedFile(remaining[0] || "");
    }

    // If deleting entry file, fallback
    if (entryFile === fileName) {
      setEntryFile(Object.keys(updated)[0] || "init.lua");
    }
  };

  // Save changes
  const handlePullFromGitHub = async () => {
    if (!script) return;
    setIsSyncingGitHub(true);
    setError(null);
    setGithubSyncMsg(null);

    try {
      const res = await fetch("/api/scripts/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script_id: script.id,
          force: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GitHub sync failed");

      if (data.script) {
        setModulesMap(data.script.modules || {});
        setOriginalMap(data.script.modules || {});
        setEntryFile(data.script.entry_file || entryFile);
        setGithubLastCommit(data.script.github_last_commit || null);
        setGithubLastPulledAt(data.script.github_last_pulled_at || null);
        onScriptUpdated(data.script);
      }
      setGithubSyncMsg(data.message || `Successfully synced ${data.filesCount} files from GitHub!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error syncing from GitHub";
      setError(msg);
    } finally {
      setIsSyncingGitHub(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile && fileKeys.length === 0) {
      setError("Script must contain at least one file.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const res = await fetch("/api/scripts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: script.id,
          slug: script.slug,
          entry_file: entryFile,
          modules: modulesMap,
          preset: vmPreset,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update script");

      setOriginalMap({ ...modulesMap });
      setUploadedFileName(null);
      setSaveSuccess(`Script updated & re-obfuscated with Luau VM! Loadstring remains locked and active.`);
      onScriptUpdated(data.script);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving updates";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const lineCount = currentContent.split("\n").length;
  const byteSize = new Blob([currentContent]).size;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="xl"
      className="max-w-5xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate">Update script: {script.name}</span>
          <Badge mono>/{script.slug}</Badge>
          <Badge tone="success">
            <Lock className="size-3" /> Loadstring locked
          </Badge>
          <Badge tone="accent">
            <Shield className="size-3" /> Luau VM
          </Badge>
        </span>
      }
      description="Update files or replace code without resetting the loadstring. Changes apply to every executor immediately."
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 text-caption text-fg-muted">
            <Lock className="size-3.5 shrink-0 text-fg-subtle" />
            <span>
              Loadstring URL stays the same: <code className="font-data text-fg">/api/loader/{script.slug}</code>
            </span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button onClick={onClose} disabled={isSaving}>
              Close
            </Button>
            <Button variant="primary" onClick={handleSave} loading={isSaving}>
              <Check />
              Save & deploy update
            </Button>
          </div>
        </div>
      }
    >
        {/* Loadstring info bar */}
        <div className="-mx-5 -mt-4 mb-4 flex flex-col justify-between gap-2 border-b border-line bg-surface px-5 py-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-caption text-fg-subtle">Loadstring</span>
            <code className="truncate rounded border border-line-subtle bg-canvas px-1.5 font-data text-micro leading-5 text-fg-muted select-all">
              {getLoadstring()}
            </code>
          </div>
          <Button size="xs" onClick={handleCopyLoadstring}>
            {copiedLoadstring ? <Check className="text-success-text" /> : <Copy />}
            {copiedLoadstring ? "Copied" : "Copy loadstring"}
          </Button>
        </div>

        <div className="space-y-4">
          {/* Success Banner */}
          {saveSuccess && (
            <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-success-text text-caption flex items-center gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success-text" />
              <span>{saveSuccess}</span>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger-text text-caption flex items-center gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-danger-text" />
              <span>{error}</span>
            </div>
          )}

          {/* Luau VM Obfuscator Preset & Protection Status Bar */}
          <div className="p-3 bg-surface border border-line rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-accent-text shrink-0" />
              <div>
                <div className="text-caption font-semibold text-fg flex items-center gap-2">
                  <span>Luau VM Obfuscator Preset</span>
                  <span className="text-micro bg-accent/10 text-accent-text border border-accent/25 px-1.5 py-0.5 rounded font-data">
                    Auto-Compile
                  </span>
                </div>
                <p className="text-micro text-fg-muted">
                  Saving any changes will automatically re-bundle and compile your code through the Luau VM.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <select
                value={vmPreset}
                onChange={(e) => setVmPreset(e.target.value as "balanced" | "maximum" | "ultra")}
                className="bg-surface-raised border border-line-strong rounded-lg px-2.5 py-1.5 text-caption text-fg font-medium outline-none focus:border-accent"
              >
                <option value="balanced">Balanced (0 FPS Hit, Recommended)</option>
                <option value="maximum">Maximum (Aggressive Hardening)</option>
                <option value="ultra">Ultra (Max Polymorphism)</option>
              </select>
            </div>
          </div>

          {/* STEP 1: Choose which file you are updating */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-caption font-bold text-fg flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-accent text-micro text-accent-fg flex items-center justify-center font-bold">
                  1
                </span>
                Choose Which File to Update:
              </label>

              <button
                type="button"
                onClick={() => setIsAddingFile(!isAddingFile)}
                className="text-micro font-semibold text-accent-text hover:text-accent-text flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add New File
              </button>
            </div>

            {/* Add New File Sub-form */}
            {isAddingFile && (
              <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. modules/teleport.lua"
                  value={newFileNameInput}
                  onChange={(e) => setNewFileNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNewFile()}
                  className="flex-1 bg-surface border border-line-strong rounded-lg px-3 py-1.5 text-caption text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleAddNewFile}
                  className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-accent-fg rounded-lg text-caption font-medium"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingFile(false)}
                  className="px-2.5 py-1.5 bg-surface-hover hover:bg-surface-active text-fg-muted rounded-lg text-caption font-medium"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* File Selector Dropdown & File Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative flex-1">
                <select
                  value={selectedFile}
                  onChange={(e) => {
                    setSelectedFile(e.target.value);
                    setUploadedFileName(null);
                    setSaveSuccess(null);
                    setError(null);
                  }}
                  className="w-full bg-surface-raised border border-line-strong rounded-lg px-3.5 py-2.5 text-caption font-data text-fg focus:outline-none focus:border-accent appearance-none cursor-pointer"
                >
                  {fileKeys.map((f) => (
                    <option key={f} value={f}>
                      {f} {f === entryFile ? "(Entry Point)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Set as Entry / Delete Buttons */}
              <div className="flex items-center gap-2">
                {selectedFile !== entryFile ? (
                  <button
                    type="button"
                    onClick={() => setEntryFile(selectedFile)}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-hover hover:bg-surface-active text-fg text-caption font-medium border border-line-strong transition-colors"
                    title="Set this file as the script entry point"
                  >
                    <Star className="w-3.5 h-3.5 text-warning-text" />
                    Set as Entry
                  </button>
                ) : (
                  <span className="flex items-center gap-1 px-3 py-2 rounded-lg bg-warning/10 border border-warning/20 text-warning-text text-caption font-semibold">
                    <Star className="w-3.5 h-3.5 fill-warning" />
                    Main Entry File
                  </span>
                )}

                {fileKeys.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteFile(selectedFile)}
                    className="p-2 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger-text border border-danger/20 transition-colors"
                    title="Delete this file from script"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* File List Fast-Switcher Badges */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {fileKeys.map((f) => {
                const isSelected = f === selectedFile;
                const isEntry = f === entryFile;
                const isModified = (modulesMap[f] || "") !== (originalMap[f] || "");

                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setSelectedFile(f);
                      setUploadedFileName(null);
                      setSaveSuccess(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-micro font-data transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? "bg-accent text-accent-fg font-semibold"
                        : "bg-surface-raised hover:bg-surface-hover text-fg-muted hover:text-fg border border-line"
                    }`}
                  >
                    <span>{f.split("/").pop()}</span>
                    {isEntry && <span className="text-micro bg-warning/20 text-warning-text px-1 py-0.2 rounded font-sans">entry</span>}
                    {isModified && <span className="w-1.5 h-1.5 rounded-full bg-warning"></span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* STEP 2: Choose what to update it with */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-caption font-bold text-fg flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full bg-accent text-micro text-accent-fg flex items-center justify-center font-bold">
                  2
                </span>
                Choose What to Update It With:
              </label>

              {/* Mode tabs */}
              <Tabs variant="segmented" value={activeTab} onValueChange={(v) => setActiveTab(v as "upload" | "editor" | "github")}>
                <TabsList>
                  <TabsTrigger value="upload">
                    <UploadCloud />
                    Upload file
                  </TabsTrigger>
                  <TabsTrigger value="editor">
                    <Edit3 />
                    Edit / paste code
                  </TabsTrigger>
                  <TabsTrigger value="github">
                    <GitBranch />
                    GitHub sync
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* TAB 1: Upload Replacement File */}
            {activeTab === "upload" && (
              <div className="space-y-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-line-strong hover:border-accent/80 bg-surface-raised hover:bg-accent/5 rounded-lg p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".lua,.luau,.txt"
                    onChange={handleUploadedFile}
                    className="hidden"
                  />
                  <div className="w-12 h-12 rounded-lg bg-accent/10 group-hover:bg-accent/20 text-accent-text flex items-center justify-center transition-transform group-hover:scale-105">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-caption sm:text-body-sm font-semibold text-fg">
                      Click to choose replacement file for <span className="text-accent-text font-data">{selectedFile}</span>
                    </p>
                    <p className="text-micro text-fg-subtle mt-0.5">
                      Accepts <code className="text-fg-muted">.lua</code>, <code className="text-fg-muted">.luau</code>, or <code className="text-fg-muted">.txt</code> from your computer.
                    </p>
                  </div>
                </div>

                {uploadedFileName && (
                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/30 text-accent-text text-caption flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0" />
                      <span className="truncate">
                        Loaded replacement from: <strong>{uploadedFileName}</strong> ({lineCount} lines, {(byteSize / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("editor")}
                      className="text-caption font-semibold text-accent-text hover:underline shrink-0 ml-2"
                    >
                      View in Editor →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: GitHub Sync & Auto-Pull Settings */}
            <div className={activeTab === "github" ? "space-y-4" : "hidden"}>
              <div className="p-4 rounded-lg bg-surface border border-line space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-line">
                  <div className="flex items-center gap-2">
                    <FolderGit2 className="w-4 h-4 text-accent-text" />
                    <span className="text-body-sm font-semibold text-fg">Connected GitHub Repository</span>
                  </div>
                  {githubLastCommit && (
                    <span className="text-micro font-data text-fg-muted bg-surface-hover px-2 py-0.5 rounded">
                      SHA: {githubLastCommit.substring(0, 7)}
                    </span>
                  )}
                </div>

                {githubSyncMsg && (
                  <div className="p-3 bg-success/10 border border-success/20 text-success-text rounded-lg text-caption flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{githubSyncMsg}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-caption">
                  <div>
                    <label className="block text-fg font-medium mb-1">Repository Slug / URL</label>
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
                    <label className="block text-fg font-medium mb-1">Subdirectory (Optional)</label>
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
                      placeholder="ghp_... (optional)"
                      className="w-full bg-surface-raised border border-line-strong rounded-lg px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent font-data text-caption"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-line">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={githubAutoPull}
                      onChange={(e) => setGithubAutoPull(e.target.checked)}
                      className="w-4 h-4 rounded text-accent-text focus:ring-accent focus:ring-offset-canvas bg-surface-hover border-line-strong"
                    />
                    <span className="text-caption text-fg font-medium">
                      Enable Auto-Pull (Pulls updated files from latest commits automatically)
                    </span>
                  </label>

                  <button
                    type="button"
                    onClick={handlePullFromGitHub}
                    disabled={isSyncingGitHub || !githubRepo}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg text-caption font-semibold transition-all"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingGitHub ? "animate-spin" : ""}`} />
                    {isSyncingGitHub ? "Pulling Latest..." : "Pull Latest from GitHub Now"}
                  </button>
                </div>

                {githubLastPulledAt && (
                  <p className="text-micro text-fg-muted">
                    Last synchronized: {new Date(githubLastPulledAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* TAB 2: Edit / Paste Code Directly */}
            <div className={activeTab === "editor" ? "space-y-2" : "hidden"}>
              {/* Toolbar */}
              <div className="flex items-center justify-between text-caption text-fg-muted pb-1">
                <div className="flex items-center gap-2">
                  <span className="font-data text-fg">{selectedFile}</span>
                  <span>•</span>
                  <span>{lineCount} lines</span>
                  <span>•</span>
                  <span>{(byteSize / 1024).toFixed(1)} KB</span>
                  {isCurrentFileModified && (
                    <span className="px-1.5 py-0.5 rounded bg-warning/10 text-warning-text border border-warning/20 text-micro font-semibold">
                      Unsaved Changes
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-hover hover:bg-surface-active text-fg text-micro font-medium transition-colors"
                  >
                    <ClipboardPaste className="w-3 h-3" />
                    Paste Clipboard
                  </button>
                  {isCurrentFileModified && (
                    <button
                      type="button"
                      onClick={handleRevert}
                      className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-hover hover:bg-surface-active text-fg text-micro font-medium transition-colors"
                      title="Revert to original file content"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Revert
                    </button>
                  )}
                </div>
              </div>

              {/* Textarea */}
              <div className="relative border border-line rounded-lg overflow-hidden bg-surface">
                <textarea
                  value={currentContent}
                  onChange={(e) => handleFileContentChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const start = e.currentTarget.selectionStart;
                      const end = e.currentTarget.selectionEnd;
                      const value = e.currentTarget.value;
                      const updated = value.substring(0, start) + "    " + value.substring(end);
                      handleFileContentChange(updated);
                      setTimeout(() => {
                        if (e.currentTarget) {
                          e.currentTarget.selectionStart = e.currentTarget.selectionEnd = start + 4;
                        }
                      }, 0);
                    }
                  }}
                  placeholder="Paste or write your Lua code here..."
                  rows={14}
                  className="w-full bg-transparent p-4 font-data text-caption text-fg placeholder:text-fg-subtle focus:outline-none resize-y leading-relaxed"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>
        </div>
    </Modal>
  );
}
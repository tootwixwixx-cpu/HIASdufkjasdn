// app/dashboard/scripts/page.tsx
"use client";

import React, { useState, useEffect } from "react";
import ModularScriptUploader from "@/components/ModularScriptUploader";
import ScriptUpdateModal from "@/components/ScriptUpdateModal";
import type { LoaderConfigRecord, ScriptRecord } from "@/lib/store";
import { Copy, Check, Trash2, Sliders, ExternalLink, FileEdit, AlertTriangle, Cpu } from "lucide-react";
import {
  Badge,
  Button,
  buttonClasses,
  Spinner,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableToolbar,
} from "@/components/ui";
import Link from "next/link";

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptRecord[]>([]);
  const [loaderConfigs, setLoaderConfigs] = useState<LoaderConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [updatingScript, setUpdatingScript] = useState<ScriptRecord | null>(null);

  const fetchData = async () => {
    try {
      const [scriptsRes, configsRes] = await Promise.all([
        fetch("/api/scripts"),
        fetch("/api/loader-configs"),
      ]);
      const scriptsData = await scriptsRes.json();
      const configsData = await configsRes.json();
      setScripts(scriptsData.scripts || []);
      setLoaderConfigs(configsData.configs || []);
    } catch (err) {
      console.error("Error loading scripts", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleScriptCreated = (newScript: ScriptRecord) => {
    setScripts((prev) => [newScript, ...prev.filter((s) => s.id !== newScript.id)]);
  };

  const handleScriptUpdated = (updatedScript: ScriptRecord) => {
    setScripts((prev) => prev.map((s) => (s.id === updatedScript.id ? updatedScript : s)));
    setUpdatingScript(updatedScript);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this script?")) return;
    try {
      await fetch(`/api/scripts?id=${id}`, { method: "DELETE" });
      setScripts((prev) => prev.filter((s) => s.id !== id));
      if (updatingScript?.id === id) setUpdatingScript(null);
    } catch (err) {
      console.error("Error deleting script", err);
    }
  };

  const getLoadstring = (slug: string) => {
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol;
    const host = window.location.host;
    return `loadstring(game:HttpGet("${protocol}//${host}/api/loader/${slug}"))()`;
  };

  const copyLoadstring = (id: string, slug: string) => {
    const ls = getLoadstring(slug);
    navigator.clipboard?.writeText(ls);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleMaintenance = async (s: ScriptRecord) => {
    const turningOn = !s.is_maintenance;
    let msg = s.maintenance_message;
    if (turningOn) {
      const input = prompt(
        "Enter maintenance notice for in-game players:",
        s.maintenance_message || "This script is currently under maintenance. Please check our Discord for updates."
      );
      if (input === null) return;
      msg = input.trim();
    }
    try {
      const res = await fetch("/api/scripts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: s.id,
          is_maintenance: turningOn,
          maintenance_message: msg,
        }),
      });
      const data = await res.json();
      if (data.script) {
        handleScriptUpdated(data.script);
      }
    } catch (err) {
      console.error(err);
    }
  };


  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h1 className="text-heading font-semibold text-fg">Scripts vault</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            Upload modular Lua projects. Scripts stay on the server and are served only after an in-game key check.
          </p>
        </div>
        <Link href="/dashboard/loader-builder" className={buttonClasses({ size: "sm" })}>
          <Sliders />
          Build auth loader
        </Link>
      </div>

      {/* Upload */}
      <ModularScriptUploader loaderConfigs={loaderConfigs} onScriptCreated={handleScriptCreated} />

      {/* Stored scripts */}
      <div>
        <TableToolbar className="justify-between">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title font-semibold text-fg">Protected scripts</h2>
            <span className="font-data text-caption text-fg-subtle">{scripts.length}</span>
          </div>
          {scripts.length > 0 && (
            <Button size="sm" onClick={() => setUpdatingScript(scripts[0])}>
              <FileEdit />
              Update script files
            </Button>
          )}
        </TableToolbar>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Script</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead align="right">Modules</TableHead>
              <TableHead>Loader</TableHead>
              <TableHead>VM output</TableHead>
              <TableHead>Loadstring</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-body-sm text-fg-muted">
                  <span className="inline-flex items-center gap-2">
                    <Spinner />
                    Loading scripts...
                  </span>
                </td>
              </tr>
            ) : scripts.length === 0 ? (
              <TableEmpty
                colSpan={8}
                title="No scripts yet"
                description="Upload a modular folder above to get a protected loadstring."
              />
            ) : (
              scripts.map((s) => {
                const numModules = Object.keys(s.modules || {}).length;
                const assignedLoader = loaderConfigs.find((c) => c.id === s.loader_config_id);

                return (
                  <React.Fragment key={s.id}>
                    <TableRow>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-fg">{s.name}</span>
                          <span className="font-data text-caption text-fg-subtle">/{s.slug}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {s.is_maintenance && (
                            <Badge tone="warning" dot title={s.maintenance_message || "Script under maintenance"}>
                              Maintenance
                            </Badge>
                          )}
                          {s.use_auth !== false ? <Badge tone="success">Auth gate</Badge> : <Badge>Direct run</Badge>}
                          {s.is_obfuscated ? (
                            <Badge tone="accent">
                              <Cpu className="size-3" />
                              Luau VM
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell mono muted truncate={160}>
                        {s.entry_file}
                      </TableCell>
                      <TableCell mono align="right">
                        {numModules}
                      </TableCell>
                      <TableCell muted truncate={140}>
                        {assignedLoader ? assignedLoader.name : "Default"}
                      </TableCell>
                      <TableCell mono muted>
                        {s.obfuscation_stats ? (
                          <>
                            <span className="text-fg">
                              {s.obfuscation_stats.outputSize ? (s.obfuscation_stats.outputSize / 1024).toFixed(1) : 0} KB
                            </span>{" "}
                            {s.obfuscation_stats.expansionRatio || 1}x, {s.vm_preset || "balanced"}
                          </>
                        ) : (
                          <span className="text-fg-subtle">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1">
                        <div className="flex items-center gap-1">
                          <code className="block max-w-[260px] truncate rounded border border-line-subtle bg-surface px-1.5 font-data text-micro leading-5 text-fg-muted select-all">
                            {getLoadstring(s.slug)}
                          </code>
                          <Button
                            variant={copiedId === s.id ? "secondary" : "primary"}
                            size="xs"
                            onClick={() => copyLoadstring(s.id, s.slug)}
                          >
                            {copiedId === s.id ? <Check /> : <Copy />}
                            {copiedId === s.id ? "Copied" : "Copy"}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleToggleMaintenance(s)}
                            title={s.is_maintenance ? "Turn off maintenance mode" : "Enable maintenance kill-switch"}
                            className={s.is_maintenance ? "text-warning-text" : "hover:text-warning-text"}
                          >
                            <AlertTriangle />
                            {s.is_maintenance ? "End maintenance" : "Kill-switch"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setUpdatingScript(s)}
                            title="Update script files without resetting loadstring"
                          >
                            <FileEdit />
                            Update
                          </Button>
                          <a
                            href={`/api/loader/${s.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className={buttonClasses({ variant: "ghost", size: "xs", iconOnly: true })}
                            title="Inspect public loader code"
                            aria-label="Inspect public loader code"
                          >
                            <ExternalLink />
                          </a>
                          <Button
                            variant="ghost"
                            size="xs"
                            iconOnly
                            onClick={() => handleDelete(s.id)}
                            title="Delete script"
                            aria-label="Delete script"
                            className="hover:bg-danger/10 hover:text-danger-text"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {s.is_maintenance && (
                      <TableRow className="bg-warning/[0.04]">
                        <TableCell colSpan={8} className="h-7 text-caption text-warning-text">
                          <span className="mr-2 text-fg-subtle">Notice shown in game:</span>
                          {s.maintenance_message || "Script under maintenance"}
                          <span className="ml-2 text-fg-subtle">(staff review keys bypass)</span>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ScriptUpdateModal
        script={updatingScript}
        isOpen={!!updatingScript}
        onClose={() => setUpdatingScript(null)}
        onScriptUpdated={handleScriptUpdated}
      />
    </div>
  );
}
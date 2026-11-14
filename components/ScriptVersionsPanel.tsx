// components/ScriptVersionsPanel.tsx — list a script's saved builds and roll back to one
"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, History, RotateCcw } from "lucide-react";
import { Alert, Badge, Button } from "@/components/ui";
import type { ScriptVersion } from "@/lib/store";

export default function ScriptVersionsPanel({ scriptId, onRestored }: { scriptId: string; onRestored: () => void }) {
  const [versions, setVersions] = useState<ScriptVersion[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    let off = false;
    fetch(`/api/scripts/versions?script_id=${encodeURIComponent(scriptId)}`)
      .then((r) => (r.ok ? r.json() : { versions: [] }))
      .then((j) => !off && setVersions(j.versions || []));
    return () => {
      off = true;
    };
  }, [scriptId]);

  const restore = async (v: ScriptVersion) => {
    if (!confirm(`Roll back to version ${v.version}? Players get that build on their next run. The current build stays in this list.`)) return;
    setBusyId(v.id);
    setMsg(null);
    try {
      const res = await fetch("/api/scripts/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_id: scriptId, version_id: v.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Restore failed");
      setVersions(j.versions || []);
      setMsg({ tone: "success", text: `Restored version ${v.version}. It's live now.` });
      onRestored();
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Restore failed" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-caption text-fg-muted">
        Every save, update and GitHub sync keeps a full snapshot (source files + protected build). The newest 10 are kept.
      </p>
      {msg && <Alert tone={msg.tone} icon={<AlertCircle />}>{msg.text}</Alert>}
      {versions === null ? (
        <p className="text-body-sm text-fg-muted">Loading versions…</p>
      ) : versions.length === 0 ? (
        <p className="text-body-sm text-fg-muted">
          <History className="mr-1 inline h-4 w-4" />
          No versions yet. One is saved the next time you update this script (requires migration 002).
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {versions.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-body-sm text-fg">
                  <span className="font-data font-semibold">v{v.version}</span>
                  {i === 0 && <Badge tone="success">Current</Badge>}
                  <span className="truncate text-fg-muted">{v.note || "Saved"}</span>
                </p>
                <p className="text-caption text-fg-subtle">
                  {new Date(v.created_at).toLocaleString()} · {v.vm_preset || "balanced"} ·{" "}
                  {v.size_bytes ? `${(v.size_bytes / 1024).toFixed(0)} KB` : "—"}
                </p>
              </div>
              {i > 0 && (
                <Button size="sm" variant="secondary" loading={busyId === v.id} disabled={Boolean(busyId)} onClick={() => restore(v)}>
                  <RotateCcw /> Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

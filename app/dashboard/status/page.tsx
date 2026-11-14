// app/dashboard/status/page.tsx — edit the public status page
"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import type { StatusComponent, StatusIncident, StatusPageData } from "@/lib/store";
import { STATUS_META, INCIDENT_STATE_LABEL, SEVERITY_LABEL } from "@/lib/status-meta";

const STATUSES = ["operational", "degraded", "partial_outage", "major_outage", "maintenance"] as const;
const SEVERITIES = ["minor", "major", "critical", "maintenance"] as const;
const STATES = ["investigating", "identified", "monitoring", "resolved"] as const;

type Draft = { id?: string; title: string; body: string; severity: string; state: string };
const EMPTY_DRAFT: Draft = { title: "", body: "", severity: "minor", state: "investigating" };

export default function StatusEditorPage() {
  const [data, setData] = useState<StatusPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newService, setNewService] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const load = async () => {
    const res = await fetch("/api/status?admin=1");
    if (res.ok) setData(await res.json());
  };
  useEffect(() => {
    load();
  }, []);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Update failed");
      setData(json);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateComponent = (c: StatusComponent, patch: Partial<StatusComponent>) =>
    post({ action: "update_component", id: c.id, ...patch });

  const saveIncident = async () => {
    if (await post({ action: "save_incident", ...draft })) setDraft(EMPTY_DRAFT);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col justify-between gap-3 border-b border-line pb-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-heading font-semibold text-fg">Status page</h1>
          <p className="mt-0.5 text-body-sm text-fg-muted">
            What players see at <code>/status</code>. A script in maintenance mode shows as Maintenance automatically.
          </p>
        </div>
        <a href="/status" target="_blank" rel="noreferrer">
          <Button variant="secondary">
            <ExternalLink /> View public page
          </Button>
        </a>
      </div>

      {error && <Alert tone="danger" icon={<AlertCircle />}>{error}</Alert>}
      {data?.unavailable && (
        <Alert tone="warning" icon={<AlertCircle />}>
          The status tables aren't available yet. Run <code>migration/002_features.sql</code> in Supabase.
        </Alert>
      )}

      <Card>
        <CardHeader divided title="Components" description="Website, each active script, and any custom services you add." />
        <CardBody className="space-y-3">
          {!data ? (
            <p className="text-body-sm text-fg-muted">Loading…</p>
          ) : (
            data.components.map((c) => (
              <div key={c.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_190px] sm:items-start">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${STATUS_META[c.effective_status]?.dot}`} />
                    <span className="font-medium text-fg">{c.name}</span>
                    <span className="text-caption text-fg-subtle">{c.kind}</span>
                    {c.effective_status !== c.status && <span className="text-caption text-accent-text">(maintenance mode on)</span>}
                  </div>
                  <Input
                    defaultValue={c.message || ""}
                    placeholder="Optional message shown under this component"
                    maxLength={500}
                    onBlur={(e) => e.target.value !== (c.message || "") && updateComponent(c, { message: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <Select
                    value={c.status}
                    disabled={busy}
                    onChange={(e) => updateComponent(c, { status: e.target.value as StatusComponent["status"] })}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_META[s].label}
                      </option>
                    ))}
                  </Select>
                  {c.kind === "service" && (
                    <Button variant="ghost" title="Delete" onClick={() => confirm(`Delete "${c.name}"?`) && post({ action: "delete_component", id: c.id })}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
          <div className="flex gap-2 pt-1">
            <Input value={newService} onChange={(e) => setNewService(e.target.value)} placeholder="Add a custom service (e.g. Discord bot)" maxLength={80} />
            <Button
              variant="secondary"
              disabled={!newService.trim() || busy}
              onClick={async () => (await post({ action: "create_component", name: newService })) && setNewService("")}
            >
              <Plus /> Add
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader divided title={draft.id ? "Update incident" : "Post an incident"} description="Active incidents appear at the top of the status page." />
        <CardBody className="space-y-3">
          <Field label="Title" htmlFor="inc-title">
            <Input id="inc-title" value={draft.title} maxLength={160} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Loader slow to respond" />
          </Field>
          <Field label="Details (optional)" htmlFor="inc-body">
            <Textarea id="inc-body" rows={3} maxLength={4000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Severity" htmlFor="inc-sev">
              <Select id="inc-sev" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="State" htmlFor="inc-state">
              <Select id="inc-state" value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
                {STATES.map((s) => <option key={s} value={s}>{INCIDENT_STATE_LABEL[s]}</option>)}
              </Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={saveIncident} loading={busy} disabled={!draft.title.trim()}>
              {draft.id ? "Save update" : "Post incident"}
            </Button>
            {draft.id && <Button variant="ghost" onClick={() => setDraft(EMPTY_DRAFT)}>Cancel</Button>}
          </div>

          {(data?.incidents || []).length > 0 && (
            <div className="space-y-2 border-t border-line pt-3">
              {(data?.incidents || []).map((i: StatusIncident) => (
                <div key={i.id} className="flex items-start justify-between gap-3 rounded-md border border-line p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-fg">{i.title}</p>
                    <p className="text-caption text-fg-muted">
                      {SEVERITY_LABEL[i.severity]} · {INCIDENT_STATE_LABEL[i.state]} · {new Date(i.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDraft({ id: i.id, title: i.title, body: i.body || "", severity: i.severity, state: i.state })}>
                      Edit
                    </Button>
                    {i.state !== "resolved" && (
                      <Button variant="secondary" size="sm" onClick={() => post({ action: "save_incident", id: i.id, title: i.title, body: i.body, severity: i.severity, state: "resolved" })}>
                        Resolve
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" title="Delete" onClick={() => confirm("Delete this incident?") && post({ action: "delete_incident", id: i.id })}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

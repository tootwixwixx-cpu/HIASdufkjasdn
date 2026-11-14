// app/status/page.tsx — public status page (website + every script), editable from /dashboard/status
import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/ui";
import { dbService } from "@/lib/store";
import { STATUS_META, OVERALL_HEADLINE, INCIDENT_STATE_LABEL, SEVERITY_LABEL } from "@/lib/status-meta";

export const revalidate = 30;
export const metadata: Metadata = { title: "System status — AtomProtect" };

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export default async function StatusPage() {
  const data = await dbService.getStatusPage();
  const overall = STATUS_META[data.overall] || STATUS_META.operational;
  const active = data.incidents.filter((i) => i.state !== "resolved");
  const past = data.incidents.filter((i) => i.state === "resolved");

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="flex h-14 items-center justify-between border-b border-line px-4 sm:px-6">
        <Link href="/" aria-label="Home">
          <Logo size="md" />
        </Link>
        <Link href="/" className="text-body-sm text-fg-muted hover:text-fg">
          Back to site
        </Link>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 shrink-0 rounded-full ${overall.dot}`} />
            <h1 className="text-heading font-semibold">{OVERALL_HEADLINE[data.overall] || overall.label}</h1>
          </div>
          {data.unavailable && <p className="mt-2 text-body-sm text-fg-muted">Status information is temporarily unavailable.</p>}
        </div>

        {active.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-body font-semibold">Current incidents</h2>
            {active.map((i) => (
              <article key={i.id} className="rounded-lg border border-warning/40 bg-warning/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{i.title}</h3>
                  <span className="rounded border border-line px-1.5 text-caption text-fg-muted">{SEVERITY_LABEL[i.severity]}</span>
                  <span className="text-caption text-warning-text">{INCIDENT_STATE_LABEL[i.state]}</span>
                </div>
                {i.body && <p className="mt-2 whitespace-pre-line text-body-sm text-fg-muted">{i.body}</p>}
                <p className="mt-2 text-caption text-fg-subtle">Started {fmt(i.created_at)}</p>
              </article>
            ))}
          </section>
        )}

        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          {data.components.map((c, idx) => {
            const m = STATUS_META[c.effective_status] || STATUS_META.operational;
            return (
              <div key={c.id} className={`flex items-start justify-between gap-4 px-4 py-3 ${idx > 0 ? "border-t border-line" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  {c.message && <p className="mt-0.5 text-body-sm text-fg-muted">{c.message}</p>}
                </div>
                <span className={`flex shrink-0 items-center gap-2 text-body-sm ${m.text}`}>
                  <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                  {m.label}
                </span>
              </div>
            );
          })}
          {data.components.length === 0 && <p className="px-4 py-6 text-body-sm text-fg-muted">No components yet.</p>}
        </section>

        {past.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold">Past incidents (14 days)</h2>
            {past.map((i) => (
              <article key={i.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{i.title}</h3>
                  <span className="text-caption text-success-text">Resolved</span>
                </div>
                {i.body && <p className="mt-1 whitespace-pre-line text-body-sm text-fg-muted">{i.body}</p>}
                <p className="mt-1 text-caption text-fg-subtle">
                  {fmt(i.created_at)} → {i.resolved_at ? fmt(i.resolved_at) : "—"}
                </p>
              </article>
            ))}
          </section>
        )}

        <p className="text-center text-caption text-fg-subtle">Updates every 30 seconds.</p>
      </main>
    </div>
  );
}

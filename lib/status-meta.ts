// lib/status-meta.ts — labels and colours shared by the public status page and the dashboard editor.
export const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  operational: { label: "Operational", dot: "bg-success", text: "text-success-text" },
  maintenance: { label: "Maintenance", dot: "bg-accent", text: "text-accent-text" },
  degraded: { label: "Degraded performance", dot: "bg-warning", text: "text-warning-text" },
  partial_outage: { label: "Partial outage", dot: "bg-warning", text: "text-warning-text" },
  major_outage: { label: "Major outage", dot: "bg-danger", text: "text-danger-text" },
};

export const OVERALL_HEADLINE: Record<string, string> = {
  operational: "All systems operational",
  maintenance: "Scheduled maintenance in progress",
  degraded: "Some systems are degraded",
  partial_outage: "Partial outage",
  major_outage: "Major outage",
};

export const INCIDENT_STATE_LABEL: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export const SEVERITY_LABEL: Record<string, string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
  maintenance: "Maintenance",
};

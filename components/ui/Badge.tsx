import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<BadgeTone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-ink-50/[0.06] text-fg-muted ring-line-strong", dot: "bg-fg-subtle" },
  accent: { badge: "bg-accent/[0.12] text-accent-text ring-accent/25", dot: "bg-accent" },
  success: { badge: "bg-success/[0.12] text-success-text ring-success/25", dot: "bg-success" },
  warning: { badge: "bg-warning/[0.12] text-warning-text ring-warning/25", dot: "bg-warning" },
  danger: { badge: "bg-danger/[0.12] text-danger-text ring-danger/25", dot: "bg-danger" },
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Leading status dot. */
  dot?: boolean;
  /** Monospace content (hash prefixes, versions). */
  mono?: boolean;
}

export function Badge({ tone = "neutral", dot = false, mono = false, className, children, ...props }: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-1.5 text-micro font-medium ring-1 ring-inset",
        mono && "font-data",
        t.badge,
        className,
      )}
      {...props}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} /> : null}
      {children}
    </span>
  );
}

/**
 * Canonical status vocabulary for keys / players / scripts.
 * Every page should use these so a status always looks the same.
 */
export const STATUS = {
  active: { tone: "success", label: "Active" },
  online: { tone: "success", label: "Online" },
  claimed: { tone: "accent", label: "Claimed" },
  unused: { tone: "neutral", label: "Unused" },
  offline: { tone: "neutral", label: "Offline" },
  paused: { tone: "neutral", label: "Paused" },
  pending: { tone: "warning", label: "Pending" },
  expiring: { tone: "warning", label: "Expiring" },
  expired: { tone: "warning", label: "Expired" },
  flagged: { tone: "warning", label: "Flagged" },
  revoked: { tone: "danger", label: "Revoked" },
  banned: { tone: "danger", label: "Banned" },
  blocked: { tone: "danger", label: "Blocked" },
} as const satisfies Record<string, { tone: BadgeTone; label: string }>;

export type Status = keyof typeof STATUS;

export interface StatusBadgeProps extends Omit<BadgeProps, "tone"> {
  status: Status;
}

export function StatusBadge({ status, children, dot = true, ...props }: StatusBadgeProps) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot={dot} {...props}>
      {children ?? s.label}
    </Badge>
  );
}

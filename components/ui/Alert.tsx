import * as React from "react";
import { cn } from "@/lib/utils";

export type AlertTone = "neutral" | "accent" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: string; title: string }> = {
  neutral: { box: "border-line bg-surface", icon: "text-fg-subtle", title: "text-fg" },
  accent: { box: "border-accent/30 bg-accent/[0.07]", icon: "text-accent-text", title: "text-accent-text" },
  success: { box: "border-success/30 bg-success/[0.07]", icon: "text-success-text", title: "text-success-text" },
  warning: { box: "border-warning/30 bg-warning/[0.07]", icon: "text-warning-text", title: "text-warning-text" },
  danger: { box: "border-danger/30 bg-danger/[0.07]", icon: "text-danger-text", title: "text-danger-text" },
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  /** Leading lucide icon element. */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  /** Controls under the message (e.g. a retry button). */
  action?: React.ReactNode;
}

/**
 * Inline banner for form errors, blocked states and confirmations.
 * Body text stays fg-muted for readability; the tone lives in the border,
 * tint, icon and title. Danger/warning alerts announce themselves.
 */
export function Alert({ tone = "neutral", icon, title, action, className, children, role, ...props }: AlertProps) {
  const t = tones[tone];
  return (
    <div
      role={role ?? (tone === "danger" || tone === "warning" ? "alert" : "status")}
      className={cn("flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-body-sm", t.box, className)}
      {...props}
    >
      {icon ? <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", t.icon)}>{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className={cn("font-semibold", t.title)}>{title}</p> : null}
        {children ? <div className={cn("text-fg-muted", title && "mt-0.5")}>{children}</div> : null}
        {action ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

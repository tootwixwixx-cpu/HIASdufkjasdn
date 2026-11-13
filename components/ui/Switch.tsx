"use client";

import * as React from "react";
import { cn, focusRing } from "@/lib/utils";

/**
 * On/off switch (role="switch"). Replaces the hidden-checkbox + `peer` hack.
 * Controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`).
 */
export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value" | "defaultValue"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md";
  /** Visible label rendered to the right; clicking it toggles. */
  label?: React.ReactNode;
  description?: React.ReactNode;
}

const sizes = {
  sm: { track: "h-4 w-7", thumb: "size-3", on: "translate-x-3" },
  md: { track: "h-5 w-9", thumb: "size-4", on: "translate-x-4" },
} as const;

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked = false, onCheckedChange, size = "md", label, description, disabled, className, id, ...props },
  ref,
) {
  const [internal, setInternal] = React.useState(defaultChecked);
  const isOn = checked ?? internal;
  const autoId = React.useId();
  const switchId = id ?? autoId;
  const s = sizes[size];

  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!isOn);
    onCheckedChange?.(!isOn);
  };

  const control = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-describedby={description ? `${switchId}-desc` : undefined}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border p-px transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        focusRing,
        s.track,
        isOn ? "border-transparent bg-accent" : "border-line-strong bg-surface-active hover:border-ink-500",
        !label && className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "rounded-full shadow-sm transition-transform duration-150 motion-reduce:transition-none",
          s.thumb,
          isOn ? cn(s.on, "bg-accent-fg") : "translate-x-0 bg-fg-muted",
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <div className={size === "md" ? "pt-px" : "pt-0.5"}>{control}</div>
      <div className="min-w-0">
        <label
          htmlFor={switchId}
          className={cn("cursor-pointer select-none text-body-sm font-medium text-fg", disabled && "cursor-not-allowed text-fg-disabled")}
        >
          {label}
        </label>
        {description ? (
          <p id={`${switchId}-desc`} className="text-caption text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
});

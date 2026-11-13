"use client";

import * as React from "react";
import { cn, focusRing } from "@/lib/utils";

/**
 * Tabs with roving focus (Arrow keys / Home / End).
 *  - variant="underline": page-level section switching
 *  - variant="segmented": compact switch inside toolbars / cards
 */

type TabsVariant = "underline" | "segmented";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  variant: TabsVariant;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used inside <Tabs>");
  return ctx;
}

export interface TabsProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  variant?: TabsVariant;
}

export function Tabs({ value, defaultValue, onValueChange, variant = "underline", className, ...props }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value ?? internal;
  const baseId = React.useId();
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  return (
    <TabsContext.Provider value={{ value: current, setValue, variant, baseId }}>
      <div className={className} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, onKeyDown, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useTabs();
  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(e);
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i === -1) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  }
  return (
    <div
      role="tablist"
      onKeyDown={handleKey}
      className={cn(
        variant === "underline"
          ? "flex items-center gap-4 border-b border-line"
          : "inline-flex items-center gap-0.5 rounded-md border border-line bg-surface p-0.5",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
  /** Optional trailing count (e.g. number of flagged players). */
  count?: number;
}

export function TabsTrigger({ value, count, className, children, ...props }: TabsTriggerProps) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-100 disabled:pointer-events-none disabled:text-fg-disabled [&_svg]:size-3.5",
        focusRing,
        ctx.variant === "underline"
          ? cn(
              "relative -mb-px h-9 border-b-2 px-0.5 text-body-sm",
              selected ? "border-accent text-fg" : "border-transparent text-fg-subtle hover:text-fg-muted",
            )
          : cn(
              "h-6 rounded px-2.5 text-caption",
              selected ? "bg-surface-active text-fg shadow-hairline" : "text-fg-subtle hover:text-fg-muted",
            ),
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            "font-data rounded-sm px-1 text-micro",
            selected ? "bg-accent/15 text-accent-text" : "bg-surface-hover text-fg-subtle",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const ctx = useTabs();
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

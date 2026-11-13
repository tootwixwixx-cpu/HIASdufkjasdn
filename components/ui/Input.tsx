import * as React from "react";
import { cn } from "@/lib/utils";

/** Shared control chrome for Input / Select / Textarea. */
export const controlBase =
  "w-full rounded-md border border-line-strong bg-surface text-fg placeholder:text-fg-subtle transition-colors duration-100 " +
  "hover:border-ink-500 " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-surface/50 disabled:text-fg-disabled " +
  "aria-[invalid=true]:border-danger/70 aria-[invalid=true]:focus:ring-danger/25 " +
  "read-only:bg-canvas read-only:focus:border-line-strong read-only:focus:ring-0";

export const controlSizes = {
  sm: "h-7 px-2 text-caption",
  md: "h-8 px-2.5 text-body-sm",
  lg: "h-10 px-3 text-body",
} as const;

export type ControlSize = keyof typeof controlSizes;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
  /** Monospace for keys, IDs, IPs, HWIDs. */
  mono?: boolean;
  invalid?: boolean;
  /** Icon/element inside the left edge (e.g. a lucide Search icon). */
  leading?: React.ReactNode;
  /** Element inside the right edge (e.g. a copy button or unit). */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", mono, invalid, leading, trailing, className, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cn(
        controlBase,
        controlSizes[size],
        mono && "font-data",
        leading ? (size === "lg" ? "pl-9" : "pl-8") : null,
        trailing ? "pr-8" : null,
        !leading && !trailing && className,
      )}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <div className={cn("relative w-full", className)}>
      {leading ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-fg-subtle [&_svg]:size-3.5">
          {leading}
        </span>
      ) : null}
      {input}
      {trailing ? (
        <span className="absolute inset-y-0 right-0 flex items-center pr-1 text-fg-subtle [&_svg]:size-3.5">{trailing}</span>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { mono, invalid, className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, "min-h-16 px-2.5 py-1.5 text-body-sm", mono && "font-data text-caption", className)}
      {...props}
    />
  );
});

export interface FieldProps {
  label: React.ReactNode;
  /** id of the control this label points at. */
  htmlFor: string;
  hint?: React.ReactNode;
  /** Error message. Replaces the hint and should say how to fix it. */
  error?: React.ReactNode;
  /** Right side of the label row (e.g. "Optional" or a help link). */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error stack. */
export function Field({ label, htmlFor, hint, error, aside, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-caption font-medium text-fg-muted">
          {label}
        </label>
        {aside ? <span className="text-caption text-fg-subtle">{aside}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-caption text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

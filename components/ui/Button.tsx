import * as React from "react";
import { cn, focusRing } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

const base =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors duration-100 disabled:pointer-events-none [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active disabled:bg-surface-hover disabled:text-fg-disabled",
  secondary:
    "border-line-strong bg-surface-raised text-fg shadow-hairline hover:border-ink-500 hover:bg-surface-hover active:bg-surface-active disabled:border-line disabled:bg-surface disabled:text-fg-disabled disabled:shadow-none",
  ghost:
    "border-transparent bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-active disabled:text-fg-disabled",
  danger:
    "border-transparent bg-danger-solid text-white hover:bg-danger-solid-hover active:bg-danger-solid disabled:bg-surface-hover disabled:text-fg-disabled",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-caption [&_svg]:size-3.5",
  sm: "h-7 px-2.5 text-body-sm [&_svg]:size-3.5",
  md: "h-8 px-3 text-body-sm [&_svg]:size-4",
  lg: "h-10 px-4 text-body [&_svg]:size-4",
};

const iconSizes: Record<ButtonSize, string> = {
  xs: "w-6 px-0",
  sm: "w-7 px-0",
  md: "w-8 px-0",
  lg: "w-10 px-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square icon-only button. Pass `aria-label`. */
  iconOnly?: boolean;
  /** Shows a spinner, keeps width stable, disables the button. */
  loading?: boolean;
}

export function buttonClasses({
  variant = "secondary",
  size = "md",
  iconOnly = false,
  className,
}: Pick<ButtonProps, "variant" | "size" | "iconOnly" | "className"> = {}) {
  return cn(base, focusRing, variants[variant], sizes[size], iconOnly && iconSizes[size], className);
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", iconOnly = false, loading = false, disabled, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, iconOnly, className })}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-1.5">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={cn("size-3.5 animate-spin motion-reduce:animate-none", className)}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlBase, controlSizes, type ControlSize } from "./Input";

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: ControlSize;
  invalid?: boolean;
  /** Class for the outer wrapper (width etc.). */
  wrapperClassName?: string;
}

/**
 * Native <select> with control styling. Native keeps keyboard, mobile pickers
 * and form submission free; swap for a custom listbox only if options need
 * rich content.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", invalid, className, wrapperClassName, children, ...props },
  ref,
) {
  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          controlBase,
          controlSizes[size],
          "cursor-pointer appearance-none pr-8 [&>option]:bg-surface-overlay [&>option]:text-fg",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
});

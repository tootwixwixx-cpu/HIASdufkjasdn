import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * AtomProtect logomark: "orbit seal".
 *
 * A nucleus held inside a single closed orbit. The orbit is broken at the
 * upper right and the electron sits in the break, so the electron is what
 * completes (seals) the ring: a key closing a lock. Three shapes only, so it
 * survives down to 16px.
 *
 * Geometry (24x24): orbit r=8.5 centered at 12,12, gap from -70deg to -20deg,
 * electron at -45deg. Butt caps keep the gap crisp at small sizes.
 */
export const LOGO_PATHS = {
  orbit: "M19.987 9.093A8.5 8.5 0 1 1 14.907 4.012",
  nucleus: { cx: 12, cy: 12, r: 3 },
  electron: { cx: 18.01, cy: 5.99, r: 2.2 },
} as const;

type MarkTone = "brand" | "mono";

export interface LogoMarkProps extends React.SVGProps<SVGSVGElement> {
  /** Rendered pixel size (square). */
  size?: number;
  /** brand = electron in accent; mono = all currentColor. */
  tone?: MarkTone;
  /** Accessible name. Omit when a visible wordmark sits next to it. */
  title?: string;
}

export function LogoMark({ size = 20, tone = "brand", title, className, ...props }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0 text-fg", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={LOGO_PATHS.orbit} stroke="currentColor" strokeWidth={2.25} strokeLinecap="butt" />
      <circle {...LOGO_PATHS.nucleus} fill="currentColor" />
      <circle
        {...LOGO_PATHS.electron}
        className={tone === "brand" ? "fill-accent" : undefined}
        fill={tone === "brand" ? undefined : "currentColor"}
      />
    </svg>
  );
}

const logoSizes = {
  sm: { mark: 18, text: "text-[14px]", gap: "gap-1.5" },
  md: { mark: 22, text: "text-[17px]", gap: "gap-2" },
  lg: { mark: 32, text: "text-[24px]", gap: "gap-2.5" },
  xl: { mark: 48, text: "text-[36px]", gap: "gap-3.5" },
} as const;

export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof logoSizes;
  tone?: MarkTone;
  /** Hide the wordmark (mark only, still labelled for assistive tech). */
  markOnly?: boolean;
}

/** Mark + "AtomProtect" wordmark. One weight, one color: the mark carries the accent. */
export function Logo({ size = "md", tone = "brand", markOnly = false, className, ...props }: LogoProps) {
  const s = logoSizes[size];
  if (markOnly) {
    return (
      <span className={cn("inline-flex", className)} {...props}>
        <LogoMark size={s.mark} tone={tone} title="AtomProtect" />
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center text-fg", s.gap, className)}
      {...props}
    >
      <LogoMark size={s.mark} tone={tone} />
      <span className={cn("font-sans font-semibold leading-none tracking-[-0.03em]", s.text)}>
        AtomProtect
      </span>
    </span>
  );
}

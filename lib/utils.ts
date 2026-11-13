import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know about our custom theme keys, otherwise it
 * mis-classifies e.g. `text-caption` (a font size) as a text color and drops
 * it when merged with `text-fg-muted`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "caption", "body-sm", "body", "title", "heading", "display", "hero"] },
      ],
      shadow: [{ shadow: ["popover", "modal", "hairline"] }],
    },
  },
});

/** Compose class names; later Tailwind classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared keyboard focus treatment for every interactive primitive. */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas";

import type { Config } from "tailwindcss";

/**
 * AtomProtect design tokens (Tailwind v3).
 *
 * Source of truth for semantic colors is the CSS custom properties in
 * app/globals.css (stored as space-separated RGB channels so Tailwind opacity
 * modifiers like `bg-accent/15` work). This file maps them to utilities.
 *
 * Rules of thumb:
 *  - Neutrals: use semantic names (canvas / surface / line / fg-*) in new
 *    code. The raw `ink-*` scale exists for the rare case a semantic name
 *    doesn't fit.
 *  - One accent ("Cherenkov blue"). Status colors (success / warning /
 *    danger) are for state only, never decoration or feature branding.
 *  - Radius encodes hierarchy: badge 4px -> control 6px -> card 8px ->
 *    modal 12px. Don't put one radius on everything.
 */

const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- Semantic surfaces (dark-only) ----
        canvas: rgb("canvas"), // app background
        surface: {
          DEFAULT: rgb("surface"), // sidebars, inset wells, input fill
          raised: rgb("surface-raised"), // cards, table body
          overlay: rgb("surface-overlay"), // modals, popovers
          hover: rgb("surface-hover"), // row / ghost-button hover
          active: rgb("surface-active"), // pressed / selected row
        },
        line: {
          DEFAULT: rgb("line"), // default 1px borders, dividers
          strong: rgb("line-strong"), // control borders
          subtle: rgb("line-subtle"), // row separators inside tables
        },
        fg: {
          DEFAULT: rgb("fg"), // primary text
          muted: rgb("fg-muted"), // secondary text
          subtle: rgb("fg-subtle"), // tertiary text, column headers, icons
          disabled: rgb("fg-disabled"),
        },

        // ---- The one accent ----
        accent: {
          DEFAULT: rgb("accent"),
          hover: rgb("accent-hover"),
          active: rgb("accent-active"),
          fg: rgb("accent-fg"), // text on a solid accent fill
          text: rgb("accent-text"), // accent-colored text/links on dark
        },

        // ---- Status (state only) ----
        success: { DEFAULT: rgb("success"), text: rgb("success-text") },
        warning: { DEFAULT: rgb("warning"), text: rgb("warning-text") },
        danger: {
          DEFAULT: rgb("danger"),
          text: rgb("danger-text"),
          solid: rgb("danger-solid"), // destructive button fill (white text, AA)
          "solid-hover": rgb("danger-solid-hover"),
        },
        info: { DEFAULT: rgb("accent"), text: rgb("accent-text") },

        // ---- Raw neutral scale (cool graphite) ----
        ink: {
          50: "#f5f6f8",
          100: "#e6e8ec",
          200: "#c0c5cd",
          300: "#949aa6",
          400: "#6c7280",
          500: "#4a505d",
          600: "#2e333e",
          700: "#22262f",
          800: "#181b22",
          850: "#12141a",
          900: "#0d0f13",
          950: "#08090c",
        },

        // ---- Legacy aliases ----
        // @deprecated Kept byte-identical so un-migrated pages render exactly
        // as before. New code uses the semantic tokens above. Remove once
        // every page is migrated. (The unused `roblox` palette was removed.)
        background: "var(--background)",
        foreground: "var(--foreground)",
        obsidian: {
          950: "#050507",
          900: "#070709",
          850: "#0b0c10",
          800: "#101117",
          750: "#14161f",
          700: "#1a1d29",
          600: "#242838",
        },
      },

      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },

      // Additive, named type scale tuned for a dense dashboard. Tailwind's
      // default text-xs..text-9xl still exist (un-migrated pages use them).
      fontSize: {
        micro: ["11px", { lineHeight: "16px", letterSpacing: "0.01em" }], // badges, meta
        caption: ["12px", { lineHeight: "16px" }], // table headers, hints, mono data
        "body-sm": ["13px", { lineHeight: "20px" }], // default dashboard UI text, table cells
        body: ["14px", { lineHeight: "22px" }], // forms, in-app prose
        title: ["15px", { lineHeight: "22px", letterSpacing: "-0.005em" }], // card / modal titles
        heading: ["20px", { lineHeight: "28px", letterSpacing: "-0.015em" }], // page titles
        display: ["30px", { lineHeight: "36px", letterSpacing: "-0.025em" }], // login, section heads
        hero: ["52px", { lineHeight: "56px", letterSpacing: "-0.035em" }], // marketing hero
      },

      borderRadius: {
        xs: "3px", // kbd, inline code
        // Tailwind defaults kept: rounded (4px) badge, rounded-md (6px)
        // control, rounded-lg (8px) card, rounded-xl (12px) modal.
      },

      spacing: {
        4.5: "1.125rem",
        13: "3.25rem",
      },

      boxShadow: {
        // Dark UIs read depth from borders + surface steps, not soft grey
        // shadows. Only floating layers get a shadow.
        popover: "0 8px 24px -6px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(var(--line-strong) / 1)",
        modal: "0 24px 64px -12px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(var(--line-strong) / 1)",
        hairline: "inset 0 1px 0 0 rgb(255 255 255 / 0.04)",
      },

      keyframes: {
        "overlay-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "dialog-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "overlay-in": "overlay-in 140ms ease-out",
        "dialog-in": "dialog-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
export default config;

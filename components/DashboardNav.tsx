// components/DashboardNav.tsx
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Terminal,
  Sliders,
  Key,
  Users,
  Settings,
  ExternalLink,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Menu,
  X,
  Activity,
  ScrollText,
} from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import { Logo, buttonClasses } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

// One accent for the active item; every other item is neutral. Items are
// told apart by their glyph, not by a per-feature color.
const NAV_ITEMS = [
  { href: "/dashboard/scripts", label: "Scripts Vault", icon: Terminal },
  { href: "/dashboard/loader-builder", label: "Build Auth Loader", icon: Sliders },
  { href: "/dashboard/checkpoints", label: "Checkpoints & Profile", icon: CheckCircle2 },
  { href: "/dashboard/keys", label: "Keys Pool", icon: Key },
  { href: "/dashboard/players", label: "Players & Telemetry", icon: Users },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/status", label: "Status Page", icon: Activity },
  { href: "/dashboard/audit", label: "Audit Log", icon: ScrollText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-line bg-surface px-3 md:hidden">
        <Link href="/" className={cn("rounded-md", focusRing)}>
          <Logo size="sm" />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          className={buttonClasses({ variant: "ghost", size: "sm", iconOnly: true })}
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Sidebar (desktop + mobile slide) */}
      <aside
        className={cn(
          "z-30 w-full shrink-0 flex-col border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r",
          mobileOpen ? "flex" : "hidden md:flex",
        )}
      >
        {/* Brand */}
        <div className="hidden h-12 items-center justify-between border-b border-line px-3 md:flex">
          <Link href="/" className={cn("rounded-md", focusRing)}>
            <Logo size="sm" />
          </Link>
          <Link
            href="/"
            className={buttonClasses({ variant: "ghost", size: "xs", iconOnly: true })}
            title="Public homepage"
            aria-label="Public homepage"
          >
            <ArrowLeft />
          </Link>
        </div>

        {/* System status */}
        <div className="flex h-8 items-center justify-between border-b border-line-subtle px-3 text-caption">
          <span className="flex items-center gap-2 text-fg-muted">
            <span aria-hidden className="size-1.5 rounded-full bg-success" />
            Cron & VFS active
          </span>
          <span className="font-data text-micro text-fg-subtle">v2.4</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-px overflow-y-auto p-2" aria-label="Dashboard">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== "/dashboard/scripts" && pathname?.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-body-sm transition-colors duration-100",
                  focusRing,
                  isActive
                    ? "bg-surface-active font-medium text-fg before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent"
                    : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                )}
              >
                <Icon aria-hidden className={cn("size-4 shrink-0", isActive ? "text-accent-text" : "text-fg-subtle")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="space-y-1 border-t border-line p-2">
          <Link
            href="/claim"
            target="_blank"
            className={buttonClasses({ variant: "secondary", size: "sm", className: "w-full" })}
          >
            <ExternalLink />
            <span>Open public claim page</span>
          </Link>
          <LogoutButton />
        </div>
      </aside>
    </>
  );
}

"use client";

import React from "react";
import Link from "next/link";
import { Key, MessageSquare } from "lucide-react";
import ClaimScriptModal, { ScriptSummary } from "./ClaimScriptModal";
import { Badge, Logo, buttonClasses } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

interface Props {
  scripts?: ScriptSummary[];
  discordUrl?: string;
}

const navLink = cn(
  "rounded-sm text-body-sm text-fg-muted transition-colors duration-100 hover:text-fg",
  focusRing,
);

export default function Navbar({ scripts, discordUrl = "https://discord.gg/NdrTc27GxT" }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Brand + status */}
        <div className="flex items-center gap-4">
          <Link href="/" className={cn("rounded-md", focusRing)} aria-label="AtomProtect home">
            <Logo size="md" />
          </Link>
          <Badge tone="success" dot className="hidden md:inline-flex">
            Systems normal
          </Badge>
        </div>

        {/* Section anchors */}
        <nav aria-label="Sections" className="hidden items-center gap-6 lg:flex">
          <a href="#features" className={navLink}>
            Capabilities
          </a>
          <a href="#telemetry" className={navLink}>
            Telemetry
          </a>
          <a href="#scripts" className={navLink}>
            Scripts
          </a>
          <Link href="/status" className={navLink}>
            Status
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <a
            href={discordUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonClasses({ variant: "ghost", size: "sm", className: "hidden sm:inline-flex" })}
          >
            <MessageSquare />
            <span>Discord</span>
          </a>

          {scripts ? (
            <ClaimScriptModal scripts={scripts} buttonText="Claim key" variant="primary" size="sm" />
          ) : (
            <Link href="/claim" className={buttonClasses({ variant: "primary", size: "sm" })}>
              <Key />
              <span>Claim key</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

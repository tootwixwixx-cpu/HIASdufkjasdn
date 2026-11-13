// components/ClaimScriptModal.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Key, Search, Terminal, ShieldCheck, ChevronRight, Lock } from "lucide-react";
import { Badge, Button, Input, Modal, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

export interface ScriptSummary {
  id: string;
  name: string;
  slug: string;
  use_auth?: boolean;
  watermark_text?: string;
}

interface Props {
  scripts: ScriptSummary[];
  /** Extra classes merged onto the trigger Button. */
  buttonClassName?: string;
  buttonText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function ClaimScriptModal({
  scripts,
  buttonClassName,
  buttonText = "Claim license key",
  variant = "primary",
  size = "md",
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();

  const filteredScripts = scripts.filter((s) => {
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q);
  });

  const handleSelectScript = (slug: string) => {
    setIsOpen(false);
    router.push(`/claim?script=${encodeURIComponent(slug)}`);
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setIsOpen(true)} className={buttonClassName}>
        <Key />
        <span>{buttonText}</span>
      </Button>

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        size="lg"
        title="Choose a script"
        description="Your key is generated for this script and bound to your network IP."
        footer={
          <div className="flex flex-1 items-center justify-between text-caption text-fg-subtle">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-fg-subtle" />
              IP-bound verification
            </span>
            <span className="font-data">
              {scripts.length} script{scripts.length === 1 ? "" : "s"} active
            </span>
          </div>
        }
      >
        {scripts.length >= 3 && (
          <Input
            data-autofocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by name or slug"
            aria-label="Filter scripts"
            leading={<Search />}
            className="mb-3"
          />
        )}

        {filteredScripts.length > 0 ? (
          <ul className="space-y-1.5">
            {filteredScripts.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => handleSelectScript(s.slug)}
                  className={cn(
                    "group flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-3 text-left transition-colors duration-100 hover:border-line-strong hover:bg-surface-hover",
                    focusRing,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-subtle group-hover:text-fg">
                      <Terminal className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-body-sm font-semibold text-fg">{s.name}</span>
                        <Badge mono>/{s.slug}</Badge>
                        {s.use_auth !== false ? (
                          <Badge tone="accent">
                            <Lock className="size-3" />
                            IP lock
                          </Badge>
                        ) : (
                          <Badge>Direct</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-caption text-fg-subtle">Bound to your IP when claimed.</p>
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-0.5 text-caption font-medium text-fg-muted group-hover:text-fg">
                    Select
                    <ChevronRight className="size-4" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : scripts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface px-4 py-8 text-center">
            <ShieldCheck className="mx-auto mb-2 size-7 text-fg-disabled" />
            <p className="text-body-sm font-medium text-fg">No scripts are available yet</p>
            <p className="mt-1 text-caption text-fg-subtle">Check back soon, or ask in the Discord community.</p>
          </div>
        ) : (
          <p className="py-6 text-center text-body-sm text-fg-subtle">
            No scripts match &ldquo;{search}&rdquo;.
          </p>
        )}
      </Modal>
    </>
  );
}

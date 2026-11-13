"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

const sizes = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
  xl: "max-w-3xl",
} as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: keyof typeof sizes;
  /** Footer actions, right-aligned. Primary action goes last. */
  footer?: React.ReactNode;
  /** Prevent closing via backdrop click / Escape (e.g. while saving). */
  dismissible?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: portal to <body>, Escape + backdrop to close, focus moves
 * in on open and returns to the trigger on close, Tab is trapped, page scroll
 * is locked.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  dismissible = true,
  className,
  children,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descId = React.useId();
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = nodes[0];
        const lastEl = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, dismissible]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        aria-hidden
        className="absolute inset-0 bg-[rgb(3_4_6/0.72)] motion-safe:animate-overlay-in"
        onMouseDown={dismissible ? () => onCloseRef.current() : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[min(88vh,800px)] w-full flex-col rounded-t-xl bg-surface-overlay shadow-modal outline-none sm:rounded-xl",
          "motion-safe:animate-dialog-in",
          sizes[size],
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-title font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-body-sm text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={() => onCloseRef.current()} className="-mr-1.5 -mt-0.5">
              <X />
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-body text-fg">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface/60 px-5 py-3 sm:rounded-b-xl">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

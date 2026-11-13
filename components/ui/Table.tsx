"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn, focusRing } from "@/lib/utils";

/**
 * Dense data grid for moderation work: 32px rows by default, sticky header,
 * hairline row separators, monospace cells for IDs/keys/IPs.
 *
 * <Table>
 *   <TableHeader><TableRow><TableHead>Key</TableHead>...</TableRow></TableHeader>
 *   <TableBody><TableRow><TableCell mono>AP-7F3K...</TableCell>...</TableRow></TableBody>
 * </Table>
 */

export type TableDensity = "compact" | "comfortable";

const DensityContext = React.createContext<TableDensity>("compact");

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  density?: TableDensity;
  /** Classes for the scroll container (set a max-h here for a scrolling body). */
  containerClassName?: string;
  /** Render without the outer border (e.g. when already inside a Card). */
  bare?: boolean;
}

export function Table({ density = "compact", containerClassName, bare = false, className, ...props }: TableProps) {
  return (
    <DensityContext.Provider value={density}>
      <div
        className={cn(
          "relative w-full overflow-auto",
          !bare && "rounded-lg border border-line bg-surface-raised",
          containerClassName,
        )}
      >
        <table className={cn("w-full border-separate border-spacing-0 text-left text-body-sm text-fg", className)} {...props} />
      </div>
    </DensityContext.Provider>
  );
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("sticky top-0 z-10 bg-surface", className)} {...props} />;
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />;
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean;
  /** Adds hover + pointer for rows that open a detail view. */
  interactive?: boolean;
}

export function TableRow({ selected, interactive, className, ...props }: TableRowProps) {
  return (
    <tr
      data-selected={selected || undefined}
      aria-selected={selected || undefined}
      className={cn(
        "group/row transition-colors duration-75",
        "[tbody_&]:hover:bg-surface-hover",
        interactive && "cursor-pointer",
        selected && "bg-accent/[0.07] [tbody_&]:hover:bg-accent/10 [&>td:first-child]:shadow-[inset_2px_0_0_rgb(var(--accent))]",
        className,
      )}
      {...props}
    />
  );
}

type SortDir = "asc" | "desc" | false;

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right" | "center";
  /** Current sort for this column. Pass `onSort` to make it clickable. */
  sort?: SortDir;
  onSort?: () => void;
}

export function TableHead({ align = "left", sort, onSort, className, children, ...props }: TableHeadProps) {
  const alignCls = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const SortIcon = sort === "asc" ? ChevronUp : sort === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined}
      className={cn(
        "h-8 whitespace-nowrap border-b border-line px-3 align-middle text-caption font-medium text-fg-subtle",
        alignCls,
        className,
      )}
      {...props}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-fg",
            sort && "text-fg-muted",
            align === "right" && "flex-row-reverse",
            focusRing,
          )}
        >
          {children}
          <SortIcon aria-hidden className={cn("size-3", !sort && "opacity-50")} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right" | "center";
  /** IDs, keys, IPs, HWIDs: monospace, tabular digits, dotted zero. */
  mono?: boolean;
  /** Secondary information (timestamps, counts). */
  muted?: boolean;
  /** Truncate with an ellipsis at this max width in px (table cells ignore max-width, so content is wrapped). */
  truncate?: number;
}

export function TableCell({ align = "left", mono, muted, truncate, className, children, title, ...props }: TableCellProps) {
  const density = React.useContext(DensityContext);
  return (
    <td
      className={cn(
        "whitespace-nowrap border-b border-line-subtle px-3 align-middle",
        density === "compact" ? "h-8" : "h-10",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        mono && "font-data text-caption",
        muted && "text-fg-muted",
        className,
      )}
      title={title}
      {...props}
    >
      {truncate ? (
        <span
          className="block truncate"
          style={{ maxWidth: truncate }}
          title={title ?? (typeof children === "string" ? children : undefined)}
        >
          {children}
        </span>
      ) : (
        children
      )}
    </td>
  );
}

export interface TableEmptyProps {
  colSpan: number;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

/** Empty state row: say what's missing and what to do about it. */
export function TableEmpty({ colSpan, title, description, action }: TableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center">
        <p className="text-body-sm font-medium text-fg">{title}</p>
        {description ? <p className="mt-1 text-caption text-fg-muted">{description}</p> : null}
        {action ? <div className="mt-3 inline-flex">{action}</div> : null}
      </td>
    </tr>
  );
}

/** Toolbar strip above a table: search, filters, bulk actions, counts. */
export function TableToolbar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center gap-2 pb-2", className)} {...props} />;
}

/**
 * The frame every administration page shares.
 *
 * Five pages, one shape: a sentence saying what the page is for, an action or
 * two on the right, and a list. The pieces live here so the five cannot drift
 * into five layouts, and so the mobile rule — a row becomes a card, it does
 * not become a horizontal scroll — is written once.
 *
 * There is no `<table>` anywhere in this codebase and this does not introduce
 * one. A table would need a horizontal scroll on a phone, and a row a reader
 * has to drag sideways to finish is not a row they will read. Each row is a
 * flex column below `sm` and a grid from `sm`, so the same markup is a card
 * and a table row depending on the width.
 */
import React, { type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

/** One administration page: a lead sentence, optional actions, and content. */
export const AdminPage = ({
  lead,
  actions,
  children,
}: {
  lead: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <div className="p-4 sm:p-6 md:p-10 max-w-5xl mx-auto space-y-6 pb-28 md:pb-10">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <p className="text-sm text-on-surface-variant text-pretty max-w-prose">
        {lead}
      </p>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
    {children}
  </div>
);

/**
 * A framed list.
 *
 * The frame is a surface shift, not a border — `.agent/STYLE.md` calls a line
 * a failure of hierarchy, and the existing archived-contacts list is the
 * pattern this follows. The column header is `hidden sm:grid`: on a phone
 * each row carries its own labels and a header strip would describe columns
 * that are not there.
 */
export const AdminList = ({
  header,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  empty,
  children,
  footer,
}: {
  /** Column labels. Rendered only from `sm`, in the row's own grid. */
  header?: ReactNode;
  isLoading?: boolean;
  /** The read failed. Never rendered as an empty list. */
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  empty: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) => (
  // No `overflow-hidden`. It rounded the corners for free and clipped the row
  // menu: an absolutely positioned dropdown is clipped by an ancestor's
  // overflow no matter its z-index, so on the last row of a list every item
  // was painted outside the box and could not be clicked. The corners are
  // rounded on the first and last child instead.
  <div
    className={cn(
      "bg-surface-container-lowest rounded-2xl shadow-sm",
      "[&>*:first-child]:rounded-t-2xl [&>*:last-child]:rounded-b-2xl",
    )}
  >
    {header && (
      <div
        className={cn(
          SECTION_HEADING,
          "hidden sm:block px-4 sm:px-6 py-3 bg-surface-container-low",
        )}
      >
        {header}
      </div>
    )}
    {isLoading ? (
      <p className="flex items-center gap-2 px-4 sm:px-6 py-8 text-sm text-on-surface-variant">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </p>
    ) : isError ? (
      // "We could not load this" and "there is nothing here" must never share
      // a rendering. A failed read leaves `isLoading` false and `data`
      // undefined, so without this branch a 500 or a dropped connection
      // reported an empty instance in reassuring copy.
      <div className="px-4 sm:px-6 py-8 space-y-3">
        <p className="flex items-start gap-2 text-sm text-on-surface text-pretty">
          <TriangleAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          This did not load. It is not empty, and nothing here has changed.
        </p>
        {onRetry && (
          <AdminButton tone="secondary" onClick={onRetry}>
            Try again
          </AdminButton>
        )}
      </div>
    ) : isEmpty ? (
      <div className="px-4 sm:px-6 py-8 text-sm text-on-surface-variant text-pretty">
        {empty}
      </div>
    ) : (
      <div>{children}</div>
    )}
    {footer && (
      <div className="px-4 sm:px-6 py-3 bg-surface-container-low">{footer}</div>
    )}
  </div>
);

/**
 * One row.
 *
 * `grid-cols` comes from the caller, and applies only from `sm`. Below that
 * the row stacks, which is what turns it into a card without a second set of
 * markup to keep in step.
 *
 * The alternating background is `even:` rather than a divider, again because
 * of the no-line rule.
 */
export const AdminRow = ({
  columns,
  children,
  className,
}: {
  /** A Tailwind `sm:grid-cols-[…]` template. */
  columns: string;
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-col gap-2 px-4 sm:px-6 py-4",
      "sm:grid sm:items-center sm:gap-4",
      "even:bg-surface-container-low/40 hover:bg-surface-container-low transition-colors",
      columns,
      className,
    )}
  >
    {children}
  </div>
);

/**
 * One cell, with the label a phone needs and a desktop does not.
 *
 * On a phone the column header is gone, so a bare date in a stacked card says
 * nothing. The label is `sm:hidden` and the header strip is `hidden sm:block`:
 * exactly one of the two is on screen at any width.
 */
export const AdminCell = ({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("min-w-0 flex items-baseline gap-2 sm:block", className)}>
    {label && (
      <span
        className={cn(
          SECTION_HEADING,
          "sm:hidden shrink-0 text-[10px] w-24 text-right",
        )}
      >
        {label}
      </span>
    )}
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

/** The page's primary action. Sized for a thumb on a phone. */
export const AdminButton = ({
  tone = "primary",
  busy,
  icon,
  children,
  ...rest
}: {
  tone?: "primary" | "secondary" | "danger";
  busy?: boolean;
  icon?: ReactNode;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const tones = {
    primary: "bg-primary text-on-primary hover:opacity-90",
    secondary:
      "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
    danger: "bg-red-500/10 text-error hover:bg-red-500/20",
  } as const;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl",
        "px-4 min-h-[44px] sm:min-h-0 sm:py-2.5 font-bold text-sm transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        tones[tone],
        rest.className,
      )}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
};

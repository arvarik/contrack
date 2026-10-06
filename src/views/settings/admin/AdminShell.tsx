/**
 * The frame every administration page shares: the page's actions in the
 * settings header, then a list. There is no `<table>`, because a table needs
 * a horizontal scroll on a phone. A row is a flex column below `sm` and a
 * grid from `sm`, so the same markup is a card or a table row.
 */
import React, { type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import type { UserRole } from "../../../api/admin";
import { ChoiceGroup, type Choice } from "../../../components/ui/ChoiceGroup";
import { EmptyState } from "../../../components/ui/EmptyState";
import { CARD, SECTION_HEADING } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { SETTINGS_LABEL, SETTINGS_PAGE } from "../layout";
import { SettingsHeaderActions } from "../SettingsHeader";
import { LoadFailed } from "../../../components/ui/LoadFailed";

/** One administration page. Its `actions` render in the settings header. */
export const AdminPage = ({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <div className={cn(SETTINGS_PAGE, "space-y-6")}>
    {actions && <SettingsHeaderActions>{actions}</SettingsHeaderActions>}
    {children}
  </div>
);

/** What an empty list says: its icon, a title, and a sentence if one helps. */
interface AdminEmpty {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
}

/**
 * A framed list. The frame is a surface shift, not a border (`.agent/STYLE.md`
 * has no lines). The column header shows only from `sm`, because on a phone
 * each row carries its own labels.
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
  empty: AdminEmpty;
  children: ReactNode;
  footer?: ReactNode;
}) => (
  // No `overflow-hidden`: an ancestor's overflow clips the absolutely
  // positioned row menu at any z-index, and the last row's menu could not be
  // clicked. The first and last child round the corners instead.
  <div
    className={cn(
      CARD,
      "p-0 [&>*:first-child]:rounded-t-2xl [&>*:last-child]:rounded-b-2xl",
    )}
  >
    {/* No column names over a loading, error or empty message. */}
    {header && !isLoading && !isError && !isEmpty && (
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
      // A failed read leaves `isLoading` false and `data` undefined. Without
      // this branch, a 500 renders as an empty list.
      <LoadFailed
        what="this page"
        body="It is not empty, and nothing here has changed"
        onRetry={onRetry}
      />
    ) : isEmpty ? (
      <EmptyState icon={empty.icon} title={empty.title} body={empty.body} />
    ) : (
      <div>{children}</div>
    )}
    {footer && (
      <div className="px-4 sm:px-6 py-3 bg-surface-container-low">{footer}</div>
    )}
  </div>
);

/**
 * One row. `columns` applies from `sm`, and below that the row stacks into a
 * card. Rows alternate with `even:` instead of a divider. The row has no
 * hover, because only its buttons and menus are controls.
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
      "even:bg-surface-container-low/40",
      columns,
      className,
    )}
  >
    {children}
  </div>
);

/**
 * One cell. Its label shows only below `sm`, where the column header is
 * hidden, so exactly one of the two is on screen at any width.
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
        className={cn(SECTION_HEADING, "sm:hidden shrink-0 w-24 text-right")}
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
    primary: "btn-primary",
    secondary: "btn-secondary",
    // A destructive act that is not final: the row's button opens a
    // confirmation, and the confirmation's button is the red one.
    danger: "btn-secondary text-error",
  } as const;
  return (
    <button type="button" {...rest} className={cn(tones[tone], rest.className)}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
};

const ROLES: readonly Choice<UserRole>[] = [
  {
    value: "member",
    label: "Member",
    hint: "Their own contacts, and nothing else",
  },
  {
    value: "admin",
    label: "Admin",
    hint: "Also manages accounts and every page under Administration",
  },
];

/**
 * The role a new account or an invitation gives, with what each role may
 * do. One picker, so the two dialogs say the same thing about a role.
 */
export const RolePicker = ({
  value,
  onChange,
}: {
  value: UserRole;
  onChange: (next: UserRole) => void;
}) => (
  <div className="space-y-1.5">
    <span className={SETTINGS_LABEL}>Role</span>
    <ChoiceGroup
      label="Role"
      value={value}
      options={ROLES}
      onChange={onChange}
    />
  </div>
);

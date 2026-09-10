/**
 * AuditView — what has been done on this instance, newest first.
 *
 * The log answers one question: who did that, and when. It is read when
 * something has gone wrong or somebody has asked, which is why it pages
 * rather than truncating and why the filter narrows on the server rather than
 * on the page — an audit log that quietly stops at fifty rows is worse than
 * one that says it has more.
 *
 * `details` never carries a password, a token, an invitation secret or a
 * provider key. `auditService` redacts anything credential-shaped beside the
 * insert rather than trusting each call site, so what arrives here is already
 * safe to show. It is still rendered as plain text and never as markup.
 */
import { useState } from "react";
import {
  Archive,
  Ban,
  Check,
  KeyRound,
  LogIn,
  LogOut,
  MailPlus,
  ScrollText,
  Settings2,
  ShieldAlert,
  Terminal,
  Trash2,
  UserPlus,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import { AUDIT_GROUPS, useAuditLog, type AuditEntry } from "../../../api/admin";
import { Badge, type BadgeTone } from "../../../components/ui/Badge";
import { formatRelative, formatWhen } from "../../../lib/datetime";
import { cn } from "../../../lib/utils";
import { AdminButton, AdminList, AdminPage } from "./AdminShell";

/**
 * What each action looks like at a glance.
 *
 * The tone is about consequence, not about success. `auth.login.failed` is
 * amber because a run of them is the thing worth spotting; `user.deleted` is
 * red because it cannot be undone.
 */
const LOOK: Record<
  string,
  { icon: LucideIcon; tone: BadgeTone; label: string }
> = {
  "auth.login.success": { icon: LogIn, tone: "neutral", label: "Signed in" },
  "auth.login.failed": {
    icon: ShieldAlert,
    tone: "warning",
    label: "Sign-in failed",
  },
  "auth.logout": { icon: LogOut, tone: "neutral", label: "Signed out" },
  "auth.password.changed": {
    icon: KeyRound,
    tone: "primary",
    label: "Password changed",
  },
  "auth.token.created": {
    icon: Terminal,
    tone: "primary",
    label: "Token created",
  },
  "auth.token.revoked": {
    icon: Terminal,
    tone: "neutral",
    label: "Token revoked",
  },
  "user.created": { icon: UserPlus, tone: "success", label: "Account created" },
  "user.invited": { icon: MailPlus, tone: "primary", label: "Invited" },
  "user.invitation.accepted": {
    icon: Check,
    tone: "success",
    label: "Invitation accepted",
  },
  "user.invitation.revoked": {
    icon: Ban,
    tone: "neutral",
    label: "Invitation revoked",
  },
  "user.role.changed": {
    icon: Settings2,
    tone: "warning",
    label: "Role changed",
  },
  "user.disabled": { icon: Ban, tone: "danger", label: "Account disabled" },
  "user.enabled": {
    icon: UserRoundCheck,
    tone: "success",
    label: "Account enabled",
  },
  "user.password.reset": {
    icon: KeyRound,
    tone: "warning",
    label: "Password reset",
  },
  "user.deleted": { icon: Trash2, tone: "danger", label: "Account deleted" },
  "user.exported": {
    icon: Archive,
    tone: "warning",
    label: "Data exported",
  },
  "settings.changed": {
    icon: Settings2,
    tone: "primary",
    label: "Setting changed",
  },
  "backup.created": { icon: Archive, tone: "neutral", label: "Snapshot" },
};

const FALLBACK = { icon: ScrollText, tone: "neutral" as BadgeTone, label: "" };

/**
 * The `details` object, in one readable line.
 *
 * Rendered from the object rather than from a stored sentence, so a row
 * written by a version that recorded a different set of keys still shows what
 * it has instead of nothing.
 */
function describeDetails(details: Record<string, unknown> | null): string {
  if (!details) return "";
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

const EntryRow = ({ entry }: { entry: AuditEntry }) => {
  const look = LOOK[entry.action] ?? FALLBACK;
  const Icon = look.icon;
  // `details` is deliberately null for a settings change: the service records
  // the key that changed and never the value, and the key is in `targetId`.
  // Reading only `details` therefore rendered every settings row as the
  // identical line "Setting changed by ada", whatever it was that changed.
  const detail =
    describeDetails(entry.details) ||
    (entry.targetId
      ? `${entry.targetType ?? "target"}: ${entry.targetId}`
      : "");

  return (
    <div className="flex items-start gap-3 px-4 sm:px-6 py-3.5 even:bg-surface-container-low/40 hover:bg-surface-container-low transition-colors">
      <span
        className={cn(
          "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
          look.tone === "danger"
            ? "bg-red-500/10 text-error"
            : look.tone === "warning"
              ? "bg-amber-500/10 text-warning"
              : look.tone === "success"
                ? "bg-emerald-500/10 text-success"
                : look.tone === "primary"
                  ? "bg-primary/10 text-primary"
                  : "bg-surface-container-high text-on-surface-variant",
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>

      <div className="flex-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-on-surface">
            {look.label || entry.action}
          </span>
          {/*
            A row whose actor is null is one whose account has since been
            deleted: `audit_log.actorUserId` is ON DELETE SET NULL, so the row
            survives the account and says as much.
          */}
          <span className="text-xs text-on-surface-variant">
            by {entry.actor ? entry.actor.username : "a deleted account"}
          </span>
          {!look.label && <Badge>{entry.action}</Badge>}
        </p>
        {detail && (
          <p className="text-xs text-on-surface-variant break-words mt-0.5">
            {detail}
          </p>
        )}
        {entry.ip && (
          // Not `/80`. The variant colour at 80 percent measures 4.01:1 on
          // white and 3.87:1 on the zebra row, both under AA.
          <p className="text-xs text-on-surface-variant font-mono mt-0.5">
            {entry.ip}
          </p>
        )}
      </div>

      <time
        dateTime={entry.createdAt}
        title={formatWhen(entry.createdAt)}
        className="shrink-0 text-xs text-on-surface-variant tabular-nums"
      >
        {formatRelative(entry.createdAt, "Unknown")}
      </time>
    </div>
  );
};

export const AuditView = () => {
  const [group, setGroup] = useState<string | null>(null);
  const actions = group
    ? (AUDIT_GROUPS.find((g) => g.key === group)?.actions ?? null)
    : null;
  const query = useAuditLog(actions);

  const entries = query.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <AdminPage lead="Every administrative action, and every sign-in, newest first. Passwords, tokens and invitation secrets are never recorded.">
      <div
        role="group"
        aria-label="Filter by what happened"
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={group === null}
          onClick={() => setGroup(null)}
          className={cn(
            "px-4 min-h-[44px] sm:min-h-0 sm:py-2 rounded-full text-xs font-bold transition-colors",
            group === null
              ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
              : "text-on-surface-variant hover:bg-surface-container-high",
          )}
        >
          Everything
        </button>
        {AUDIT_GROUPS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={group === option.key}
            onClick={() => setGroup(option.key)}
            className={cn(
              "px-4 min-h-[44px] sm:min-h-0 sm:py-2 rounded-full text-xs font-bold transition-colors",
              group === option.key
                ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
                : "text-on-surface-variant hover:bg-surface-container-high",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <AdminList
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        isEmpty={!query.isLoading && !query.isError && entries.length === 0}
        empty={
          group
            ? "Nothing of this kind has happened yet."
            : "Nothing has been recorded yet."
        }
        footer={
          query.hasNextPage ? (
            <AdminButton
              tone="secondary"
              busy={query.isFetchingNextPage}
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="w-full"
            >
              Load more
            </AdminButton>
          ) : entries.length > 0 ? (
            <p className="text-xs text-on-surface-variant">
              That is the whole log. Entries older than ninety days are removed
              by the daily sweep.
            </p>
          ) : undefined
        }
      >
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </AdminList>
    </AdminPage>
  );
};

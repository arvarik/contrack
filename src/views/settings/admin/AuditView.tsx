/**
 * The instance's audit log, newest first: who did what, and when. It pages
 * and filters on the server, so it never quietly stops at one page.
 * `auditService` redacts credentials from `details` before the insert, and
 * this page still renders `details` as plain text, never as markup.
 */
import { useState } from "react";
import {
  Archive,
  Ban,
  Cable,
  Check,
  Fingerprint,
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
import { SELECTED_TINT, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { AdminButton, AdminList, AdminPage } from "./AdminShell";

/** One filter: the selected tint when it is on, the hover layer when not. */
const filterClass = (active: boolean) =>
  cn(
    "px-4 min-h-[44px] sm:pointer-fine:min-h-0 sm:py-2 rounded-lg text-xs font-bold transition-colors",
    active
      ? SELECTED_TINT
      : "state-layer text-on-surface-variant hover:text-on-surface",
  );

/**
 * Each action's icon, tone and label. The tone shows consequence, not
 * success: a run of failed sign-ins is worth spotting, so it is amber, and a
 * deleted user is red because it cannot be undone.
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
  "auth.password.reset": {
    icon: KeyRound,
    tone: "primary",
    label: "Password reset",
  },
  "auth.magic_link.used": {
    icon: LogIn,
    tone: "neutral",
    label: "Signed in with link",
  },
  "auth.passkey.added": {
    icon: Fingerprint,
    tone: "primary",
    label: "Passkey added",
  },
  "auth.passkey.renamed": {
    icon: Fingerprint,
    tone: "neutral",
    label: "Passkey renamed",
  },
  "auth.passkey.removed": {
    icon: Fingerprint,
    tone: "neutral",
    label: "Passkey removed",
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
  "auth.oauth.granted": {
    icon: Terminal,
    tone: "primary",
    label: "App connected",
  },
  "auth.oauth.denied": {
    icon: Terminal,
    tone: "neutral",
    label: "App refused",
  },
  "auth.oauth.refresh_reused": {
    icon: ShieldAlert,
    tone: "warning",
    label: "App sign-in reused, app disconnected",
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
  "mail.settings.changed": {
    icon: Settings2,
    tone: "primary",
    label: "Mail setting changed",
  },
  "mail.test.sent": {
    icon: MailPlus,
    tone: "neutral",
    label: "Test email sent",
  },
  "integrations.changed": {
    icon: Settings2,
    tone: "primary",
    label: "Integration changed",
  },
  "backup.created": { icon: Archive, tone: "neutral", label: "Snapshot" },
  "backup.downloaded": {
    icon: Archive,
    tone: "warning",
    label: "Snapshot downloaded",
  },
  "connector.created": {
    icon: Cable,
    tone: "primary",
    label: "Connector added",
  },
  "connector.updated": {
    icon: Cable,
    tone: "neutral",
    label: "Connector changed",
  },
  "connector.deleted": {
    icon: Cable,
    tone: "neutral",
    label: "Connector removed",
  },
  "connector.reauth": {
    icon: Cable,
    tone: "warning",
    label: "Connector needs signing in again",
  },
  "connector.run.failed": {
    icon: Cable,
    tone: "warning",
    label: "Connector sync failed",
  },
};

/**
 * Who did it. A failed sign-in has no actor on purpose: nobody proved who
 * they are, and the row says whether the name typed matched an account.
 * Any other row with no actor outlived its account (`actorUserId` is
 * `ON DELETE SET NULL`).
 */
function actorLine(entry: AuditEntry): string {
  if (entry.actor) return `by ${entry.actor.username}`;
  if (entry.action === "auth.login.failed") {
    return entry.details?.matched
      ? "for an existing account"
      : "for a name with no account";
  }
  return "by a deleted account";
}

const FALLBACK = { icon: ScrollText, tone: "neutral" as BadgeTone, label: "" };

/**
 * The `details` object as one line. It is built from the keys, not from a
 * stored sentence, so a row with an older set of keys still shows what it has.
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
  // A settings change has null `details`, because the service never records
  // the value. The changed key is in `targetId`, so the row falls back to it.
  // A failed sign-in says all it has in `actorLine`.
  const detail =
    entry.action === "auth.login.failed"
      ? ""
      : describeDetails(entry.details) ||
        (entry.targetId
          ? `${entry.targetType ?? "target"}: ${entry.targetId}`
          : "");

  return (
    <div className="flex items-start gap-3 px-4 sm:px-6 py-3.5 even:bg-surface-container-low/40">
      <span
        className={cn(
          "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center",
          TONE_WASH[look.tone === "danger" ? "error" : look.tone],
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>

      <div className="flex-1 min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-bold text-on-surface">
            {look.label || entry.action}
          </span>
          <span className="text-xs text-on-surface-variant">
            {actorLine(entry)}
          </span>
          {!look.label && <Badge>{entry.action}</Badge>}
        </p>
        {detail && (
          <p className="text-xs text-on-surface-variant break-words mt-0.5">
            {detail}
          </p>
        )}
        {entry.ip && (
          // Not `/80`. The variant color at 80 percent measures 4.01:1 on
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
    <AdminPage>
      <div
        role="group"
        aria-label="Filter by what happened"
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={group === null}
          onClick={() => setGroup(null)}
          className={filterClass(group === null)}
        >
          Everything
        </button>
        {AUDIT_GROUPS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={group === option.key}
            onClick={() => setGroup(option.key)}
            className={filterClass(group === option.key)}
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
        empty={{
          icon: ScrollText,
          title: group ? "Nothing of this kind yet" : "Nothing recorded yet",
        }}
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
              That is the whole log
            </p>
          ) : undefined
        }
      >
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </AdminList>

      <p className="text-xs text-on-surface-variant px-1 text-pretty">
        Passwords, tokens and invitation secrets are never written here.
        Contrack deletes an entry after 90 days
      </p>
    </AdminPage>
  );
};

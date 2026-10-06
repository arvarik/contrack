// Who did what to the instance, and when. Every administrative action writes
// one row: creating an account, changing a role, disabling, resetting a
// password, deleting, inviting, exporting somebody else's data, changing an
// instance setting, taking a backup, and the sign-in events that make those
// attributable. Two rules:
//
//   1. A failed write never fails the action. The insert logs and returns on
//      error: losing an audit row is bad, refusing to disable a compromised
//      account because the table is locked is worse.
//   2. `details` never carries a secret. Callers change, so the guard is here:
//      a key that reads like a credential, or a value that looks like a
//      personal token, becomes "[redacted]" before the row is written, and the
//      redaction is logged so the call site is visible.
//
// Rows are kept 90 days, swept by the daily maintenance job.

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

/**
 * Every action that writes a row, as a value, so the audit endpoint's filter
 * can refuse an action nobody writes. A `LIKE` on a user-supplied string
 * would answer a typo with an empty page, which reads as "nothing happened".
 */
export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failed",
  "auth.logout",
  "auth.password.changed",
  "auth.token.created",
  "auth.token.revoked",
  "auth.oauth.granted",
  "auth.oauth.denied",
  "auth.oauth.refresh_reused",
  "auth.password.reset",
  "auth.magic_link.used",
  "auth.passkey.added",
  "auth.passkey.renamed",
  "auth.passkey.removed",
  "user.created",
  "user.invited",
  "user.invitation.accepted",
  "user.invitation.revoked",
  "user.role.changed",
  "user.disabled",
  "user.enabled",
  "user.password.reset",
  "user.deleted",
  "user.exported",
  "settings.changed",
  "backup.created",
  "backup.downloaded",
  "mail.settings.changed",
  "mail.test.sent",
  "integrations.changed",
  "connector.created",
  "connector.updated",
  "connector.deleted",
  "connector.reauth",
  "connector.run.failed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTargetType =
  | "user"
  | "token"
  | "invitation"
  | "setting"
  | "backup"
  | "passkey"
  | "mail"
  | "integration"
  | "connector";

export interface AuditEntry {
  id: string;
  actor: { id: string; username: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

interface RecordInput {
  /** The account that acted, or null for an unauthenticated attempt. */
  actorUserId: string | null;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string | null;
  /** Structured context. Redacted before it is stored. See the note above. */
  details?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Key names that must never reach the audit table. `link` is here because an
 * invitation link carries its secret in the query string, and it is exactly
 * what a well-meaning call site would record.
 */
const SECRET_KEY = /pass|token|secret|api_?key|credential|hash|link|cookie/i;

/** The shape of a personal API token, wherever it appears in a value. */
const TOKEN_VALUE = /\bctk_[A-Za-z0-9_-]{8,}/;

const REDACTED = "[redacted]";

/**
 * Copy `details` without anything credential-shaped. One level deep: audit
 * details are flat by convention, and a recursive walk over an arbitrary object
 * could hang on a cycle.
 */
function redact(
  details: Record<string, unknown>,
  action: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let redactedAny = false;

  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) {
      out[key] = REDACTED;
      redactedAny = true;
      continue;
    }
    if (typeof value === "string" && TOKEN_VALUE.test(value)) {
      out[key] = REDACTED;
      redactedAny = true;
      continue;
    }
    out[key] = value;
  }

  if (redactedAny) {
    log.warn(
      "Audit",
      `Redacted a credential-shaped field from the details of "${action}". Fix the call site — the audit log is not the place for it.`,
    );
  }
  return out;
}

export const auditService = {
  /**
   * Write one audit row. Never throws: a caller that cannot record an action
   * still completes it.
   */
  record(input: RecordInput): void {
    try {
      const details = input.details
        ? redact(input.details, input.action)
        : null;
      sqlite
        .prepare(
          `INSERT INTO audit_log (id, actorUserId, action, targetType, targetId, details, ip)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          input.actorUserId,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          details ? JSON.stringify(details) : null,
          input.ip ?? null,
        );
    } catch (err) {
      log.warn(
        "Audit",
        `Failed to record "${input.action}": ${getErrorMessage(err)}`,
      );
    }
  },

  /**
   * The newest entries first, with an opaque cursor for the next page. The
   * cursor is `<createdAt>|<id>`, because `createdAt` defaults to
   * `CURRENT_TIMESTAMP` with one-second resolution: a purge writes several rows
   * in one second, and `createdAt < before` would skip the rows that share a
   * second with the last row of the previous page. `actions` filters in SQL,
   * because filtering a fetched page would hide the matches on later pages.
   */
  list(params: { limit: number; before?: string; actions?: string[] }): {
    entries: AuditEntry[];
    nextBefore: string | null;
  } {
    const limit = Math.min(200, Math.max(1, params.limit));
    const cursor = parseCursor(params.before);
    // Validated against the vocabulary by the route, so this only has to
    // build the placeholders. An empty array means no filter, not "match
    // nothing" — the route never sends one.
    const actions = params.actions?.length ? params.actions : null;

    const where: string[] = [];
    const values: unknown[] = [];
    if (cursor) {
      where.push("(a.createdAt < ? OR (a.createdAt = ? AND a.id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    if (actions) {
      where.push(`a.action IN (${actions.map(() => "?").join(", ")})`);
      values.push(...actions);
    }

    const rows = sqlite
      .prepare(
        // tenant-lint: allow admin cross-user
        `SELECT a.id, a.actorUserId, a.action, a.targetType, a.targetId,
                a.details, a.ip, a.createdAt, u.username AS actorUsername
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actorUserId
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY a.createdAt DESC, a.id DESC
          LIMIT ?`,
      )
      .all(...values, limit + 1) as {
      id: string;
      actorUserId: string | null;
      action: string;
      targetType: string | null;
      targetId: string | null;
      details: string | null;
      ip: string | null;
      createdAt: string;
      actorUsername: string | null;
    }[];

    // One row more than the page was asked for, so "is there another page" is
    // answered without a second COUNT over the whole table.
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      entries: page.map((row) => ({
        id: row.id,
        actor:
          row.actorUserId && row.actorUsername
            ? { id: row.actorUserId, username: row.actorUsername }
            : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details: parseDetails(row.details),
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      nextBefore: hasMore && last ? `${last.createdAt}|${last.id}` : null,
    };
  },
};

function parseCursor(
  before: string | undefined,
): { createdAt: string; id: string } | null {
  if (!before) return null;
  const split = before.lastIndexOf("|");
  if (split <= 0) return null;
  return {
    createdAt: before.slice(0, split),
    id: before.slice(split + 1),
  };
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A row written by an older build, or edited by hand. The rest of the
    // entry is still worth showing.
    return null;
  }
}

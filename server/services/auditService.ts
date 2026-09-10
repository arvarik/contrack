// =============================================================================
// Audit Service — who did what to the instance, and when
// =============================================================================
// Every administrative action writes one row here: creating an account,
// changing a role, disabling, resetting a password, deleting, inviting,
// exporting somebody else's data, changing an instance setting, taking a
// backup, and the sign-in events that make those attributable.
//
// Two rules shape the design.
//
//   1. A failed write must never fail the action. The insert sits inside a
//      try/catch that logs and returns. Losing an audit row is bad; refusing
//      to disable a compromised account because the audit table is locked is
//      worse.
//
//   2. `details` never carries a secret. The caller decides what to record,
//      and callers change, so the guard is here rather than at each call
//      site: a key whose name reads like a credential, or a value that looks
//      like a personal token, is replaced with "[redacted]" before the row is
//      written. The redaction is logged so a call site that trips it is
//      visible rather than silent.
//
// Retention is 90 days, swept by the daily maintenance interval in server.ts.
// =============================================================================

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

/** Every action name this app writes. Kept as a union so a typo fails to build. */
export type AuditAction =
  | "auth.login.success"
  | "auth.login.failed"
  | "auth.logout"
  | "auth.password.changed"
  | "auth.token.created"
  | "auth.token.revoked"
  | "user.created"
  | "user.invited"
  | "user.invitation.accepted"
  | "user.invitation.revoked"
  | "user.role.changed"
  | "user.disabled"
  | "user.enabled"
  | "user.password.reset"
  | "user.deleted"
  | "user.exported"
  | "settings.changed"
  | "backup.created";

export type AuditTargetType =
  "user" | "token" | "invitation" | "setting" | "backup";

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
 * Key names that must never reach the audit table.
 *
 * `link` is here because an invitation link carries the invitation secret in
 * its query string, and the link is exactly the field a well-meaning call site
 * would want to record.
 */
const SECRET_KEY = /pass|token|secret|api_?key|credential|hash|link|cookie/i;

/** The shape of a personal API token, wherever it appears in a value. */
const TOKEN_VALUE = /\bctk_[A-Za-z0-9_-]{8,}/;

const REDACTED = "[redacted]";

/**
 * Copy `details` with anything credential-shaped removed.
 *
 * One level deep only. Audit details are flat by convention, and a recursive
 * walk over an arbitrary object is a place for a cycle to hang the request
 * that is trying to record it.
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
   * Write one audit row.
   *
   * Never throws. A caller that cannot record an action still completes it.
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
   * The newest entries first, with an opaque cursor for the next page.
   *
   * The cursor is `<createdAt>|<id>` rather than a bare timestamp because
   * `createdAt` defaults to `CURRENT_TIMESTAMP`, which has one-second
   * resolution. A purge writes several rows inside one second, and a cursor
   * of `createdAt < before` would skip every row that shares a second with
   * the last row of the previous page.
   */
  list(params: { limit: number; before?: string }): {
    entries: AuditEntry[];
    nextBefore: string | null;
  } {
    const limit = Math.min(200, Math.max(1, params.limit));
    const cursor = parseCursor(params.before);

    const rows = (
      cursor
        ? sqlite.prepare(
            `SELECT a.id, a.actorUserId, a.action, a.targetType, a.targetId,
                    a.details, a.ip, a.createdAt, u.username AS actorUsername
               FROM audit_log a
               LEFT JOIN users u ON u.id = a.actorUserId
              WHERE a.createdAt < ? OR (a.createdAt = ? AND a.id < ?)
              ORDER BY a.createdAt DESC, a.id DESC
              LIMIT ?`,
          )
        : sqlite.prepare(
            `SELECT a.id, a.actorUserId, a.action, a.targetType, a.targetId,
                    a.details, a.ip, a.createdAt, u.username AS actorUsername
               FROM audit_log a
               LEFT JOIN users u ON u.id = a.actorUserId
              ORDER BY a.createdAt DESC, a.id DESC
              LIMIT ?`,
          )
    ).all(
      ...(cursor
        ? [cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
        : [limit + 1]),
    ) as {
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

/** The client address to record, or null when Express cannot name one. */
export function auditIp(req: { ip?: string }): string | null {
  return req.ip ?? null;
}

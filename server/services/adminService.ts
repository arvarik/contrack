// The operator's view of the accounts on this instance: create accounts, change
// roles, reset passwords, disable and delete people. Every function here writes
// an audit row. Three rules hold across the file.
//
// - An admin never reads another account's rows. `exportUserData` is the one
//   exception, for offboarding, and its audit row names the account it read.
//   The account list shows contact counts, which are numbers, not rows.
// - Three guards stand between an admin and an instance nobody can administer,
//   in this order: the local owner is protected while auth is off, the last
//   active admin cannot be removed, and no admin may aim at their own account.
//   On an unsecured instance all three are true at once, and only the first
//   names a fix.
// - Deleting an account takes two steps. The first answers `409 USER_HAS_DATA`
//   with what the account owns. Only a request with `decision: "purge"` removes
//   anything.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { AppError, NotFoundError, ValidationError } from "../utils/AppError.ts";
import { ownerUploadDir } from "../utils/paths.ts";
import { isAuthRequired } from "../middleware/auth.ts";
import { scopeForOwnerId } from "../tenancy/scope.ts";
import { buildFullExport, type FullExport } from "./exportService.ts";
import { auditService } from "./auditService.ts";
import {
  createUser as createAccount,
  revokeOtherSessions,
  type User,
} from "./authService.ts";
import { hashPassword } from "./passwords.ts";
import { purgeOwnerFromIndexQueue } from "./search/indexQueue.ts";

/** Who is acting, and from where. Every function takes this first. */
export interface AdminContext {
  actor: User;
  ip: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  credentialState: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  /** Contacts the account can see today. Trashed rows are not counted. */
  contactCount: number;
  sessionCount: number;
  tokenCount: number;
  /** The account nobody can sign in to, which owns this device's data. */
  isLocalOwner: boolean;
  isSelf: boolean;
  avatarUrl: string | null;
}

/**
 * What an account owns, as the delete confirmation reports it. `contacts`
 * counts every row, trashed ones included, because every row goes. That is not
 * `AdminUserSummary.contactCount`, which leaves the trash out.
 */
export interface OwnedCounts {
  contacts: number;
  interactions: number;
  lists: number;
  files: number;
}

// Reading

const USER_LIST_SQL = `SELECT id, email, username, displayName, role, status,
                              credentialState, mustChangePassword, createdAt,
                              lastLoginAt, passwordChangedAt, avatarUrl
                         FROM users`;

interface UserListRow {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  credentialState: string;
  mustChangePassword: number;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  avatarUrl: string | null;
}

/**
 * Every account, oldest first, with the three numbers the list shows. The
 * counts come from three grouped queries, so the cost does not grow per row.
 */
export function listUsers(ctx: AdminContext): AdminUserSummary[] {
  const rows = sqlite
    .prepare(`${USER_LIST_SQL} ORDER BY createdAt ASC`)
    .all() as UserListRow[];

  const contacts = countByOwner(
    // Every account's count in one grouped read. tenant-lint cannot tell a
    // statement that names ownerId without filtering on it from a scoped read.
    // tenant-lint: allow admin cross-user
    `SELECT ownerId AS k, COUNT(*) AS n FROM contacts
      WHERE deletedAt IS NULL GROUP BY ownerId`,
  );
  const sessions = countByOwner(
    // `datetime(expiresAt)`: `createSession` writes an ISO string and
    // `datetime('now')` a space-separated one, and a `T` sorts after a space,
    // so a session that expired earlier today would count as live.
    `SELECT userId AS k, COUNT(*) AS n FROM sessions
      WHERE datetime(expiresAt) > datetime('now') GROUP BY userId`,
  );
  const tokens = countByOwner(
    `SELECT userId AS k, COUNT(*) AS n FROM api_tokens
      WHERE revokedAt IS NULL GROUP BY userId`,
  );

  return rows.map((row) => ({
    ...toSummary(row, ctx.actor.id),
    contactCount: contacts.get(row.id) ?? 0,
    sessionCount: sessions.get(row.id) ?? 0,
    tokenCount: tokens.get(row.id) ?? 0,
  }));
}

export function getUser(
  ctx: AdminContext,
  id: string,
): { user: AdminUserSummary; counts: OwnedCounts } {
  return { user: summaryOf(id, ctx), counts: ownedCounts(id) };
}

function toSummary(
  row: UserListRow,
  selfId: string,
): Omit<AdminUserSummary, "contactCount" | "sessionCount" | "tokenCount"> {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    credentialState: row.credentialState,
    mustChangePassword: row.mustChangePassword === 1,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    passwordChangedAt: row.passwordChangedAt,
    isLocalOwner: row.credentialState === "none",
    isSelf: row.id === selfId,
    avatarUrl: row.avatarUrl ?? null,
  };
}

function countByOwner(sql: string): Map<string, number> {
  const rows = sqlite.prepare(sql).all() as { k: string | null; n: number }[];
  const out = new Map<string, number>();
  for (const row of rows) if (row.k) out.set(row.k, row.n);
  return out;
}

function scalar(sql: string, ...params: unknown[]): number {
  return (sqlite.prepare(sql).get(...params) as { n: number }).n;
}

/** Everything a purge would remove, in the four numbers the admin sees. */
export function ownedCounts(ownerId: string): OwnedCounts {
  return {
    contacts: scalar(
      `SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ?`,
      ownerId,
    ),
    interactions: scalar(
      `SELECT COUNT(*) AS n FROM interactions WHERE ownerId = ?`,
      ownerId,
    ),
    lists: scalar(`SELECT COUNT(*) AS n FROM lists WHERE ownerId = ?`, ownerId),
    // An upload is a file on disk a row points at: a note attachment, or an
    // avatar this instance stores. An avatar URL on another server is not ours.
    files:
      scalar(
        `SELECT COUNT(*) AS n FROM interactions
          WHERE ownerId = ? AND fileUrl IS NOT NULL AND fileUrl != ''`,
        ownerId,
      ) +
      scalar(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE ownerId = ? AND avatarUrl LIKE '/uploads/%'`,
        ownerId,
      ),
  };
}

// Guards

/** How many admins can still sign in and act. */
function countActiveAdmins(): number {
  return scalar(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`,
  );
}

function loadTarget(id: string): UserListRow {
  const row = sqlite.prepare(`${USER_LIST_SQL} WHERE id = ?`).get(id) as
    UserListRow | undefined;
  if (!row) throw new NotFoundError("Account", id);
  return row;
}

/**
 * Refuse an action an admin aimed at their own account: disabling, deleting or
 * resetting yourself ends the session you hold, and on a one-admin instance
 * nobody is left to undo it. Checked after the last-admin guard, because when
 * the only admin aims at themselves, "promote another account first" is the
 * message that tells them what to do.
 */
function assertNotSelf(ctx: AdminContext, id: string): void {
  if (ctx.actor.id === id) {
    throw new AppError(
      "You cannot do this to your own account. Ask another administrator.",
      400,
      { code: "CANNOT_TARGET_SELF" },
    );
  }
}

/** Refuse anything that would leave the instance with no admin who can act. */
function assertNotLastAdmin(target: UserListRow): void {
  if (target.role !== "admin" || target.status !== "active") return;
  if (countActiveAdmins() > 1) return;
  throw new AppError(
    "This is the last administrator on the instance. Promote another account first.",
    409,
    { code: "LAST_ADMIN" },
  );
}

/**
 * Refuse to disable or delete the account that owns this device's data. While
 * auth is off, the local owner is behind every request and owns every row, and
 * nobody can sign in as it, so disabling it locks the instance out of its own
 * data. Checked first, because on that instance every guard is true at once,
 * and this message names the fix: secure the instance first.
 */
function assertNotProtectedLocalOwner(target: UserListRow): void {
  if (target.credentialState !== "none") return;
  if (isAuthRequired()) return;
  throw new AppError(
    "This is the local account, which holds the data while sign-in is off. Secure the instance first.",
    409,
    { code: "LOCAL_OWNER_PROTECTED" },
  );
}

// Creating an account

/** Letters and digits only. A temporary password gets read aloud and typed. */
const TEMPORARY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TEMPORARY_LENGTH = 20;

/**
 * A password the admin hands over once: 20 characters from 62 is about 119
 * bits, far past what the sign-in limiter lets anybody guess. `randomInt`, not
 * `randomBytes` with a modulo, because 256 is not a multiple of 62 and the bias
 * would be real.
 */
export function generateTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < TEMPORARY_LENGTH; i++) {
    out += TEMPORARY_ALPHABET[crypto.randomInt(TEMPORARY_ALPHABET.length)];
  }
  return out;
}

export async function createUser(
  ctx: AdminContext,
  input: {
    email: unknown;
    username: unknown;
    displayName?: unknown;
    role: "admin" | "member";
    temporaryPassword?: unknown;
  },
): Promise<{ user: AdminUserSummary; temporaryPassword: string }> {
  const temporaryPassword =
    typeof input.temporaryPassword === "string" && input.temporaryPassword
      ? input.temporaryPassword
      : generateTemporaryPassword();

  // createAccount runs the same email, username and password validators the
  // self-service paths use, and raises ConflictError on a duplicate.
  const created = await createAccount({
    email: input.email,
    username: input.username,
    password: temporaryPassword,
    displayName: input.displayName,
    role: input.role,
    createdBy: ctx.actor.id,
    // The person did not choose this password, so it is not a credential they
    // can keep. Every data route refuses them until they replace it.
    mustChangePassword: true,
  });

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.created",
    targetType: "user",
    targetId: created.id,
    details: { username: created.username, role: created.role },
    ip: ctx.ip,
  });

  return {
    user: summaryOf(created.id, ctx),
    temporaryPassword,
  };
}

// Changing an account

export function updateUser(
  ctx: AdminContext,
  id: string,
  patch: { role?: "admin" | "member"; displayName?: string | null },
): AdminUserSummary {
  const target = loadTarget(id);

  if (patch.role !== undefined && patch.role !== target.role) {
    // Only a demotion can remove the last admin. A promotion adds one.
    if (target.role === "admin") assertNotLastAdmin(target);
    sqlite
      .prepare(
        `UPDATE users SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(patch.role, id);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "user.role.changed",
      targetType: "user",
      targetId: id,
      details: { username: target.username, from: target.role, to: patch.role },
      ip: ctx.ip,
    });
  }

  if (patch.displayName !== undefined) {
    const displayName = patch.displayName?.trim()
      ? patch.displayName.trim().slice(0, 100)
      : null;
    sqlite
      .prepare(
        `UPDATE users SET displayName = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(displayName, id);
  }

  return summaryOf(id, ctx);
}

/**
 * Give an account a new temporary password. Every session and token of the
 * account stops working: a reset means the old credential is not trusted, and a
 * live token would outlive the password it was created under.
 */
export async function resetPassword(
  ctx: AdminContext,
  id: string,
): Promise<{ temporaryPassword: string }> {
  const target = loadTarget(id);
  // Not your own: a reset deletes every session of the account, this one
  // included, so the new password would go out in a response the browser is
  // throwing away. Changing your own is `POST /api/auth/change-password`, which
  // keeps the session it is made on.
  assertNotSelf(ctx, id);
  if (target.credentialState === "none") {
    throw new ValidationError(
      "This account has no password to reset. It is the local account, which holds the data while sign-in is off.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 1,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, id);
    revokeOtherSessions(id, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(id);
  })();

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.password.reset",
    targetType: "user",
    targetId: id,
    details: { username: target.username, via: "temporary" },
    ip: ctx.ip,
  });

  log.info("Admin", `Password reset for account ${id}`);
  return { temporaryPassword };
}

/**
 * Stop an account from being used, reversibly. Sessions go at once. Tokens stay
 * and are refused while the account is disabled, so enabling it brings them
 * back. The docs recommend this before a delete: instant, complete, undoable.
 */
export function disableUser(ctx: AdminContext, id: string): AdminUserSummary {
  const target = loadTarget(id);
  assertNotProtectedLocalOwner(target);
  assertNotLastAdmin(target);
  assertNotSelf(ctx, id);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP,
                updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(id);
    revokeOtherSessions(id, null);
  })();

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.disabled",
    targetType: "user",
    targetId: id,
    details: { username: target.username },
    ip: ctx.ip,
  });
  log.info("Admin", `Disabled account ${id}`);
  return summaryOf(id, ctx);
}

export function enableUser(ctx: AdminContext, id: string): AdminUserSummary {
  const target = loadTarget(id);
  sqlite
    .prepare(
      `UPDATE users
          SET status = 'active', disabledAt = NULL, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(id);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.enabled",
    targetType: "user",
    targetId: id,
    details: { username: target.username },
    ip: ctx.ip,
  });
  log.info("Admin", `Enabled account ${id}`);
  return summaryOf(id, ctx);
}

// Offboarding

/**
 * One account's whole export, for the person who is leaving. The only place an
 * admin reads another account's rows, so it is audit-logged with the account
 * name, visible to everybody who can see the audit log.
 */
export function exportUserData(
  ctx: AdminContext,
  id: string,
): { username: string; payload: FullExport } {
  const target = loadTarget(id);
  const payload = buildFullExport(scopeForOwnerId(id));

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.exported",
    targetType: "user",
    targetId: id,
    details: { username: target.username, contacts: payload.contacts.length },
    ip: ctx.ip,
  });
  return { username: target.username, payload };
}

/**
 * Delete an account and everything it owns. Without `decision: "purge"` this
 * answers `409 USER_HAS_DATA` and changes nothing, so the admin sees the four
 * numbers before agreeing to lose them. The export endpoint sits next to this
 * one for that moment.
 */
export function deleteUser(
  ctx: AdminContext,
  id: string,
  decision: string | undefined,
): { deleted: true; counts: OwnedCounts } {
  const target = loadTarget(id);
  assertNotProtectedLocalOwner(target);
  assertNotLastAdmin(target);
  assertNotSelf(ctx, id);

  const counts = ownedCounts(id);
  if (decision !== "purge") {
    throw new AppError(
      'Deleting this account removes everything it owns. Send { "decision": "purge" } to confirm.',
      409,
      { code: "USER_HAS_DATA", details: { counts } },
    );
  }

  const started = performance.now();
  purgeOwner(id);
  const uploadsRemoved = removeUploads(id);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.deleted",
    targetType: "user",
    targetId: id,
    // `uploadsRemoved` is present only when false: the audit row is what an
    // operator answers a deletion request from, so a purge that left files on
    // disk says so.
    details: {
      username: target.username,
      ...counts,
      ...(uploadsRemoved ? {} : { uploadsRemoved: false }),
    },
    ip: ctx.ip,
  });
  log.info(
    "Admin",
    `Deleted account ${id}: ${counts.contacts} contacts, ${counts.interactions} interactions in ${(performance.now() - started).toFixed(0)}ms`,
  );

  return { deleted: true, counts };
}

/**
 * Remove every row this owner has, in one transaction.
 *
 * The order matters. No cascade clears four tables: the two vector tables and
 * the embedding meta table have no foreign key, and the merge log has none to
 * `contacts`. The merge log's `ownerId` does reference `users`, with ON DELETE
 * RESTRICT, so its rows must go before the user. Everything else is deleted
 * parent-last, so a cascade never walks a table a statement above already
 * emptied.
 *
 * 10,000 contacts and 10,000 emails take 147 to 160 ms, against a budget of two
 * seconds. If a much larger account ever exceeds it, chunk the contacts delete
 * at 1,000 rows per transaction: a crash between chunks leaves a partly deleted
 * but consistent account that the next call finishes.
 */
export function purgeOwner(ownerId: string): void {
  sqlite.transaction(() => {
    // 1. Vectors and their metadata. `ownerId` is the vec0 partition key, so
    //    each of these is one partition drop rather than a scan.
    sqlite
      .prepare(`DELETE FROM search_embeddings WHERE ownerId = ?`)
      .run(ownerId);
    purgeOwnerFromIndexQueue(ownerId);
    sqlite
      .prepare(`DELETE FROM contact_embeddings WHERE ownerId = ?`)
      .run(ownerId);
    sqlite
      .prepare(
        // dedupe_embedding_meta has no owner of its own and no foreign key.
        // Its parent contact is the only route to one.
        `DELETE FROM dedupe_embedding_meta
          WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)`,
      )
      .run(ownerId);

    // 2. Owned tables that hang off contacts or off nothing.
    for (const table of [
      "score_snapshots",
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
      "action_items",
      "interactions",
      "lists",
      "map_views",
      // Cascades import_rows. Here rather than after contacts because a row's
      // contactId has no foreign key: an import record outlives its contacts.
      "imports",
      "search_history",
      "upcoming_events",
      "connector_links",
      "connector_runs",
      "connectors",
      "oauth_states",
      // What the account's writes recorded, and its background work. `jobs` is
      // not an owned table, since an instance job has no owner, but an
      // account's jobs name it, and both keys restrict.
      "events",
      "jobs",
    ]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE ownerId = ?`).run(ownerId);
    }

    // 3. Contacts, which cascade the ten child tables and list membership. The
    //    search index needs no statement: `contacts_ad` fires per row and
    //    deletes the FTS row by rowid.
    sqlite.prepare(`DELETE FROM contacts WHERE ownerId = ?`).run(ownerId);

    // 4. The account. Cascades sessions, tokens, per-user settings and every
    //    invitation it issued, accepted ones included (`invitations.invitedBy`
    //    is NOT NULL with ON DELETE CASCADE). The `user.invitation.accepted`
    //    audit row survives, so how somebody joined stays on record.
    //
    // This statement also checks everything above it: every `ownerId`
    // references `users(id)` with ON DELETE RESTRICT, so one owned row left
    // behind makes it throw and rolls the whole transaction back.
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(ownerId);
  })();
}

/**
 * Remove the account's upload directory after the transaction commits: a file
 * removal cannot be rolled back, so doing it first could delete the files of an
 * account the database still has.
 *
 * @returns false when the directory is still there (a read-only volume, a
 *   directory owned by another uid), so the audit row can say so.
 */
function removeUploads(ownerId: string): boolean {
  try {
    const avatars = ownerUploadDir(ownerId, "avatars");
    fs.rmSync(avatars, { recursive: true, force: true });
    fs.rmSync(ownerUploadDir(ownerId, "files"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(ownerUploadDir(ownerId, "profile"), {
      recursive: true,
      force: true,
    });
    // All live under uploads/u/<id>/. Removing the parent as well stops an
    // empty directory accumulating for every account ever deleted.
    fs.rmSync(path.dirname(avatars), { recursive: true, force: true });
    return true;
  } catch (err) {
    // The rows are gone and no principal can match this owner segment again, so
    // `guardUploads` refuses every path under it. A file left behind costs
    // disk, not privacy, so the delete stands, but it is logged.
    log.warn(
      "Admin",
      `Removed account ${ownerId} but its upload directory did not go: ${String(err)}`,
    );
    return false;
  }
}

// Shared

/** One account's row as the admin API returns it, counts included. */
function summaryOf(id: string, ctx: AdminContext): AdminUserSummary {
  const row = loadTarget(id);
  return {
    ...toSummary(row, ctx.actor.id),
    contactCount: scalar(
      `SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ? AND deletedAt IS NULL`,
      id,
    ),
    sessionCount: scalar(
      `SELECT COUNT(*) AS n FROM sessions
        WHERE userId = ? AND datetime(expiresAt) > datetime('now')`,
      id,
    ),
    tokenCount: scalar(
      `SELECT COUNT(*) AS n FROM api_tokens WHERE userId = ? AND revokedAt IS NULL`,
      id,
    ),
  };
}

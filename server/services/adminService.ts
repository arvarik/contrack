// =============================================================================
// Admin Service — the operator's view of the accounts on this instance
// =============================================================================
// One admin looks after the instance: they create accounts, change roles,
// reset passwords, disable people who have left, and eventually delete them
// and everything they own. Every function here writes an audit row.
//
// Three rules hold across the whole file.
//
//   • An admin never reads another account's rows. `exportUserData` is the
//     single exception, it exists for offboarding, and it writes an audit row
//     naming the account it read. Decision D10 in the plan. The account list
//     reports how many contacts each account holds, which is a number rather
//     than a row, and it is the only cross-account read besides that one.
//   • Three guards stand between an admin and an instance nobody can
//     administer, and they run in this order: the local owner is protected
//     while authentication is off, the last active admin cannot be removed,
//     and no admin may aim at their own account. On an unsecured instance all
//     three are true at once, and only the first names a fix.
//   • Deleting an account is two steps. The first answers `409 USER_HAS_DATA`
//     with what the account owns; only a request that says `decision: "purge"`
//     removes anything.
// =============================================================================

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
}

/**
 * What an account owns, as the delete confirmation reports it.
 *
 * `contacts` counts every row, trashed ones included, because every row goes.
 * That is deliberately not `AdminUserSummary.contactCount`, which counts what
 * the account can see and so leaves the trash out.
 */
export interface OwnedCounts {
  contacts: number;
  interactions: number;
  lists: number;
  files: number;
}

// =============================================================================
// Reading
// =============================================================================

const USER_LIST_SQL = `SELECT id, email, username, displayName, role, status,
                              credentialState, mustChangePassword, createdAt,
                              lastLoginAt, passwordChangedAt
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
}

/**
 * Every account, oldest first, with the three numbers the list screen shows.
 *
 * The counts come from three grouped queries rather than three sub-selects per
 * row, so the cost is constant in the number of accounts.
 */
export function listUsers(ctx: AdminContext): AdminUserSummary[] {
  const rows = sqlite
    .prepare(`${USER_LIST_SQL} ORDER BY createdAt ASC`)
    .all() as UserListRow[];

  const contacts = countByOwner(
    // Every account's count in one grouped read. The statement names ownerId
    // and does not filter by it, which is the one shape tenant-lint cannot
    // tell apart from a scoped read, so the reason is written out here.
    // tenant-lint: allow admin cross-user
    `SELECT ownerId AS k, COUNT(*) AS n FROM contacts
      WHERE deletedAt IS NULL GROUP BY ownerId`,
  );
  const sessions = countByOwner(
    `SELECT userId AS k, COUNT(*) AS n FROM sessions
      WHERE expiresAt > datetime('now') GROUP BY userId`,
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
    // An upload is a file on disk that a row points at: an interaction
    // attachment, or a contact avatar this instance stores itself. An avatar
    // URL that points at somebody else's server is not a file we hold.
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

// =============================================================================
// Guards
// =============================================================================

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
 * Refuse an action an admin aimed at their own account.
 *
 * Disabling or deleting yourself ends the session you are holding, and on a
 * one-admin instance it leaves nobody who can undo it.
 *
 * Checked after the last-admin guard, not before. Both are true when the only
 * admin on the instance aims at themselves, and "you are the last
 * administrator, promote another account first" is the sentence that tells
 * them what to do. "Ask another administrator" is advice with nobody to
 * follow it to.
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
 * Refuse to disable or delete the account that owns this device's data.
 *
 * While authentication is off, the local owner is the principal behind every
 * request and the owner of every row. Disabling it locks the instance out of
 * its own data with no way back in, because nobody can sign in as it.
 *
 * Checked before the other two, because on that instance every guard is true
 * at once: the local owner is the last admin and it is also the caller. This
 * is the message that names the fix, which is to secure the instance first.
 */
function assertNotProtectedLocalOwner(target: UserListRow): void {
  if (target.credentialState !== "none") return;
  if (isAuthRequired()) return;
  throw new AppError(
    "This is the local account that owns this device's data, and authentication is off. Secure the instance first.",
    409,
    { code: "LOCAL_OWNER_PROTECTED" },
  );
}

// =============================================================================
// Creating an account
// =============================================================================

/** Letters and digits only. A temporary password gets read aloud and typed. */
const TEMPORARY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TEMPORARY_LENGTH = 20;

/**
 * A password the admin hands over once.
 *
 * 20 characters from a 62-character alphabet is about 119 bits, which is far
 * past anything the sign-in limiter would let somebody guess. `randomInt`
 * rather than `randomBytes` with a modulo, because 256 does not divide 62 and
 * the bias would be real even if small.
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

// =============================================================================
// Changing an account
// =============================================================================

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
 * Give an account a new temporary password.
 *
 * Every session and every token of that account stops working. That is the
 * point: a reset happens because the old credential is not trusted any more,
 * and a live token would outlive the password it was created under.
 */
export async function resetPassword(
  ctx: AdminContext,
  id: string,
): Promise<{ temporaryPassword: string }> {
  const target = loadTarget(id);
  if (target.credentialState === "none") {
    throw new ValidationError(
      "This account has no password to reset. It is the local account that owns this device's data.",
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
    details: { username: target.username },
    ip: ctx.ip,
  });

  log.info("Admin", `Password reset for "${target.username}" (${id})`);
  return { temporaryPassword };
}

/**
 * Stop an account from being used, reversibly.
 *
 * Sessions go immediately. Tokens stay in the table and are refused while the
 * account is disabled, so enabling the account brings them back rather than
 * making the person mint new ones. This is the step the docs recommend before
 * a delete: it is instant, complete, and undoable.
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
  log.info("Admin", `Disabled account "${target.username}" (${id})`);
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
  log.info("Admin", `Enabled account "${target.username}" (${id})`);
  return summaryOf(id, ctx);
}

// =============================================================================
// Offboarding
// =============================================================================

/**
 * One account's whole export, for handing to the person who is leaving.
 *
 * The only place an admin reads another account's rows. It is audit-logged
 * with the account name, so the read is visible to everybody who can see the
 * audit log, including the person it was about.
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
 * Delete an account and everything it owns.
 *
 * Two steps by design. Without `decision: "purge"` this answers
 * `409 USER_HAS_DATA` and changes nothing, so the admin sees the four numbers
 * before they agree to lose them. The export endpoint sits next to this one
 * for exactly that moment.
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
    // `uploadsRemoved` is only present when it is false. The audit row is the
    // record an operator answers a deletion request from, so a purge that
    // left files on disk has to say so rather than report the count it
    // intended to remove.
    details: {
      username: target.username,
      ...counts,
      ...(uploadsRemoved ? {} : { uploadsRemoved: false }),
    },
    ip: ctx.ip,
  });
  log.info(
    "Admin",
    `Deleted account "${target.username}" (${id}): ${counts.contacts} contacts, ${counts.interactions} interactions in ${(performance.now() - started).toFixed(0)}ms`,
  );

  return { deleted: true, counts };
}

/**
 * Remove every row this owner has, in one transaction.
 *
 * The order is not a preference. Four tables carry no foreign key to
 * `contacts` or `users` at all — the two vector tables, the embedding meta
 * table, and the merge log — so nothing removes their rows for us. Everything
 * else is deleted parent-last so that a cascade never has to walk a table the
 * statement above it already emptied.
 *
 * Measured between 147ms and 160ms for 10,000 contacts and 10,000 emails,
 * against a budget of two seconds. The fallback the plan describes, if a much larger account
 * ever exceeds that, is to chunk the contacts delete at 1,000 rows per
 * transaction: a crash between chunks leaves a partly deleted but consistent
 * account that the next call finishes.
 */
export function purgeOwner(ownerId: string): void {
  sqlite.transaction(() => {
    // 1. Vectors and their metadata. `ownerId` is the vec0 partition key, so
    //    each of these is one partition drop rather than a scan.
    sqlite
      .prepare(`DELETE FROM search_embeddings WHERE ownerId = ?`)
      .run(ownerId);
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
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
      "action_items",
      "interactions",
      "lists",
    ]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE ownerId = ?`).run(ownerId);
    }

    // 3. Contacts, which cascade the ten child tables and list membership.
    //    The search index needs no statement of its own: `contacts_ad` fires
    //    per row here and deletes the FTS row by rowid, which FTS5 pushes
    //    down (PR #18). The plan proposed one
    //    `DELETE FROM contacts_fts ... MATCH 'ownerTok:...'` instead, and
    //    measured on 10,000 contacts it saved 4ms of 153ms, which is inside
    //    the run-to-run spread, so a second mechanism doing the same work was
    //    not worth having.
    sqlite.prepare(`DELETE FROM contacts WHERE ownerId = ?`).run(ownerId);

    // 4. The account. Cascades sessions, tokens, per-user settings and every
    //    invitation it issued, accepted ones included. `invitations.invitedBy`
    //    is NOT NULL with ON DELETE CASCADE, so an accepted invitation cannot
    //    keep its row with the inviter set to NULL the way an audit row does.
    //    The plan says otherwise in two places and the schema is what decides
    //    it. What survives is the `user.invitation.accepted` audit row, which
    //    names the account that joined, so how somebody joined is still on
    //    record after the person who invited them is gone.
    //
    //    This statement is also the check on everything above it. Every
    //    `ownerId` column references `users(id)` with ON DELETE RESTRICT, so
    //    one owned row left behind anywhere makes this throw and rolls the
    //    whole transaction back. A purge that misses a table cannot half
    //    succeed.
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(ownerId);
  })();
}

/**
 * Remove the account's upload directory after the transaction commits.
 *
 * After, not inside: a filesystem removal cannot be rolled back, so doing it
 * first would delete the files of an account the database still has.
 *
 * @returns false when the directory is still there, so the audit row can say
 *   so. A read-only volume, or a directory owned by another uid, is the case
 *   this covers.
 */
function removeUploads(ownerId: string): boolean {
  try {
    const avatars = ownerUploadDir(ownerId, "avatars");
    fs.rmSync(avatars, { recursive: true, force: true });
    fs.rmSync(ownerUploadDir(ownerId, "files"), {
      recursive: true,
      force: true,
    });
    // Both live under uploads/u/<id>/. Removing the parent as well stops an
    // empty directory accumulating for every account ever deleted.
    fs.rmSync(path.dirname(avatars), { recursive: true, force: true });
    return true;
  } catch (err) {
    // The rows are already gone and no principal can ever match this owner
    // segment again, so `guardUploads` refuses every path under it. A file
    // left behind is a disk-space problem rather than an exposure one, which
    // is why this does not fail the delete. It does have to be recorded.
    log.warn(
      "Admin",
      `Removed account ${ownerId} but its upload directory did not go: ${String(err)}`,
    );
    return false;
  }
}

// =============================================================================
// Shared
// =============================================================================

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
      `SELECT COUNT(*) AS n FROM sessions WHERE userId = ? AND expiresAt > datetime('now')`,
      id,
    ),
    tokenCount: scalar(
      `SELECT COUNT(*) AS n FROM api_tokens WHERE userId = ? AND revokedAt IS NULL`,
      id,
    ),
  };
}

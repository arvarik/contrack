// OIDC identities: which provider account (issuer + subject) signs in to which
// Contrack account. One identity per account per provider.

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { ConflictError, NotFoundError } from "../utils/AppError.ts";
import { getOidcConfig } from "./integrationSettings.ts";
import { normalizeIssuer } from "../../shared/contracts/admin.ts";
import { auditService } from "./auditService.ts";

export interface IdentitySummary {
  id: string;
  issuer: string;
  email: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function findUserIdByIdentity(
  issuer: string,
  subject: string,
): string | null {
  const row = sqlite
    .prepare(
      "SELECT userId FROM user_identities WHERE issuer = ? AND subject = ?",
    )
    .get(issuer, subject) as { userId: string } | undefined;
  return row?.userId ?? null;
}

/**
 * Link (issuer, subject) to `userId`. A second link from the same account to
 * the same provider replaces the first, as a new link. One that another
 * account holds is refused.
 */
export function linkIdentity(
  userId: string,
  issuer: string,
  subject: string,
  email: string | null,
): void {
  const holder = findUserIdByIdentity(issuer, subject);
  if (holder && holder !== userId) {
    throw new ConflictError(
      "This sign-in is already linked to another account",
    );
  }
  sqlite
    .prepare(
      `INSERT INTO user_identities (id, userId, issuer, subject, email)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (userId, issuer) DO UPDATE
         SET subject = excluded.subject, email = excluded.email,
             createdAt = CURRENT_TIMESTAMP, lastUsedAt = NULL`,
    )
    .run(crypto.randomUUID(), userId, issuer, subject, email);
}

/** Stamp a sign-in, and keep the address the provider sends now. */
export function touchIdentity(
  issuer: string,
  subject: string,
  email: string | null,
): void {
  sqlite
    .prepare(
      `UPDATE user_identities SET lastUsedAt = CURRENT_TIMESTAMP, email = ?
        WHERE issuer = ? AND subject = ?`,
    )
    .run(email, issuer, subject);
}

export function listIdentities(userId: string): IdentitySummary[] {
  return sqlite
    .prepare(
      `SELECT id, issuer, email, createdAt, lastUsedAt FROM user_identities
        WHERE userId = ? ORDER BY createdAt`,
    )
    .all(userId) as IdentitySummary[];
}

/**
 * An issuer as written, compared by its URL with one trailing slash off. A
 * configured discovery URL compares as its issuer.
 */
function issuerKey(issuer: string): string {
  const value = normalizeIssuer(issuer);
  try {
    return new URL(value).href.replace(/\/$/, "");
  } catch {
    return value;
  }
}

/**
 * The account's identities, each marked `current` when it is at the provider
 * set up now, so the account page can offer a link to that one, and whether
 * the next sign-in would link the account again.
 */
export function accountIdentities(userId: string) {
  const config = getOidcConfig();
  return {
    identities: listIdentities(userId).map((identity) => ({
      ...identity,
      current:
        config !== null &&
        issuerKey(identity.issuer) === issuerKey(config.issuer),
    })),
    // Matching reaches only a trusted email, so an account whose email is not
    // trusted never links again by it.
    matchByEmail:
      config?.matchByEmail === true &&
      sqlite
        .prepare(
          "SELECT 1 FROM users WHERE id = ? AND emailTrustedAt IS NOT NULL",
        )
        .get(userId) !== undefined,
  };
}

export function unlinkIdentity(userId: string, id: string): void {
  const result = sqlite
    .prepare("DELETE FROM user_identities WHERE id = ? AND userId = ?")
    .run(id, userId);
  if (result.changes === 0) {
    throw new NotFoundError("Linked sign-in");
  }
}

/**
 * Unlink every identity of an account whose password is being reset: a link
 * made while somebody else held the account must not outlive the reset. Run
 * it inside the reset's transaction. One audit row when any goes.
 */
export function unlinkIdentitiesForReset(
  userId: string,
  actorUserId: string | null,
  ip: string | null,
): void {
  const removed = sqlite
    .prepare("DELETE FROM user_identities WHERE userId = ?")
    .run(userId).changes;
  if (removed === 0) return;
  auditService.record({
    actorUserId,
    action: "auth.oidc.unlinked",
    targetType: "user",
    targetId: userId,
    details: { reason: "password-reset", count: removed },
    ip,
  });
}

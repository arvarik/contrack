// OIDC identities: which provider account (issuer + subject) signs in to which
// Contrack account. One identity per account per provider.

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { AppError, ConflictError, NotFoundError } from "../utils/AppError.ts";
import { getOidcConfig } from "./integrationSettings.ts";

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
): IdentitySummary {
  const holder = findUserIdByIdentity(issuer, subject);
  if (holder && holder !== userId) {
    throw new ConflictError(
      "This sign-in is already linked to another account",
    );
  }
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO user_identities (id, userId, issuer, subject, email)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (userId, issuer) DO UPDATE
         SET subject = excluded.subject, email = excluded.email,
             createdAt = CURRENT_TIMESTAMP, lastUsedAt = NULL`,
    )
    .run(id, userId, issuer, subject, email);
  const row = listIdentities(userId).find((r) => r.issuer === issuer);
  if (!row) throw new AppError("Linking the sign-in failed", 500);
  return row;
}

export function touchIdentity(issuer: string, subject: string): void {
  sqlite
    .prepare(
      `UPDATE user_identities SET lastUsedAt = CURRENT_TIMESTAMP
        WHERE issuer = ? AND subject = ?`,
    )
    .run(issuer, subject);
}

export function listIdentities(userId: string): IdentitySummary[] {
  return sqlite
    .prepare(
      `SELECT id, issuer, email, createdAt, lastUsedAt FROM user_identities
        WHERE userId = ? ORDER BY createdAt`,
    )
    .all(userId) as IdentitySummary[];
}

/** An issuer as written, compared by its URL with one trailing slash off. */
function issuerKey(issuer: string): string {
  try {
    return new URL(issuer).href.replace(/\/$/, "");
  } catch {
    return issuer;
  }
}

/**
 * The account's identities, each marked `current` when it is at the provider
 * set up now, so the account page can offer a link to that one.
 */
export function listAccountIdentities(
  userId: string,
): (IdentitySummary & { current: boolean })[] {
  const issuer = getOidcConfig()?.issuer;
  return listIdentities(userId).map((identity) => ({
    ...identity,
    current: issuer != null && issuerKey(identity.issuer) === issuerKey(issuer),
  }));
}

export function unlinkIdentity(userId: string, id: string): void {
  const result = sqlite
    .prepare("DELETE FROM user_identities WHERE id = ? AND userId = ?")
    .run(id, userId);
  if (result.changes === 0) {
    throw new NotFoundError("Linked sign-in");
  }
}

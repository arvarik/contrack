// Personal API tokens: the credential a script carries (`Authorization: Bearer
// ctk_...`). A token acts as its owner for every scoped endpoint and nothing
// else, so an MCP client reads one account's contacts, not the instance's. As
// with sessions and invitations, the database holds only the token's SHA-256:
// it is 256 random bits, so there is no dictionary for a slow KDF to defend
// against. The plaintext exists once, in the response that created it.

import type { ApiToken } from "../../shared/contracts/tokens.ts";
import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { NotFoundError, ValidationError } from "../utils/AppError.ts";
import { auditService } from "./auditService.ts";
import { getUserById, type User } from "./authService.ts";

/** The prefix every personal token carries, so a leaked one is recognizable. */
export const TOKEN_PREFIX = "ctk_";

/** How much of a token is shown in a list, enough to tell two apart. */
const DISPLAY_PREFIX_LENGTH = 12;

export const MAX_TOKEN_NAME = 60;
export const MAX_TOKEN_DAYS = 3650;

function hashToken(token: string): string {
  return crypto.hash("sha256", token);
}

/**
 * Mint a token for a user.
 *
 * @returns the plaintext token, the only time it exists outside the caller's
 *   own storage.
 */
export function createToken(
  user: User,
  input: { name: unknown; expiresInDays?: unknown; readOnly?: unknown },
  ip: string | null,
): {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  expiresAt: string | null;
  readOnly: boolean;
} {
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, MAX_TOKEN_NAME)
      : "";
  if (!name) throw new ValidationError("Give the token a name.");

  let expiresAt: string | null = null;
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const days = Number(input.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
      throw new ValidationError(
        `An expiry must be a whole number of days between 1 and ${MAX_TOKEN_DAYS}.`,
      );
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  // Only `true` makes a read-only token, so a missing or odd value gives the
  // token that every token was before the choice existed.
  const readOnly = input.readOnly === true;

  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const id = crypto.randomUUID();
  const tokenPrefix = token.slice(0, DISPLAY_PREFIX_LENGTH);

  sqlite
    .prepare(
      `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, expiresAt, readOnly)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      user.id,
      name,
      hashToken(token),
      tokenPrefix,
      expiresAt,
      readOnly ? 1 : 0,
    );

  auditService.record({
    actorUserId: user.id,
    action: "auth.token.created",
    targetType: "token",
    targetId: id,
    // The name and the display prefix, never the token. `tokenPrefix` would
    // be redacted by the key rule anyway, which is why it is not recorded.
    details: { name, expiresAt, readOnly },
    ip,
  });

  log.info("Auth", `Personal token ${id} created for account ${user.id}`);
  return { id, name, token, tokenPrefix, expiresAt, readOnly };
}

/** One account's tokens, newest first, revoked and expired ones included. */
export function listTokens(userId: string): ApiToken[] {
  const rows = sqlite
    .prepare(
      `SELECT id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, revokedAt, readOnly, kind
         FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC`,
    )
    .all(userId) as (Omit<ApiToken, "readOnly"> & { readOnly: number })[];
  return rows.map((row) => ({ ...row, readOnly: row.readOnly === 1 }));
}

/**
 * Revoke one of the caller's own tokens. The owner is in the same statement as
 * the id, so somebody else's token is a `404`, not a `403`, which would say
 * which token ids exist.
 */
export function revokeToken(
  user: User,
  id: string,
  ip: string | null,
): { revoked: true } {
  const result = sqlite
    .prepare(
      `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
    )
    .run(id, user.id);

  if (result.changes === 0) {
    // Either it is not theirs, it does not exist, or it was already revoked.
    // Only the last of those deserves a success, so check for it by owner.
    const own = sqlite
      .prepare(`SELECT id FROM api_tokens WHERE id = ? AND userId = ?`)
      .get(id, user.id) as { id: string } | undefined;
    if (!own) throw new NotFoundError("Token");
    return { revoked: true };
  }

  auditService.record({
    actorUserId: user.id,
    action: "auth.token.revoked",
    targetType: "token",
    targetId: id,
    ip,
  });
  return { revoked: true };
}

/**
 * Resolve a presented token to its user, refusing a revoked or expired token
 * and a disabled account. `lastUsedAt` is stamped at most once an hour, so a
 * script's requests do not each dirty a page. The hourly check is in the SQL
 * statement: `lastUsedAt` holds `CURRENT_TIMESTAMP` (`2026-09-10 05:33:50`),
 * and comparing it in JavaScript with `toISOString()` compares a space against
 * a `T`, which would dirty the row on every request. In SQL both sides share
 * SQLite's format, and the `WHERE` clause removes the race between read and
 * write.
 */
export function resolveToken(
  presented: string,
): { user: User; tokenId: string; readOnly: boolean } | null {
  const row = sqlite
    .prepare(
      // `datetime(expiresAt)`, not the bare column: `createToken` writes an
      // ISO string and `datetime('now')` a space-separated one, and a `T`
      // sorts after a space, so a token that expired earlier today would keep
      // working until the UTC date rolled over. A value `datetime()` cannot
      // read becomes NULL, which refuses the token, the safe direction for a
      // credential.
      // An app's grant is never a personal token, whatever is presented.
      `SELECT id, userId, readOnly FROM api_tokens
        WHERE tokenHash = ? AND revokedAt IS NULL AND kind = 'personal'
          AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))`,
    )
    .get(hashToken(presented)) as
    { id: string; userId: string; readOnly: number } | undefined;
  if (!row) return null;

  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") return null;

  sqlite
    .prepare(
      `UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP
        WHERE id = ?
          AND (lastUsedAt IS NULL OR lastUsedAt < datetime('now', '-1 hour'))`,
    )
    .run(row.id);
  return { user, tokenId: row.id, readOnly: row.readOnly === 1 };
}

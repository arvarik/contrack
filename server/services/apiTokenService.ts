// =============================================================================
// API Token Service — the credential a script carries
// =============================================================================
// A person signs in and gets a cookie. A script cannot, so it carries a
// personal token instead: `Authorization: Bearer ctk_...`. The token acts as
// its owner for every scoped endpoint and for nothing else, which is what
// makes an MCP client read one account's contacts rather than the instance's.
//
// The same rule as sessions and invitations: the database holds only the
// SHA-256 of the token. It is a 256-bit random value, so there is no
// dictionary to attack and nothing a slow KDF would buy. The plaintext exists
// once, in the response that created it.
//
// `attachPrincipal` has resolved these since Phase 1, because the principal
// shape had to be final before Phase 2 scoped every read. Phase 3 moves that
// lookup here and adds the endpoints that mint them.
// =============================================================================

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { NotFoundError, ValidationError } from "../utils/AppError.ts";
import { auditService } from "./auditService.ts";
import { getUserById, type User } from "./authService.ts";

/** The prefix every personal token carries, so a leaked one is recognisable. */
export const TOKEN_PREFIX = "ctk_";

/** How much of a token is shown in a list, enough to tell two apart. */
const DISPLAY_PREFIX_LENGTH = 12;

export const MAX_TOKEN_NAME = 60;
export const MAX_TOKEN_DAYS = 3650;

export interface TokenSummary {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a token for a user.
 *
 * @returns the plaintext token, the only time it exists outside the caller's
 *   own storage.
 */
export function createToken(
  user: User,
  input: { name: unknown; expiresInDays?: unknown },
  ip: string | null,
): {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  expiresAt: string | null;
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

  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const id = crypto.randomUUID();
  const tokenPrefix = token.slice(0, DISPLAY_PREFIX_LENGTH);

  sqlite
    .prepare(
      `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, user.id, name, hashToken(token), tokenPrefix, expiresAt);

  auditService.record({
    actorUserId: user.id,
    action: "auth.token.created",
    targetType: "token",
    targetId: id,
    // The name and the display prefix, never the token. `tokenPrefix` would
    // be redacted by the key rule anyway, which is why it is not recorded.
    details: { name, expiresAt },
    ip,
  });

  log.info("Auth", `Personal token "${name}" created for "${user.username}"`);
  return { id, name, token, tokenPrefix, expiresAt };
}

/** One account's tokens, newest first, revoked and expired ones included. */
export function listTokens(userId: string): TokenSummary[] {
  return sqlite
    .prepare(
      `SELECT id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, revokedAt
         FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC`,
    )
    .all(userId) as TokenSummary[];
}

/**
 * Revoke one of the caller's own tokens.
 *
 * The owner is in the same statement as the id, so a token belonging to
 * somebody else is a `404` rather than a `403`: telling the two apart would
 * say which token ids exist.
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
 * Resolve a presented token to its user.
 *
 * Rejects a revoked token, an expired one, and one whose account is disabled.
 * `lastUsedAt` is stamped at most once an hour: the write is not worth a page
 * dirtied on every request a script makes.
 *
 * The hourly comparison is one SQL statement, not a read followed by a
 * JavaScript comparison. `lastUsedAt` holds `CURRENT_TIMESTAMP`, which is
 * `2026-09-10 05:33:50`, and comparing that against
 * `new Date(...).toISOString()` compares a space against a `T`. A space sorts
 * first, so the stored value looked older than any cut-off from the same day
 * and the row was dirtied on every single request. Both sides are now
 * SQLite's own format, and the `WHERE` clause is also what removes the race
 * between the read and the write.
 */
export function resolveToken(
  presented: string,
): { user: User; tokenId: string } | null {
  const row = sqlite
    .prepare(
      // `datetime(expiresAt)` and not the bare column. `createToken` writes an
      // ISO string and `datetime('now')` renders a space-separated one, and
      // SQLite compares TEXT byte by byte: a `T` sorts after a space, so an
      // expiry from earlier today looked later than now and the token kept
      // working until the UTC date rolled over. `datetime()` reads both
      // formats, and a value it cannot read becomes NULL, which makes the
      // comparison false and refuses the token. That is the safe direction
      // for a credential.
      `SELECT id, userId FROM api_tokens
        WHERE tokenHash = ? AND revokedAt IS NULL
          AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))`,
    )
    .get(hashToken(presented)) as { id: string; userId: string } | undefined;
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
  return { user, tokenId: row.id };
}

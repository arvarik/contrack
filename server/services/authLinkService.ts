/**
 * server/services/authLinkService.ts — One-time auth link tokens.
 *
 * Manages creation and redemption of single-use, hashed tokens for:
 * - Password resets (user-requested: 1h, admin-issued: 24h)
 * - Magic link sign-ins (15m)
 *
 * Tokens are stored as SHA-256 hashes. Plaintext is returned once upon creation.
 * Enforces an hourly cap of three creations per account for self-service requests.
 */

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import { AppError } from "../utils/AppError.ts";

export type AuthLinkKind = "reset" | "magic";

export interface AuthLinkRow {
  id: string;
  kind: AuthLinkKind;
  userId: string;
  tokenHash: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  requestIp: string | null;
}

export interface CreatedAuthLink {
  id: string;
  token: string;
  expiresAt: string;
}

/** Default TTLs in seconds. */
export const RESET_LINK_TTL_SECONDS = 3600; // 1 hour
export const MAGIC_LINK_TTL_SECONDS = 900; // 15 minutes
export const ADMIN_RESET_LINK_TTL_SECONDS = 86400; // 24 hours

/** Maximum link creations per hour per account for self-service requests. */
export const HOURLY_CREATION_CAP = 3;

/**
 * SHA-256 hash a plaintext token for lookup in auth_links.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a cryptographically secure random token string.
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create a new one-time auth link for an account.
 *
 * Enforces a cap of 3 creations per hour for self-service requests (createdBy is null).
 * When the cap is reached, returns null so the caller can answer 202 without sending email.
 */
export function createAuthLink(
  kind: AuthLinkKind,
  userId: string,
  ttlSeconds: number,
  createdBy?: string | null,
  requestIp?: string | null,
): CreatedAuthLink | null {
  // Check hourly creation cap for self-service requests
  if (!createdBy) {
    const recent = sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_links
         WHERE userId = ? AND datetime(createdAt) > datetime('now', '-1 hour')`,
      )
      .get(userId) as { count: number };

    if (recent.count >= HOURLY_CREATION_CAP) {
      return null;
    }
  }

  const id = crypto.randomUUID();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  sqlite
    .prepare(
      `INSERT INTO auth_links (id, kind, userId, tokenHash, createdBy, createdAt, expiresAt, requestIp)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
    )
    .run(
      id,
      kind,
      userId,
      tokenHash,
      createdBy ?? null,
      expiresAt,
      requestIp ?? null,
    );

  return { id, token, expiresAt };
}

function parseDbDate(dateStr: string): number {
  let normalized = dateStr.trim();
  if (!normalized.includes("T") && normalized.includes(" ")) {
    normalized = normalized.replace(" ", "T");
  }
  if (!normalized.endsWith("Z") && !normalized.match(/[+-]\d{2}:\d{2}$/)) {
    normalized += "Z";
  }
  return new Date(normalized).getTime();
}

/**
 * Redeem an auth link token.
 *
 * Verifies kind, hash match, single use, and expiry.
 * On success, sets usedAt to CURRENT_TIMESTAMP and returns the link record.
 * Throws AppError with codes LINK_INVALID, LINK_USED, or LINK_EXPIRED.
 */
export function redeemAuthLink(kind: AuthLinkKind, token: string): AuthLinkRow {
  const tokenHash = hashToken(token);

  const row = sqlite
    .prepare(`SELECT * FROM auth_links WHERE tokenHash = ? AND kind = ?`)
    .get(tokenHash, kind) as AuthLinkRow | undefined;

  if (!row) {
    throw new AppError("That link is not valid.", 404, {
      code: "LINK_INVALID",
    });
  }

  if (row.usedAt !== null) {
    throw new AppError("That link has already been used.", 410, {
      code: "LINK_USED",
    });
  }

  const isExpired = parseDbDate(row.expiresAt) <= Date.now();
  if (isExpired) {
    throw new AppError("That link has expired.", 410, {
      code: "LINK_EXPIRED",
    });
  }

  const usedAt = new Date().toISOString();
  sqlite
    .prepare(`UPDATE auth_links SET usedAt = ? WHERE id = ? AND usedAt IS NULL`)
    .run(usedAt, row.id);

  return { ...row, usedAt };
}

export const authLinkService = {
  create: createAuthLink,
  redeem: redeemAuthLink,
  hashToken,
};

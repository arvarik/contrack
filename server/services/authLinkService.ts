/**
 * One-time auth link tokens: password resets (self-service 1 h, admin-issued 24
 * h) and magic link sign-ins (15 m). Only the SHA-256 is stored; the plaintext
 * is returned once, at creation. Self-service requests are capped at three an
 * hour per account.
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
 * Create a one-time auth link for an account. A self-service request (createdBy
 * null) past 3 an hour returns null, so the caller answers 202 and sends
 * nothing.
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

/** Delete a link whose mail was never sent, so nobody can redeem it. */
export function discardAuthLink(id: string): void {
  sqlite.prepare(`DELETE FROM auth_links WHERE id = ?`).run(id);
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
 * Redeem an auth link token: check its kind, hash, single use and expiry, set
 * usedAt and return the link. Throws AppError LINK_INVALID, LINK_USED or
 * LINK_EXPIRED.
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
  const res = sqlite
    .prepare(`UPDATE auth_links SET usedAt = ? WHERE id = ? AND usedAt IS NULL`)
    .run(usedAt, row.id);

  if (res.changes === 0) {
    throw new AppError("That link has already been used.", 410, {
      code: "LINK_USED",
    });
  }

  return { ...row, usedAt };
}

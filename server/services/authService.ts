// =============================================================================
// authService — accounts, sessions, and data ownership
// =============================================================================
// The whole credential layer lives here so the middleware and the route
// handlers stay thin. Three concerns:
//
//   1. Accounts    — create, look up, update profile, change password.
//   2. Sessions    — issue, resolve, revoke. Server-side, so sign-out is real.
//   3. Ownership   — claim rows written before an account existed.
//
// Single-account today. Everything is written so that becoming multi-account
// is a matter of adding scope to callers rather than reshaping this file:
// there is no "the user" singleton, every function takes or returns an id,
// and `role` is populated even though only 'admin' is ever assigned.
// =============================================================================

import crypto from "crypto";
import { sqlite, OWNED_TABLES } from "../db.ts";
import { log } from "../utils/logger.ts";
import { AppError, ConflictError, ValidationError } from "../utils/AppError.ts";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  validatePassword,
} from "./passwords.ts";

/** How long a browser session stays valid without re-authenticating. */
const SESSION_TTL_DAYS = 30;

/** Cap on the stored User-Agent — enough to name a device, not a fingerprint. */
const USER_AGENT_MAX = 200;

// =============================================================================
// Types
// =============================================================================

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

/** A user row plus the hash — never leaves this module. */
interface UserRow extends User {
  passwordHash: string;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  /** True for the session making the current request. */
  current: boolean;
}

/** The public shape of a user — what the API returns. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

// =============================================================================
// Identifier validation
// =============================================================================

/**
 * Usernames are lowercased and restricted to a conservative set, because they
 * appear in URLs and logs and are compared for uniqueness — and case-folding
 * plus Unicode confusables make "unique" a slippery claim otherwise.
 */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

/**
 * Email checking is deliberately loose. This is a self-hosted app with no
 * outbound mail; the address is an identifier and a recovery hint, not
 * something we deliver to. Rejecting valid-but-unusual addresses would be a
 * worse failure than accepting a typo the owner can fix in settings.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** @returns an error message, or null when valid */
export function validateUsername(username: string): string | null {
  if (!username) return "Enter a username.";
  if (username.length < 2) return "Usernames need at least 2 characters.";
  if (username.length > 32) return "Usernames can be at most 32 characters.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Use lowercase letters, numbers, dots, dashes and underscores; start and end with a letter or number.";
  }
  return null;
}

/** @returns an error message, or null when valid */
export function validateEmail(email: string): string | null {
  if (!email) return "Enter an email address.";
  if (email.length > 254) return "That email address is too long.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

// =============================================================================
// Accounts
// =============================================================================

const USER_COLUMNS = `id, email, username, displayName, passwordHash, role,
                      createdAt, updatedAt, lastLoginAt`;

/** How many accounts exist. Drives the first-run setup screen. */
export function countUsers(): number {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  return row.n;
}

export function getUserById(id: string): User | null {
  const row = sqlite
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  return row ? stripHash(row) : null;
}

/** Look up by username OR email — sign-in accepts either. */
function findUserRowByIdentifier(identifier: string): UserRow | undefined {
  const value = identifier.trim().toLowerCase();
  if (!value) return undefined;
  return sqlite
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = ? OR email = ? LIMIT 1`,
    )
    .get(value, value) as UserRow | undefined;
}

/**
 * Drop the hash on the way out.
 *
 * Written as an explicit field list rather than a rest-destructure so that a
 * column added to `users` later is not silently carried into every API
 * response — a new secret would have to be added here on purpose.
 */
function stripHash(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * Create an account.
 *
 * The first account created on an instance is always an admin, and claims
 * every unowned row — which is how an existing single-user database keeps its
 * contacts when its owner finally makes an account.
 */
export async function createUser(input: {
  email: unknown;
  username: unknown;
  password: unknown;
  displayName?: unknown;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  const emailError = validateEmail(email);
  if (emailError) throw new ValidationError(emailError);
  const usernameError = validateUsername(username);
  if (usernameError) throw new ValidationError(usernameError);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new ValidationError(passwordError);

  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim().slice(0, 100)
      : null;

  // Checked before hashing so a duplicate fails fast, and re-checked by the
  // UNIQUE constraint below — this read is a nicer error message, not the
  // guarantee. The insert is what actually enforces it.
  assertIdentifiersFree(email, username, null);

  const passwordHash = await hashPassword(input.password as string);
  const id = crypto.randomUUID();
  // First account is the admin. Reading the count and inserting inside one
  // transaction keeps two concurrent setup requests from both seeing zero.
  const created = sqlite.transaction(() => {
    const isFirst = countUsers() === 0;
    try {
      sqlite
        .prepare(
          `INSERT INTO users (id, email, username, displayName, passwordHash, role)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          email,
          username,
          displayName,
          passwordHash,
          isFirst ? "admin" : "member",
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          "That username or email address is already taken.",
        );
      }
      throw err;
    }
    if (isFirst) claimUnownedData(id);
    return getUserById(id)!;
  })();

  log.info(
    "Auth",
    `Created ${created.role} account "${created.username}" (${created.id})`,
  );
  return created;
}

/**
 * Verify credentials.
 *
 * @returns the user on success, null on any failure — a wrong password and an
 *   unknown username are indistinguishable to the caller on purpose, so the
 *   login response cannot be used to enumerate accounts.
 */
export async function verifyCredentials(
  identifier: string,
  password: unknown,
): Promise<User | null> {
  const row = findUserRowByIdentifier(identifier);
  if (typeof password !== "string" || !password) return null;

  if (!row) {
    // Hash anyway. Without this, "unknown user" returns in microseconds while
    // "wrong password" takes ~100ms, and that difference is enough to
    // enumerate which accounts exist.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;

  // Transparently upgrade hashes made with older cost parameters.
  if (needsRehash(row.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      sqlite
        .prepare(
          `UPDATE users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(upgraded, row.id);
      log.info("Auth", `Upgraded password hash for "${row.username}"`);
    } catch (err) {
      // A failed upgrade must not fail the sign-in — the old hash still works.
      log.warn("Auth", `Password hash upgrade failed: ${String(err)}`);
    }
  }

  sqlite
    .prepare(`UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(row.id);

  return stripHash(row);
}

/**
 * A syntactically valid hash of a password nobody has, used to spend the same
 * ~100ms on an unknown username as on a real one. Generated once at module
 * load with the current cost parameters.
 */
const DUMMY_HASH =
  "scrypt$65536$8$1$" +
  crypto.randomBytes(16).toString("base64") +
  "$" +
  crypto.randomBytes(64).toString("base64");

/** Update the mutable profile fields. Any subset may be supplied. */
export async function updateUser(
  id: string,
  input: { email?: unknown; username?: unknown; displayName?: unknown },
): Promise<User> {
  const current = getUserById(id);
  if (!current) throw new AppError("Account not found", 404);

  const updates: Record<string, string | null> = {};

  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    const error = validateEmail(email);
    if (error) throw new ValidationError(error);
    if (email !== current.email) updates.email = email;
  }
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    const error = validateUsername(username);
    if (error) throw new ValidationError(error);
    if (username !== current.username) updates.username = username;
  }
  if (input.displayName !== undefined) {
    const displayName =
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim().slice(0, 100)
        : null;
    if (displayName !== current.displayName) updates.displayName = displayName;
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) return current;

  assertIdentifiersFree(
    (updates.email as string) ?? current.email,
    (updates.username as string) ?? current.username,
    id,
  );

  const assignments = keys.map((k) => `${k} = ?`).join(", ");
  try {
    sqlite
      .prepare(
        `UPDATE users SET ${assignments}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(...keys.map((k) => updates[k]), id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        "That username or email address is already taken.",
      );
    }
    throw err;
  }

  return getUserById(id)!;
}

/**
 * Change a password, verifying the current one first.
 *
 * Every other session is revoked on success. That is the behaviour people
 * expect from a password change — if you are changing it because you think
 * someone else has it, leaving their session alive defeats the point.
 *
 * @param keepSessionId session to preserve (the one making the request)
 */
export async function changePassword(
  id: string,
  currentPassword: unknown,
  newPassword: unknown,
  keepSessionId: string | null,
): Promise<void> {
  const row = sqlite
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  if (!row) throw new AppError("Account not found", 404);

  const ok =
    typeof currentPassword === "string" &&
    (await verifyPassword(currentPassword, row.passwordHash));
  if (!ok) {
    throw new AppError("That is not your current password.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }

  const error = validatePassword(newPassword);
  if (error) throw new ValidationError(error);

  const hash = await hashPassword(newPassword as string);
  sqlite
    .prepare(
      `UPDATE users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(hash, id);

  revokeOtherSessions(id, keepSessionId);
  log.info("Auth", `Password changed for "${row.username}"`);
}

/** Throw a ConflictError if the email/username belongs to a different account. */
function assertIdentifiersFree(
  email: string,
  username: string,
  exceptUserId: string | null,
): void {
  const clash = sqlite
    .prepare(
      `SELECT id FROM users WHERE (email = ? OR username = ?) AND id IS NOT ? LIMIT 1`,
    )
    .get(email, username, exceptUserId) as { id: string } | undefined;
  if (clash) {
    throw new ConflictError("That username or email address is already taken.");
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

// =============================================================================
// Sessions
// =============================================================================
//
// The cookie holds a 32-byte random secret. The database holds only its
// SHA-256, so the table is useless to anyone who reads it — including anyone
// who finds one of the seven rotating backups this app keeps on disk.
//
// SHA-256 with no salt or stretching is the right call here, unlike for
// passwords: the input is already 256 bits of uniform randomness, so there is
// no dictionary to attack and nothing for a slow KDF to buy.
// =============================================================================

/** Hash a session secret into its database key. */
function sessionKey(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * Create a session for `userId`.
 *
 * @returns the secret to put in the cookie — the only time it exists in
 *   plaintext anywhere.
 */
export function createSession(
  userId: string,
  userAgent?: string | null,
): { secret: string; expiresAt: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  sqlite
    .prepare(
      `INSERT INTO sessions (id, userId, expiresAt, userAgent)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      sessionKey(secret),
      userId,
      expiresAt,
      userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
    );

  return { secret, expiresAt };
}

/**
 * Resolve a cookie secret to its user, or null when the session is unknown,
 * expired, or belongs to a deleted account.
 *
 * Refreshes `lastSeenAt` at most once an hour — the sessions list wants to
 * know roughly when a device was last used, and writing on every request
 * would mean a database write per API call for no benefit.
 */
export function resolveSession(
  secret: string,
): { user: User; sessionId: string } | null {
  if (!secret) return null;
  const id = sessionKey(secret);

  const row = sqlite
    .prepare(`SELECT userId, expiresAt, lastSeenAt FROM sessions WHERE id = ?`)
    .get(id) as
    { userId: string; expiresAt: string; lastSeenAt: string } | undefined;
  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    sqlite.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return null;
  }

  const user = getUserById(row.userId);
  if (!user) {
    // Account deleted out from under the session (FK cascade should prevent
    // this, but a session with no user must not authenticate anybody).
    sqlite.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    return null;
  }

  const lastSeen = new Date(row.lastSeenAt).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60 * 60 * 1000) {
    sqlite
      .prepare(
        `UPDATE sessions SET lastSeenAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(id);
  }

  return { user, sessionId: id };
}

/** End one session. Safe to call with a secret that no longer resolves. */
export function destroySession(secret: string): void {
  if (!secret) return;
  sqlite.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionKey(secret));
}

/** List a user's live sessions, newest first. */
export function listSessions(
  userId: string,
  currentSessionId: string | null,
): SessionInfo[] {
  const rows = sqlite
    .prepare(
      `SELECT id, createdAt, expiresAt, lastSeenAt, userAgent
         FROM sessions
        WHERE userId = ? AND expiresAt > datetime('now')
        ORDER BY lastSeenAt DESC`,
    )
    .all(userId) as Omit<SessionInfo, "current">[];
  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
}

/**
 * Revoke every session for a user except `keepSessionId`.
 *
 * @returns how many were revoked
 */
export function revokeOtherSessions(
  userId: string,
  keepSessionId: string | null,
): number {
  const result = sqlite
    .prepare(`DELETE FROM sessions WHERE userId = ? AND id IS NOT ?`)
    .run(userId, keepSessionId);
  return result.changes;
}

// =============================================================================
// Ownership
// =============================================================================

/**
 * Assign every unowned row to `userId`.
 *
 * This is what makes "I have been using Contrack without an account and now I
 * made one" keep its data: rows written before any account existed have a NULL
 * `ownerId`, and this claims them. It runs on account creation and again at
 * boot, because anything written while signed out (an API token client, a
 * background job) also lands unowned.
 *
 * Idempotent — after the first run the WHERE clause matches nothing.
 *
 * @returns rows claimed, per table
 */
export function claimUnownedData(userId: string): Record<string, number> {
  const claimed: Record<string, number> = {};
  const claimAll = sqlite.transaction(() => {
    for (const table of OWNED_TABLES) {
      const result = sqlite
        .prepare(`UPDATE ${table} SET ownerId = ? WHERE ownerId IS NULL`)
        .run(userId);
      if (result.changes > 0) claimed[table] = result.changes;
    }
  });
  claimAll();

  const total = Object.values(claimed).reduce((a, b) => a + b, 0);
  if (total > 0) {
    const detail = Object.entries(claimed)
      .map(([table, n]) => `${n} ${table}`)
      .join(", ");
    log.info("Auth", `Claimed ${detail} for account ${userId}`);
  }
  return claimed;
}

/**
 * Boot-time ownership reconcile.
 *
 * Only acts when there is exactly one account — with none there is nobody to
 * claim for, and with several, guessing an owner is precisely the wrong move.
 * Once multi-tenancy lands this becomes a no-op and can be deleted.
 */
export function reconcileOwnership(): void {
  if (countUsers() !== 1) return;
  const row = sqlite.prepare(`SELECT id FROM users LIMIT 1`).get() as {
    id: string;
  };
  claimUnownedData(row.id);
}

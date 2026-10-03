// =============================================================================
// The local owner and the primary admin
// =============================================================================
// Moved from server/db.ts (§2z-4), with the connection as a parameter. The
// baseline migration creates the local owner, and the auth code asks for both
// at runtime through the wrappers in server/db.ts.
// =============================================================================

import type Database from "better-sqlite3";
import crypto from "crypto";
import { log } from "../utils/logger.ts";

function countUsers(sqlite: Database.Database): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM users`).get() as {
    n: number;
  };
  return row.n;
}

/**
 * The admin that machine credentials and instance-wide work act as.
 *
 * Throws only if called before ensureLocalOwner has ever run, which the boot
 * order makes impossible.
 */
export function primaryAdminId(sqlite: Database.Database): string {
  const row = sqlite
    .prepare(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'
       ORDER BY createdAt ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!row) throw new Error("No active admin account exists");
  return row.id;
}

/**
 * The account that owns this device's data when nobody has signed in.
 *
 * `passwordHash = 'none$'` can never verify: parseHash splits on `$`, returns
 * null unless it gets six parts, and this has two. Nobody can sign in as this
 * account. It is an admin because in auth-off mode the person at the keyboard
 * is the operator.
 *
 * On an instance that already has real accounts this creates nothing and
 * returns the primary admin, so an upgrade never invents a second owner.
 */
export function ensureLocalOwner(sqlite: Database.Database): string {
  const existing = sqlite
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existing) return existing.id;
  if (countUsers(sqlite) > 0) return primaryAdminId(sqlite);

  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, displayName, passwordHash, role, credentialState)
       VALUES (?, 'local@contrack.local', 'local', 'This device', 'none$', 'admin', 'none')`,
    )
    .run(id);
  log.info("Database", `Created the local owner account (${id})`);
  return id;
}

// =============================================================================
// Two-user test harness
// =============================================================================
// Phase 2 proves isolation, and isolation cannot be proven with one account.
// Every test in the matrix needs two real users with real sessions and real
// rows, created the way production creates them, so this builds them once.
//
// `seedOwner` deliberately goes through the public API rather than inserting
// rows directly. A row written by hand would carry whatever ownerId the test
// chose, which proves nothing. A row written through POST /api/contacts is
// stamped by the same code path a browser hits, so the assertion is about the
// product and not about the fixture.
// =============================================================================

import request from "supertest";
import type http from "http";
import { ensureLocalOwner, sqlite } from "../../../server/db.ts";
import * as authService from "../../../server/services/authService.ts";
import { __resetAuthRateLimits } from "../../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../../server/middleware/auth.ts";
import { scopeForOwnerId, type Scope } from "../../../server/tenancy/scope.ts";

export interface Actor {
  user: { id: string; email: string; username: string };
  cookie: string[];
  scope: Scope;
}

export interface Seeded {
  contactIds: string[];
  listIds: string[];
  interactionIds: string[];
  actionItemIds: string[];
}

interface ActorOverrides {
  email?: string;
  username?: string;
  password?: string;
  displayName?: string;
}

const DEFAULT_PASSWORD = "correct horse battery staple";
let actorCount = 0;

function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

function hasAnyUser(): boolean {
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };
  return row.n > 0;
}

/**
 * Create an account and sign it in.
 *
 * The first actor goes through POST /api/auth/setup, which is the only way to
 * create the first admin. Later actors are created with authService.createUser
 * and then signed in, because setup refuses to run twice.
 */
export async function createActor(
  app: http.Server,
  overrides: ActorOverrides = {},
): Promise<Actor> {
  actorCount += 1;
  const creds = {
    email: overrides.email ?? `actor${actorCount}@example.com`,
    username: overrides.username ?? `actor${actorCount}`,
    password: overrides.password ?? DEFAULT_PASSWORD,
    displayName: overrides.displayName ?? `Actor ${actorCount}`,
  };

  // The credential endpoints share one fixed window across the whole file.
  // Creating several actors trips it, and a tripped limiter returns 429 with
  // no Set-Cookie, which surfaces later as a baffling 401.
  __resetAuthRateLimits();

  if (!hasAnyUser()) {
    const res = await request(app).post("/api/auth/setup").send(creds);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(
        `createActor: setup failed with ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    const user = res.body?.user ?? res.body;
    return {
      user: { id: user.id, email: creds.email, username: creds.username },
      cookie: cookieFrom(res),
      scope: scopeForOwnerId(user.id),
    };
  }

  const created = await authService.createUser(creds);
  __resetAuthRateLimits();
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier: creds.username, password: creds.password });
  if (res.status !== 200) {
    throw new Error(
      `createActor: login failed with ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return {
    user: { id: created.id, email: creds.email, username: creds.username },
    cookie: cookieFrom(res),
    scope: scopeForOwnerId(created.id),
  };
}

/** Attach an actor's session to a supertest request. */
export function asUser(actor: Actor) {
  return (req: request.Test): request.Test => req.set("Cookie", actor.cookie);
}

/**
 * Create rows for an actor through the public API, so every row is stamped
 * exactly the way production stamps it.
 */
export async function seedOwner(
  app: http.Server,
  actor: Actor,
  shape: {
    contacts: number;
    interactions?: number;
    lists?: number;
    actionItems?: number;
  },
): Promise<Seeded> {
  const auth = asUser(actor);
  const out: Seeded = {
    contactIds: [],
    listIds: [],
    interactionIds: [],
    actionItemIds: [],
  };

  for (let i = 0; i < shape.contacts; i++) {
    const res = await auth(
      request(app)
        .post("/api/contacts")
        .send({
          name: `${actor.user.username} Contact ${i}`,
          company: `Company ${i}`,
        }),
    );
    if (res.status !== 201) {
      throw new Error(`seedOwner: contact ${i} failed with ${res.status}`);
    }
    out.contactIds.push(res.body.id);
  }

  for (let i = 0; i < (shape.lists ?? 0); i++) {
    const res = await auth(
      request(app)
        .post("/api/lists")
        .send({ name: `${actor.user.username} List ${i}` }),
    );
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`seedOwner: list ${i} failed with ${res.status}`);
    }
    out.listIds.push(res.body.id);
  }

  const target = out.contactIds[0];
  for (let i = 0; target && i < (shape.interactions ?? 0); i++) {
    const res = await auth(
      request(app)
        .post(`/api/contacts/${target}/interactions`)
        .send({ type: "note", title: `Note ${i}` }),
    );
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`seedOwner: interaction ${i} failed with ${res.status}`);
    }
    out.interactionIds.push(res.body.id);
  }

  for (let i = 0; target && i < (shape.actionItems ?? 0); i++) {
    const res = await auth(
      request(app)
        .post(`/api/contacts/${target}/action-items`)
        .send({ title: `Task ${i}`, dueAt: "2027-01-01" }),
    );
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`seedOwner: action item ${i} failed with ${res.status}`);
    }
    out.actionItemIds.push(res.body.id);
  }

  return out;
}

/**
 * The local owner account id.
 *
 * Every instance has one from boot (server/db.ts §2z-4), and the
 * `contacts_owner_required` trigger refuses an insert without an owner. A test
 * that writes a contact with raw SQL has to name an owner, and with auth off
 * this is the same account the API would have stamped.
 */
export function localOwnerId(): string {
  const row = sqlite
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (!row) throw new Error("No local owner account exists");
  return row.id;
}

/** How many rows in `table` belong to `ownerId`. */
export function rowsOwnedBy(table: string, ownerId: string): number {
  // tenant-lint: allow derived table
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId = ?`)
    .get(ownerId) as { n: number };
  return row.n;
}

/**
 * Remove every account and every owned row.
 *
 * Order matters. `users` is referenced with ON DELETE RESTRICT, so the owned
 * rows have to go first or the delete fails. Phase 1 changes this to keep or
 * recreate the permanent local owner (see 06-phase-1-storage.md, task 1.13).
 */
export function resetAccounts(): void {
  // The owned rows go first: `users` is referenced with ON DELETE RESTRICT, so
  // deleting an account that still owns a contact fails. Since Phase 1 the
  // local owner owns every row written with auth off, which is why a plain
  // DELETE FROM users no longer works on its own.
  sqlite.exec(`
    DELETE FROM dedupe_merge_log;
    DELETE FROM dedupe_exclusions;
    DELETE FROM dedupe_suggestions;
    DELETE FROM ai_invocations;
    DELETE FROM action_items;
    DELETE FROM interactions;
    DELETE FROM lists;
    DELETE FROM contacts;
    DELETE FROM sessions;
    DELETE FROM api_tokens;
    DELETE FROM users;
  `);
  // Put the local owner back. Boot created it once, and every later test in
  // the file needs it: with auth off attachPrincipal has no principal without
  // it, and every direct INSERT needs an owner to name.
  ensureLocalOwner();
  __resetAuthWarnings();
  actorCount = 0;
  __resetAuthRateLimits();
}

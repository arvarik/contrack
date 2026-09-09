// =============================================================================
// Integration Tests — ownership stamping
// =============================================================================
// Phase 0 does not scope any read. What it does do is stop the hole getting
// deeper: from this phase on, a row written by a signed-in caller carries that
// caller's id from the moment it is created, so Phase 1 has less to backfill
// and Phase 2 has something true to filter on.
//
// Auth is switched on inside this file rather than at boot, because the
// acceptance criterion is that stamping starts working WITHOUT a restart.
// isAuthRequired() reads process.env on every call, so flipping it here is
// the real thing and not a fixture.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Mentions are AI driven, and integration runs with no provider configured, so
// the real extractor always returns nothing and no ghost is ever created. The
// stub returns one unknown name and records an AI invocation on the way, which
// puts both writes inside the request's async context. That is the point of
// the test: the context has to survive setTimeout, an await, and a
// transaction before either insert happens.
vi.mock("../../server/ai/aiService.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../../server/ai/aiService.ts")>();
  const { recordInvocation } =
    await import("../../server/services/aiStatsService.ts");
  return {
    ...actual,
    extractMentions: async (text: string) => {
      recordInvocation({
        operation: "mentions",
        model: "mock",
        tokenCount: 1,
        latencyMs: 1,
        cached: false,
        description: "stamping test",
      });
      return text.includes("Ghostly McGhostface")
        ? [{ name: "Ghostly McGhostface", company: "Nowhere", context: "test" }]
        : [];
    },
  };
});

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");

const app = makeTestApp();
let actor: Awaited<ReturnType<typeof createActor>>;

const ownerOf = (table: string, id: string): string | null | undefined =>
  (
    sqlite.prepare(`SELECT ownerId FROM ${table} WHERE id = ?`).get(id) as
      { ownerId: string | null } | undefined
  )?.ownerId;

beforeAll(async () => {
  resetAccounts();
  // Auth on, at runtime, with no restart.
  process.env.AUTH_REQUIRED = "true";
  actor = await createActor(app);
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  resetAccounts();
});

describe("ownership stamping with auth on", () => {
  it("stamps a contact with the signed-in user's id", async () => {
    const res = await asUser(actor)(
      request(app).post("/api/contacts").send({ name: "Stamped Contact" }),
    );
    expect(res.status).toBe(201);
    expect(ownerOf("contacts", res.body.id)).toBe(actor.user.id);
  });

  it("stamps every contact from a bulk import", async () => {
    const res = await asUser(actor)(
      request(app)
        .post("/api/contacts/bulk")
        .send([{ name: "Bulk One" }, { name: "Bulk Two" }]),
    );
    expect([200, 201]).toContain(res.status);

    const unowned = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts WHERE name LIKE 'Bulk %' AND (ownerId IS NULL OR ownerId != ?)",
      )
      .get(actor.user.id) as { n: number };
    expect(unowned.n).toBe(0);
  });

  it("stamps a list", async () => {
    const res = await asUser(actor)(
      request(app).post("/api/lists").send({ name: "Stamped List" }),
    );
    expect([200, 201]).toContain(res.status);
    expect(ownerOf("lists", res.body.id)).toBe(actor.user.id);
  });

  it("stamps a ghost contact created by mention extraction", async () => {
    const contact = await asUser(actor)(
      request(app).post("/api/contacts").send({ name: "Note Author" }),
    );
    expect(contact.status).toBe(201);

    // Mention extraction is guarded by DISABLE_BACKGROUND_JOBS, which the
    // integration setup turns on for the whole project. Flip it for this one
    // request and put it straight back, so no other fire-and-forget work in
    // this file outlives the test.
    const previous = process.env.DISABLE_BACKGROUND_JOBS;
    process.env.DISABLE_BACKGROUND_JOBS = "";
    let res;
    try {
      res = await asUser(actor)(
        request(app)
          .post(`/api/contacts/${contact.body.id}/interactions`)
          .send({
            type: "note",
            title: "Deal chat",
            content: "Spoke with Ghostly McGhostface about the deal",
          }),
      );
    } finally {
      process.env.DISABLE_BACKGROUND_JOBS = previous;
    }
    expect([200, 201]).toContain(res.status);

    // Extraction is fire and forget behind a setTimeout, so wait for the row.
    let ghost: { id: string; ownerId: string | null } | undefined;
    for (let i = 0; i < 50 && !ghost; i++) {
      await new Promise((r) => setTimeout(r, 20));
      ghost = sqlite
        .prepare("SELECT id, ownerId FROM contacts WHERE name = ?")
        .get("Ghostly McGhostface") as
        { id: string; ownerId: string | null } | undefined;
    }

    expect(ghost, "the ghost contact was never created").toBeTruthy();
    // The context survived setTimeout, an await, and a transaction.
    expect(ghost?.ownerId).toBe(actor.user.id);
  });

  it("stamps an AI invocation recorded during a request", async () => {
    const row = sqlite
      .prepare(
        "SELECT ownerId FROM ai_invocations WHERE operation = 'mentions' ORDER BY createdAt DESC LIMIT 1",
      )
      .get() as { ownerId: string | null } | undefined;

    expect(row, "no AI invocation was recorded").toBeTruthy();
    expect(row?.ownerId).toBe(actor.user.id);
  });

  it("stamps a merge log row from the surviving contact, not the caller", async () => {
    const a = await asUser(actor)(
      request(app).post("/api/contacts").send({ name: "Merge Primary" }),
    );
    const b = await asUser(actor)(
      request(app).post("/api/contacts").send({ name: "Merge Duplicate" }),
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const res = await asUser(actor)(
      request(app)
        .post("/api/contacts/merge")
        .send({ primaryId: a.body.id, duplicateId: b.body.id }),
    );
    expect([200, 201]).toContain(res.status);

    const row = sqlite
      .prepare(
        "SELECT ownerId FROM dedupe_merge_log WHERE primaryId = ? ORDER BY mergedAt DESC LIMIT 1",
      )
      .get(a.body.id) as { ownerId: string | null } | undefined;

    expect(row, "no merge log row was written").toBeTruthy();
    expect(row?.ownerId).toBe(actor.user.id);
  });
});

describe("ownership stamping with no context", () => {
  // Phase 0 wrote NULL here, because with no account guaranteed to exist there
  // was nobody to name. Phase 1 forbids NULL with a trigger and creates the
  // local owner on every instance, so a background write now lands on the
  // primary admin instead of aborting. Phase 2 wraps jobs in runWithContext,
  // which is what stops a multi-user instance reaching this path at all.
  it("falls back to the primary admin rather than aborting on the required trigger", async () => {
    const { recordInvocation } =
      await import("../../server/services/aiStatsService.ts");
    const { primaryAdminId } = await import("../../server/db.ts");

    expect(() =>
      recordInvocation({
        operation: "rerank",
        model: "mock",
        tokenCount: 1,
        latencyMs: 1,
        cached: false,
        description: "no context",
      }),
    ).not.toThrow();

    const row = sqlite
      .prepare(
        "SELECT ownerId FROM ai_invocations WHERE description = 'no context' LIMIT 1",
      )
      .get() as { ownerId: string | null } | undefined;

    expect(row).toBeTruthy();
    expect(row?.ownerId).toBe(primaryAdminId());
  });

  it("refuses an insert into an owned table with no owner at all", () => {
    // The invariant this phase buys. Without the trigger a forgotten stamp is
    // a silent NULL that no test notices until Phase 2 filters on it.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO contacts (id, name) VALUES ('no-owner', 'Nobody')",
        )
        .run(),
    ).toThrow(/contacts.ownerId is required/);
  });
});

// =============================================================================
// The two-user harness itself
// =============================================================================
// Phase 1's contract says the harness can create a second account through
// authService.createUser and sign it in. Phase 2 builds every isolation test
// on that, so it is worth proving here rather than discovering it is broken
// in the first PR that needs it.
// =============================================================================

describe("two-user harness", () => {
  it("creates a second signed-in account whose rows are stamped to it", async () => {
    const { seedOwner, rowsOwnedBy } = await import("./tenancy/helpers.ts");

    const second = await createActor(app);
    expect(second.user.id).not.toBe(actor.user.id);
    expect(second.cookie.length).toBeGreaterThan(0);
    expect(second.scope.ownerId).toBe(second.user.id);

    // The session really works: an authenticated route answers for B.
    const me = await asUser(second)(request(app).get("/api/auth/me"));
    expect(me.status).toBe(200);

    const before = rowsOwnedBy("contacts", second.user.id);
    const seeded = await seedOwner(app, second, {
      contacts: 2,
      lists: 1,
      interactions: 1,
      actionItems: 1,
    });

    expect(seeded.contactIds).toHaveLength(2);
    expect(seeded.listIds).toHaveLength(1);
    expect(seeded.interactionIds).toHaveLength(1);
    expect(seeded.actionItemIds).toHaveLength(1);

    // Everything seedOwner wrote belongs to B, and none of it to A.
    expect(rowsOwnedBy("contacts", second.user.id)).toBe(before + 2);
    expect(rowsOwnedBy("lists", second.user.id)).toBe(1);
    for (const id of seeded.contactIds) {
      expect(ownerOf("contacts", id)).toBe(second.user.id);
    }
  });
});

// Integration: ownership stamping.
// A row written by a signed-in caller carries that caller's id from the
// moment it is created.
//
// Auth is switched on inside this file, not at boot, because stamping must
// work without a restart. isAuthRequired() reads process.env on every call,
// so flipping it here is the real thing.

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
        "SELECT ownerId FROM ai_invocations WHERE operation = 'mentions' ORDER BY createdAt DESC, rowid DESC LIMIT 1",
      )
      .get() as { ownerId: string | null } | undefined;

    expect(row, "no AI invocation was recorded").toBeTruthy();
    expect(row?.ownerId).toBe(actor.user.id);
  });
});

describe("ownership stamping with no context", () => {
  // A trigger forbids NULL, and every instance has a local owner, so a
  // background write with no context lands on the primary admin instead of
  // aborting. Jobs run in runWithContext, so a multi-user instance does not
  // reach this path.
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
    // Without the trigger a forgotten stamp is a silent NULL that no read
    // filter would ever match.
    expect(() =>
      sqlite
        .prepare(
          "INSERT INTO contacts (id, name) VALUES ('no-owner', 'Nobody')",
        )
        .run(),
    ).toThrow(/contacts.ownerId is required/);
  });
});

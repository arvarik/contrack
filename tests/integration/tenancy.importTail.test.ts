// =============================================================================
// Integration Tests — the bulk-import tail keeps the importer's scope
// =============================================================================
// The non-stream import answers the client and then keeps working: it embeds
// the new contacts, waits for the writes to settle, and runs a dedupe check
// over each one. That second half starts from a timer, long after the response
// has been sent, so nothing about the request is still in scope by then.
//
// Both halves are wrapped in runWithContext with the scope captured at the top
// of the handler. This file reads the owner off the AI invocation rows they
// write, because an invocation row is exactly what the attribution is for.
//
// Measured while writing this: AsyncLocalStorage already survives the timer,
// so the rows carry the importer with or without the wrapper. The wrapper
// makes the scope an explicit argument rather than something inherited by
// luck, and this test pins the outcome rather than the mechanism.
//
// The two imports run at the same time on purpose. One shared module-level
// queue drains both tails, and the assertion that each owner's row carries
// that owner is what a shared queue would break.
//
// The stubs stand in for a provider: with none configured the real functions
// return immediately and record nothing at all.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../../server/services/dedupe/embeddings.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/dedupe/embeddings.ts")
    >();
  const { recordInvocation } =
    await import("../../server/services/aiStatsService.ts");
  return {
    ...actual,
    generateAndStoreBulkEmbeddings: async (ids: string[]) => {
      recordInvocation({
        operation: "bulkParse",
        model: "mock",
        tokenCount: 1,
        latencyMs: 1,
        cached: false,
        description: "import tail: embeddings",
      });
      return ids.length;
    },
  };
});

vi.mock("../../server/services/dedupe/index.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/dedupe/index.ts")
    >();
  const { recordInvocation } =
    await import("../../server/services/aiStatsService.ts");
  return {
    ...actual,
    dedupeService: {
      ...actual.dedupeService,
      incrementalDedupeCheck: async () => {
        recordInvocation({
          operation: "parse",
          model: "mock",
          tokenCount: 1,
          latencyMs: 1,
          cached: false,
          description: "import tail: dedupe",
        });
      },
    },
  };
});

// Fifty milliseconds instead of three seconds. Read at module load in the
// route, so it has to be set before the route file is imported.
process.env.IMPORT_SETTLE_MS = "50";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");

const app = makeTestApp();
let alice: Awaited<ReturnType<typeof createActor>>;
let bob: Awaited<ReturnType<typeof createActor>>;

/** Every AI invocation with this description, and who it is attributed to. */
function ownersOf(description: string): (string | null)[] {
  return (
    sqlite
      .prepare("SELECT ownerId FROM ai_invocations WHERE description = ?")
      .all(description) as { ownerId: string | null }[]
  ).map((r) => r.ownerId);
}

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  alice = await createActor(app, { username: "alice" });
  bob = await createActor(app, { username: "bob" });
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  delete process.env.IMPORT_SETTLE_MS;
  resetAccounts();
});

describe("POST /api/contacts/bulk, the work that outlives the response", () => {
  it("attributes both halves of the tail to the importer that started it", async () => {
    const [a, b] = await Promise.all([
      asUser(alice)(
        request(app)
          .post("/api/contacts/bulk")
          .send([{ name: "Alice Import" }]),
      ),
      asUser(bob)(
        request(app)
          .post("/api/contacts/bulk")
          .send([{ name: "Bob Import" }]),
      ),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // The embedding half runs before the response returns to the caller.
    expect(ownersOf("import tail: embeddings").sort()).toEqual(
      [alice.user.id, bob.user.id].sort(),
    );

    // The dedupe half starts from a timer, after the settle delay, with both
    // owners' work in flight at once.
    await vi.waitFor(
      () => expect(ownersOf("import tail: dedupe")).toHaveLength(2),
      { timeout: 4000, interval: 25 },
    );
    expect(ownersOf("import tail: dedupe").sort()).toEqual(
      [alice.user.id, bob.user.id].sort(),
    );
  });
});

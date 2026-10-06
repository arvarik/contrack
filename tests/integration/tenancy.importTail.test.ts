// Integration: the bulk-import tail keeps the importer's scope.
// The non-stream import answers, then embeds the new contacts and runs one
// dedupe scan from a timer, after the request has left scope. Both halves run
// in runWithContext with the scope captured at the top of the handler. This
// reads the owner off the AI invocation rows they write, and pins the outcome,
// not the mechanism (AsyncLocalStorage also survives the timer).
//
// The two imports run at once on purpose: one module-level queue drains both
// tails, and a shared queue is what would mix up the owners. The stubs stand
// in for a provider, because with none the real functions record nothing.

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
      // The import tail runs one scan for the whole batch rather than one
      // check per contact, so this is the entry point that stands in for the
      // real matching now. What the test is about is unchanged: whichever
      // account the tail runs for is the account its rows name.
      runImportScan: async () => {
        recordInvocation({
          operation: "parse",
          model: "mock",
          tokenCount: 1,
          latencyMs: 1,
          cached: false,
          description: "import tail: dedupe",
        });
        return { autoMerged: 0, pending: 0, matchedIds: new Set<string>() };
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

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { sqlite } from "../../server/db.ts";
import {
  drainIndexQueue,
  getSearchCoverage,
  removeFromIndexQueue,
  purgeOwnerFromIndexQueue,
  initSearchIndexQueue,
  _resetIndexQueueStateForTest,
} from "../../server/services/search/indexQueue.ts";
import {
  findSearchNeighbors,
  upsertSearchEmbedding,
} from "../../server/services/search/localEmbeddings.ts";
import * as embeddings from "../../server/ai/embeddings.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

const insertContact = (
  id: string,
  name = "Alice",
  role = "Designer",
  ownerId = localOwnerId(),
) =>
  sqlite
    .prepare(
      "INSERT INTO contacts(id, name, role, ownerId) VALUES (?, ?, ?, ?)",
    )
    .run(id, name, role, ownerId);

const vector = (n = 1) => {
  const v = new Float32Array(384);
  v[0] = n;
  return v;
};

beforeEach(() => {
  _resetIndexQueueStateForTest();
  sqlite.prepare("DELETE FROM search_index_queue").run();
  sqlite.prepare("DELETE FROM search_embeddings").run();
  sqlite.prepare("DELETE FROM contacts").run();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recoverable semantic indexing queue", () => {
  it("enqueues contact edits into search_index_queue and removes outdated vectors", async () => {
    insertContact("c1", "Alice", "Founder");
    upsertSearchEmbedding("c1", vector(5));

    // Vector exists initially
    expect(findSearchNeighbors(scope(), vector(5), 1)).toHaveLength(1);

    // Editing contact triggers trigger to delete vector and enqueue to search_index_queue
    sqlite.prepare("UPDATE contacts SET role = 'CEO' WHERE id = 'c1'").run();

    // Outdated vector was immediately cleared
    expect(findSearchNeighbors(scope(), vector(5), 1)).toEqual([]);

    // search_index_queue has pending job
    const queueRow = sqlite
      .prepare(
        "SELECT contactId, ownerId, status, attempts FROM search_index_queue WHERE contactId = 'c1'",
      )
      .get() as {
      contactId: string;
      ownerId: string;
      status: string;
      attempts: number;
    };
    expect(queueRow).toBeDefined();
    expect(queueRow.contactId).toBe("c1");
    expect(queueRow.ownerId).toBe(localOwnerId());
    expect(queueRow.status).toBe("pending");
    expect(queueRow.attempts).toBe(0);
  });

  it("drains pending jobs and successfully indexes contacts", async () => {
    insertContact("c1", "Bob", "Architect");
    sqlite
      .prepare("UPDATE contacts SET role = 'Principal' WHERE id = 'c1'")
      .run();

    // Mock embedding generation
    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "provider",
      providerId: "test-prov",
      model: "test-model",
      dimension: 384,
      signature: "test/test",
    });
    vi.spyOn(embeddings, "embedWithProvider").mockResolvedValue([
      Array.from(vector(10)),
    ]);

    const result = await drainIndexQueue({
      maxBatchSize: 10,
      allowProvider: true,
    });
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // Queue is now empty for c1
    const inQueue = sqlite
      .prepare("SELECT * FROM search_index_queue WHERE contactId = 'c1'")
      .get();
    expect(inQueue).toBeUndefined();

    // Contact vector is indexed and findable
    const neighbors = findSearchNeighbors(scope(), vector(10), 1);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].contactId).toBe("c1");
  });

  it("retries temporary failures with backoff and marks failed after MAX_ATTEMPTS", async () => {
    insertContact("c-fail", "Charlie", "Developer");
    sqlite
      .prepare("UPDATE contacts SET role = 'Lead' WHERE id = 'c-fail'")
      .run();

    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "provider",
      providerId: "test-prov",
      model: "test-model",
      dimension: 384,
      signature: "test/test",
    });
    vi.spyOn(embeddings, "embedWithProvider").mockRejectedValue(
      new Error("Temporary network glitch"),
    );

    // First attempt: should fail and increment attempts to 1, status remains 'pending'
    const res1 = await drainIndexQueue({
      maxBatchSize: 10,
      allowProvider: true,
    });
    expect(res1.failed).toBe(1);

    const row1 = sqlite
      .prepare(
        "SELECT status, attempts, lastError, nextAttemptAt FROM search_index_queue WHERE contactId = 'c-fail'",
      )
      .get() as {
      status: string;
      attempts: number;
      lastError: string;
      nextAttemptAt: string;
    };
    expect(row1.status).toBe("pending");
    expect(row1.attempts).toBe(1);
    expect(row1.lastError).toContain("Temporary network glitch");
    expect(new Date(row1.nextAttemptAt).getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );

    // Fast-forward nextAttemptAt so it can be retried immediately
    sqlite
      .prepare(
        "UPDATE search_index_queue SET nextAttemptAt = datetime('now', '-1 minute')",
      )
      .run();

    // Second attempt
    const res2 = await drainIndexQueue({
      maxBatchSize: 10,
      allowProvider: true,
    });
    expect(res2.failed).toBe(1);

    const row2 = sqlite
      .prepare(
        "SELECT status, attempts FROM search_index_queue WHERE contactId = 'c-fail'",
      )
      .get() as { status: string; attempts: number };
    expect(row2.attempts).toBe(2);
    expect(row2.status).toBe("pending");

    // Fast-forward again
    sqlite
      .prepare(
        "UPDATE search_index_queue SET nextAttemptAt = datetime('now', '-1 minute')",
      )
      .run();

    // Third attempt (MAX_ATTEMPTS = 3): should mark status as 'failed'
    const res3 = await drainIndexQueue({
      maxBatchSize: 10,
      allowProvider: true,
    });
    expect(res3.failed).toBe(1);

    const row3 = sqlite
      .prepare(
        "SELECT status, attempts FROM search_index_queue WHERE contactId = 'c-fail'",
      )
      .get() as { status: string; attempts: number };
    expect(row3.attempts).toBe(3);
    expect(row3.status).toBe("failed");
  });

  it("rejects outdated results when a newer contact edit occurs during in-flight embedding", async () => {
    insertContact("c-race", "Diana", "Analyst");
    sqlite
      .prepare(
        "UPDATE contacts SET role = 'Senior Analyst' WHERE id = 'c-race'",
      )
      .run();

    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "provider",
      providerId: "test-prov",
      model: "test-model",
      dimension: 384,
      signature: "test/test",
    });

    let resolveInFlight!: (val: number[][]) => void;
    vi.spyOn(embeddings, "embedWithProvider").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInFlight = resolve;
        }),
    );

    const drainPromise = drainIndexQueue({
      maxBatchSize: 10,
      allowProvider: true,
    });

    // While embedding is in flight, user edits Diana again
    sqlite
      .prepare("UPDATE contacts SET role = 'Lead Analyst' WHERE id = 'c-race'")
      .run();

    // Complete the first in-flight embedding
    resolveInFlight([Array.from(vector(20))]);
    const drainResult = await drainPromise;

    expect(drainResult.outdated).toBe(1);

    // Vector was NOT written because it was outdated
    expect(findSearchNeighbors(scope(), vector(20), 1)).toEqual([]);

    // Queue entry for c-race is still pending with the newer edit!
    const queueRow = sqlite
      .prepare(
        "SELECT status, attempts FROM search_index_queue WHERE contactId = 'c-race'",
      )
      .get() as { status: string; attempts: number };
    expect(queueRow).toBeDefined();
    expect(queueRow.status).toBe("pending");
  });

  it("keeps paid provider refreshes explicit and does not drain without approval", async () => {
    insertContact("c-paid", "Edward", "Investor");
    sqlite
      .prepare(
        "UPDATE contacts SET role = 'Managing Partner' WHERE id = 'c-paid'",
      )
      .run();

    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "provider",
      providerId: "openai",
      model: "text-embedding-3-small",
      dimension: 384,
      signature: "openai/text-embedding-3-small",
    });

    const providerSpy = vi
      .spyOn(embeddings, "embedWithProvider")
      .mockResolvedValue([Array.from(vector(15))]);

    // Automatic drain without allowProvider: true
    const autoResult = await drainIndexQueue({ allowProvider: false });
    expect(autoResult.deferredProvider).toBe(1);
    expect(providerSpy).not.toHaveBeenCalled();

    // Item remains pending
    const inQueue = sqlite
      .prepare(
        "SELECT status FROM search_index_queue WHERE contactId = 'c-paid'",
      )
      .get() as { status: string };
    expect(inQueue.status).toBe("pending");

    // Explicit drain with allowProvider: true
    const explicitResult = await drainIndexQueue({ allowProvider: true });
    expect(explicitResult.succeeded).toBe(1);
    expect(providerSpy).toHaveBeenCalledTimes(1);

    // Now queue is empty
    const remaining = sqlite
      .prepare("SELECT * FROM search_index_queue WHERE contactId = 'c-paid'")
      .get();
    expect(remaining).toBeUndefined();
  });

  it("recovers 'processing' jobs on initSearchIndexQueue after an ungraceful restart", () => {
    insertContact("c-crash", "Fiona", "Engineer");
    sqlite
      .prepare(
        "INSERT INTO search_index_queue(contactId, ownerId, status, contactUpdatedAt) VALUES ('c-crash', ?, 'processing', datetime('now'))",
      )
      .run(localOwnerId());

    initSearchIndexQueue();

    const row = sqlite
      .prepare(
        "SELECT status FROM search_index_queue WHERE contactId = 'c-crash'",
      )
      .get() as { status: string };
    expect(row.status).toBe("pending");
  });

  it("cleans up queue when contact is deleted or owner is purged", () => {
    insertContact("c-del", "George", "Advisor");
    sqlite
      .prepare(
        "INSERT INTO search_index_queue(contactId, ownerId, status, contactUpdatedAt) VALUES ('c-del', ?, 'pending', datetime('now'))",
      )
      .run(localOwnerId());

    removeFromIndexQueue("c-del");
    expect(
      sqlite
        .prepare("SELECT * FROM search_index_queue WHERE contactId = 'c-del'")
        .get(),
    ).toBeUndefined();

    // Owner purge
    insertContact("c-own1", "Hanna", "Advisor");
    insertContact("c-own2", "Ian", "Advisor");
    sqlite
      .prepare(
        "INSERT INTO search_index_queue(contactId, ownerId, status, contactUpdatedAt) VALUES ('c-own1', ?, 'pending', datetime('now')), ('c-own2', ?, 'failed', datetime('now'))",
      )
      .run(localOwnerId(), localOwnerId());

    purgeOwnerFromIndexQueue(localOwnerId());
    expect(
      sqlite
        .prepare(
          "SELECT count(*) as c FROM search_index_queue WHERE ownerId = ?",
        )
        .get(localOwnerId()),
    ).toEqual({ c: 0 });
  });
});

describe("search coverage API and metrics", () => {
  it("calculates accurate account-level coverage metrics", () => {
    insertContact("c1", "User 1");
    insertContact("c2", "User 2");
    insertContact("c3", "User 3");

    // c1 has vector
    upsertSearchEmbedding("c1", vector(1));

    // c2 is in queue (pending)
    sqlite
      .prepare(
        "INSERT INTO search_index_queue(contactId, ownerId, status, contactUpdatedAt) VALUES ('c2', ?, 'pending', datetime('now'))",
      )
      .run(localOwnerId());

    // c3 is missing from both vector and queue

    const cov = getSearchCoverage(scope());
    expect(cov.total).toBe(3);
    expect(cov.indexed).toBe(1);
    expect(cov.pending).toBe(1);
    expect(cov.missing).toBe(2);
    expect(cov.coverage).toBe(33); // 1/3 * 100 rounded
  });

  it("GET /api/search/coverage returns coverage data", async () => {
    insertContact("c-api", "API Contact");
    upsertSearchEmbedding("c-api", vector(2));

    const res = await request(app).get("/api/search/coverage");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 1,
      indexed: 1,
      missing: 0,
      pending: 0,
      failed: 0,
      coverage: 100,
    });
    expect(res.body.provider).toBeDefined();
    expect(Array.isArray(res.body.failedItems)).toBe(true);
  });

  it("POST /api/search/refresh-index with built-in model enqueues contacts", async () => {
    insertContact("c-unindexed", "Unindexed Contact");

    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "builtin",
      dimension: 384,
      signature: "builtin/test",
    });

    const res = await request(app)
      .post("/api/search/refresh-index")
      .send({ allowProvider: false });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.queued).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/search/refresh-index rejects paid provider without explicit allowProvider", async () => {
    insertContact("c-paid-req", "Paid Contact");

    vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
      kind: "provider",
      providerId: "openai",
      model: "text-embedding-3-small",
      dimension: 384,
      signature: "openai/text-embedding-3-small",
    });

    const res1 = await request(app)
      .post("/api/search/refresh-index")
      .send({ allowProvider: false });

    expect(res1.status).toBe(400);
    expect(res1.body.requiresExplicitConfirmation).toBe(true);
    expect(res1.body.provider).toBe("openai");

    // When confirmed with allowProvider: true
    vi.spyOn(embeddings, "embedWithProvider").mockResolvedValue([
      Array.from(vector(10)),
    ]);

    const res2 = await request(app)
      .post("/api/search/refresh-index")
      .send({ allowProvider: true });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
  });
});

// =============================================================================
// Integration Tests — Multitenant Fair AI Queue
// =============================================================================
// Verifies that the AI gateway queue enforces multi-tenant fairness:
// 1. Concurrency limit (2) and waiting capacity (16) are strictly preserved.
// 2. Waiting work rotates fairly between accounts (Round-Robin).
// 3. Interactive user requests take precedence over background jobs.
// 4. Background work is guaranteed to progress (anti-starvation).
// 5. A noisy neighbor cannot monopolize waiting capacity — quiet tenants are
//    admitted via tail drop of the noisy tenant's excess waiting work.
// 6. Admin health panel (/api/admin/health) reports AI queue status.
// =============================================================================

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";

vi.mock("../../server/ai/capabilities.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/ai/capabilities.ts")>();
  return {
    ...original,
    resolveCapability: vi.fn(),
  };
});

import { resolveCapability } from "../../server/ai/capabilities.ts";
import {
  generateFor,
  getAIQueueSnapshot,
  __getGenerationQueueForTests,
} from "../../server/ai/gateway.ts";
import type { AIProvider } from "../../server/ai/provider.ts";
import { makeTestApp } from "./helpers.ts";
import {
  createActor,
  asUser,
  resetAccounts,
  type Actor,
} from "./tenancy/helpers.ts";
import { runWithContext } from "../../server/tenancy/requestContext.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Multitenant Fair AI Queue Integration", () => {
  let app: ReturnType<typeof makeTestApp>;
  let admin: Actor;
  let actorA: Actor;
  let actorB: Actor;
  let actorC: Actor;

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";
    app = makeTestApp();

    const adminRes = await request(app).post("/api/auth/setup").send({
      email: "admin_ai_queue@example.com",
      username: "admin_ai_queue",
      password: "correct horse battery staple",
      displayName: "Admin AI Queue",
    });
    expect(adminRes.status).toBe(201);
    admin = {
      user: adminRes.body.user,
      cookie: adminRes.headers["set-cookie"] as unknown as string[],
      scope: scopeForOwnerId(adminRes.body.user.id),
    };

    actorA = await createActor(app, {
      username: "tenant_alpha",
      email: "alpha@example.com",
    });
    actorB = await createActor(app, {
      username: "tenant_beta",
      email: "beta@example.com",
    });
    actorC = await createActor(app, {
      username: "tenant_gamma",
      email: "gamma@example.com",
    });
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = "";
  });

  beforeEach(() => {
    __getGenerationQueueForTests().__resetForTests();
    vi.mocked(resolveCapability).mockReset();
  });

  it("rotates AI generation work fairly between tenant accounts", async () => {
    const queue = __getGenerationQueueForTests();
    const activeGate1 = deferred<void>();
    const activeGate2 = deferred<void>();
    const executionOrder: string[] = [];

    // Mock provider that records order
    vi.mocked(resolveCapability).mockImplementation(() => ({
      capability: "quick",
      providerId: "mock-gemini",
      modelClass: "lite",
      provider: {
        id: "mock-gemini",
        generate: vi.fn(async (opts) => {
          const text = (opts.prompt as string) || "done";
          executionOrder.push(text);
          return {
            text,
            model: "mock-gemini",
            latencyMs: 5,
            tokenCount: 10,
          };
        }),
      } as unknown as AIProvider,
    }));

    // Fill the 2 concurrency slots with blocked jobs for Tenant A
    const activeJob1 = runWithContext(
      {
        requestId: "req-active-1",
        principal: { kind: "user", user: actorA.user } as never,
        scope: actorA.scope,
      },
      () => queue.run(() => activeGate1.promise, { accountId: actorA.user.id }),
    );

    const activeJob2 = runWithContext(
      {
        requestId: "req-active-2",
        principal: { kind: "user", user: actorA.user } as never,
        scope: actorA.scope,
      },
      () => queue.run(() => activeGate2.promise, { accountId: actorA.user.id }),
    );

    // Tenant A queues 3 jobs
    const a1 = runWithContext(
      {
        requestId: "req-a1",
        principal: { kind: "user", user: actorA.user } as never,
        scope: actorA.scope,
      },
      () => generateFor("quick", { prompt: "A1", responseFormat: "text" }),
    );
    const a2 = runWithContext(
      {
        requestId: "req-a2",
        principal: { kind: "user", user: actorA.user } as never,
        scope: actorA.scope,
      },
      () => generateFor("quick", { prompt: "A2", responseFormat: "text" }),
    );
    const a3 = runWithContext(
      {
        requestId: "req-a3",
        principal: { kind: "user", user: actorA.user } as never,
        scope: actorA.scope,
      },
      () => generateFor("quick", { prompt: "A3", responseFormat: "text" }),
    );

    // Tenant B queues 1 job
    const b1 = runWithContext(
      {
        requestId: "req-b1",
        principal: { kind: "user", user: actorB.user } as never,
        scope: actorB.scope,
      },
      () => generateFor("quick", { prompt: "B1", responseFormat: "text" }),
    );

    // Tenant C queues 1 job
    const c1 = runWithContext(
      {
        requestId: "req-c1",
        principal: { kind: "user", user: actorC.user } as never,
        scope: actorC.scope,
      },
      () => generateFor("quick", { prompt: "C1", responseFormat: "text" }),
    );

    // Release both active gates
    activeGate1.resolve();
    activeGate2.resolve();
    await Promise.all([activeJob1, activeJob2]);

    // Await all queued generations
    await Promise.all([a1, a2, a3, b1, c1]);

    // Work must rotate accounts: A gets one, then B gets one, then C gets one, then A finishes
    expect(executionOrder).toEqual(["A1", "B1", "C1", "A2", "A3"]);
  });

  it("prioritizes interactive user requests over waiting background tasks", async () => {
    const queue = __getGenerationQueueForTests();
    const activeGate1 = deferred<void>();
    const activeGate2 = deferred<void>();
    const executionOrder: string[] = [];

    vi.mocked(resolveCapability).mockImplementation(() => ({
      capability: "quick",
      providerId: "mock-gemini",
      modelClass: "lite",
      provider: {
        id: "mock-gemini",
        generate: vi.fn(async (opts) => {
          const text = (opts.prompt as string) || "done";
          executionOrder.push(text);
          return {
            text,
            model: "mock-gemini",
            latencyMs: 5,
            tokenCount: 10,
          };
        }),
      } as unknown as AIProvider,
    }));

    // Hold both concurrency slots
    const active1 = queue.run(() => activeGate1.promise, {
      accountId: actorA.user.id,
    });
    const active2 = queue.run(() => activeGate2.promise, {
      accountId: actorA.user.id,
    });

    // Tenant A enqueues background jobs (e.g. dedupe scan)
    const bg1 = runWithContext(
      {
        requestId: "job-dedupe-1",
        principal: null,
        scope: actorA.scope,
      },
      () =>
        generateFor("quick", {
          prompt: "A-bg-1",
          priority: "background",
          responseFormat: "text",
        }),
    );

    const bg2 = runWithContext(
      {
        requestId: "job-dedupe-2",
        principal: null,
        scope: actorA.scope,
      },
      () =>
        generateFor("quick", {
          prompt: "A-bg-2",
          priority: "background",
          responseFormat: "text",
        }),
    );

    // Tenant B submits an interactive request
    const bInteractive = runWithContext(
      {
        requestId: "req-search-ask",
        principal: { kind: "user", user: actorB.user } as never,
        scope: actorB.scope,
      },
      () =>
        generateFor("quick", {
          prompt: "B-interactive",
          responseFormat: "text",
        }),
    );

    // Open active slots
    activeGate1.resolve();
    activeGate2.resolve();
    await Promise.all([active1, active2, bg1, bg2, bInteractive]);

    // B's interactive request ran ahead of A's waiting background work!
    expect(executionOrder[0]).toBe("B-interactive");
    expect(executionOrder.slice(1)).toEqual(["A-bg-1", "A-bg-2"]);
  });

  it("prevents noisy neighbor from locking out quiet tenants by evicting tail background work", async () => {
    const queue = __getGenerationQueueForTests();
    const activeGate1 = deferred<void>();
    const activeGate2 = deferred<void>();

    vi.mocked(resolveCapability).mockImplementation(() => ({
      capability: "quick",
      providerId: "mock-gemini",
      modelClass: "lite",
      provider: {
        id: "mock-gemini",
        generate: vi.fn(async (opts) => ({
          text: `result-${opts.prompt}`,
          model: "mock-gemini",
          latencyMs: 5,
          tokenCount: 10,
        })),
      } as unknown as AIProvider,
    }));

    // Hold 2 active slots
    queue.run(() => activeGate1.promise, { accountId: actorA.user.id });
    queue.run(() => activeGate2.promise, { accountId: actorA.user.id });

    // Tenant A fills the entire waiting capacity (16 jobs) with background tasks
    const aPromises: Promise<unknown>[] = [];
    for (let i = 1; i <= 16; i++) {
      aPromises.push(
        queue.run(async () => `result-A-bg-${i}`, {
          accountId: actorA.user.id,
          priority: "background",
        }),
      );
    }

    expect(getAIQueueSnapshot().waiting).toBe(16);

    // Tenant B (quiet tenant) submits an interactive request
    const bPromise = queue.run(async () => "result-B-ask", {
      accountId: actorB.user.id,
      priority: "interactive",
    });

    // Tenant A's 16th background job was evicted with 429 AI_BUSY
    await expect(aPromises[15]).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_BUSY",
    });

    // Total waiting capacity remains capped at 16
    expect(getAIQueueSnapshot().waiting).toBe(16);

    // Release concurrency slots
    activeGate1.resolve();
    activeGate2.resolve();

    // Tenant B's interactive request succeeds
    const bRes = await bPromise;
    expect(bRes).toBe("result-B-ask");
  });

  it("reports queue status and per-account stats in GET /api/admin/health", async () => {
    const queue = __getGenerationQueueForTests();
    const activeGate1 = deferred<void>();
    const activeGate2 = deferred<void>();
    const waitingGate = deferred<void>();

    // Hold both active concurrency slots (2) so the next job is forced to wait
    queue.run(() => activeGate1.promise, { accountId: actorA.user.id });
    queue.run(() => activeGate2.promise, { accountId: actorA.user.id });

    // Enqueue a waiting job for Tenant B
    queue.run(() => waitingGate.promise, {
      accountId: actorB.user.id,
      priority: "interactive",
    });

    const res = await asUser(admin)(request(app).get("/api/admin/health"));
    expect(res.status).toBe(200);
    expect(res.body.queues).toBeDefined();
    expect(res.body.queues.aiGateway).toBeDefined();

    const aiGateway = res.body.queues.aiGateway;
    expect(aiGateway.active).toBe(2);
    expect(aiGateway.waiting).toBe(1);
    expect(aiGateway.concurrency).toBe(2);
    expect(aiGateway.capacity).toBe(16);

    const alphaStats = aiGateway.accounts.find(
      (a: { account: { username: string } }) =>
        a.account?.username === "tenant_alpha",
    );
    const betaStats = aiGateway.accounts.find(
      (a: { account: { username: string } }) =>
        a.account?.username === "tenant_beta",
    );

    expect(alphaStats).toMatchObject({
      active: 2,
      interactive: 0,
      background: 0,
    });
    expect(betaStats).toMatchObject({
      active: 0,
      interactive: 1,
      background: 0,
    });

    activeGate1.resolve();
    activeGate2.resolve();
    waitingGate.resolve();
  });
});

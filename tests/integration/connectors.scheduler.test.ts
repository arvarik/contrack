/**
 * tests/integration/connectors.scheduler.test.ts — Integration tests for connector scheduler.
 *
 * Covers:
 * - Due selection (picks active connectors with nextRunAt <= now, ignores future/paused)
 * - One per owner per tick (throttles single owner with multiple due connectors)
 * - Global concurrency cap (CONNECTOR_SYNC_CONCURRENCY)
 * - AbortSignal propagation on scheduler shutdown
 */

import crypto from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { sqlite } from "../../server/db.ts";
import { registerAdapter } from "../../server/connectors/registry.ts";
import {
  tickScheduler,
  stopConnectorScheduler,
  getSchedulerState,
  startSync,
} from "../../server/connectors/scheduler.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import type {
  ConnectorAdapter,
  SyncContext,
  SyncEvent,
} from "../../server/connectors/types.ts";
import type { ConnectorKind } from "../../shared/connectors.ts";
import { z } from "zod";

describe("Connectors Scheduler", () => {
  const mockKind = "mock-sched";
  const executedConnectorIds: string[] = [];
  let signalReceivedAbort = false;
  let _slowSyncResolver: (() => void) | null = null;
  let hungResolver: (() => void) | null = null;

  const mockAdapter: ConnectorAdapter<Record<string, unknown>, unknown> = {
    kind: mockKind as unknown as ConnectorKind,
    label: "Scheduler Mock Adapter",
    description: "Mock for testing scheduler",
    capabilities: { schedule: true },
    configSchema: z.record(z.string(), z.unknown()),
    secretSchema: null,
    async test() {
      return { ok: true, detail: "ok" };
    },
    async *sync(
      ctx: SyncContext<Record<string, unknown>, unknown>,
    ): AsyncGenerator<SyncEvent, unknown, void> {
      executedConnectorIds.push((ctx.config?.connId as string) || "unknown");

      if (ctx.config?.hangs) {
        // A call that never answers and never hears the abort.
        await new Promise<void>((resolve) => {
          hungResolver = resolve;
        });
      }

      if (ctx.config?.isSlow) {
        // Wait until signaled or aborted
        await new Promise<void>((resolve) => {
          _slowSyncResolver = resolve;
          ctx.signal.addEventListener("abort", () => {
            signalReceivedAbort = true;
            resolve();
          });
        });
      }

      yield {
        kind: "interaction",
        externalId: `sched-${crypto.randomUUID()}`,
        type: "meeting",
        title: "Sched Event",
        date: "2026-02-01T10:00:00Z",
        participants: [],
      };
      return null;
    },
  };

  const owner1 = "sched-owner-1-" + crypto.randomUUID().slice(0, 8);
  const owner2 = "sched-owner-2-" + crypto.randomUUID().slice(0, 8);

  beforeAll(() => {
    registerAdapter(
      mockAdapter as unknown as ConnectorAdapter<unknown, unknown>,
    );
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')",
      )
      .run(owner1, `${owner1}@example.com`, owner1);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')",
      )
      .run(owner2, `${owner2}@example.com`, owner2);
  });

  afterAll(async () => {
    await stopConnectorScheduler();
    sqlite
      .prepare("DELETE FROM connector_runs WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite
      .prepare("DELETE FROM connector_links WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite
      .prepare("DELETE FROM upcoming_events WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite
      .prepare("DELETE FROM connectors WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite.prepare("DELETE FROM users WHERE id IN (?, ?)").run(owner1, owner2);
  });

  beforeEach(() => {
    executedConnectorIds.length = 0;
    signalReceivedAbort = false;
    _slowSyncResolver = null;
    delete process.env.CONNECTOR_SYNC_CONCURRENCY;
    sqlite
      .prepare("DELETE FROM connector_runs WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite
      .prepare("DELETE FROM connectors WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
  });

  afterEach(async () => {
    await stopConnectorScheduler();
  });

  /** A connector of the mock kind. Due a minute ago unless told otherwise. */
  function connector(
    config: Record<string, unknown> = {},
    {
      owner = owner1,
      status = "active",
      nextRunAt = new Date(Date.now() - 60_000).toISOString(),
    } = {},
  ): string {
    const id = "conn-" + crypto.randomUUID().slice(0, 8);
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Conn', ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        owner,
        mockKind,
        status,
        JSON.stringify({ connId: id, ...config }),
        nextRunAt,
      );
    return id;
  }

  it("due selection: selects active connectors due for sync and ignores future or paused connectors", async () => {
    const dueId = connector();
    const futureId = connector(
      {},
      {
        owner: owner2,
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    );
    // Paused, and due. It belongs to owner2, whose only other connector is
    // not due: under owner1 the one-per-owner rule would skip it even
    // without the status check.
    const pausedId = connector({}, { owner: owner2, status: "paused" });

    await tickScheduler();

    // Give asynchronous tick task a moment to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(executedConnectorIds).toContain(dueId);
    expect(executedConnectorIds).not.toContain(futureId);
    expect(executedConnectorIds).not.toContain(pausedId);
  });

  it("one per owner per tick: throttles multiple due connectors for the same owner", async () => {
    const connA = connector();
    const connB = connector();

    // Tick 1
    await tickScheduler();
    await new Promise((r) => setTimeout(r, 100));

    // Only one should have run during tick 1!
    expect(executedConnectorIds).toHaveLength(1);
    const firstRun = executedConnectorIds[0];
    const secondExpected = firstRun === connA ? connB : connA;

    // Tick 2: now the second one gets its turn
    await tickScheduler();
    await new Promise((r) => setTimeout(r, 100));

    expect(executedConnectorIds).toHaveLength(2);
    expect(executedConnectorIds).toContain(secondExpected);
  });

  it("concurrency cap: respects CONNECTOR_SYNC_CONCURRENCY", async () => {
    process.env.CONNECTOR_SYNC_CONCURRENCY = "1";
    connector();
    connector({}, { owner: owner2 });

    await tickScheduler();
    await new Promise((r) => setTimeout(r, 100));

    // Concurrency is 1, so only 1 should have run in this tick!
    expect(executedConnectorIds).toHaveLength(1);
  });

  it("shutdown: aborts in-flight sync passes when scheduler is stopped", async () => {
    const slowConn = connector({ isSlow: true });

    // Launch scheduler
    await tickScheduler();

    // Wait until slow sync begins running
    await new Promise((r) => setTimeout(r, 50));
    expect(executedConnectorIds).toContain(slowConn);

    // Stop scheduler while slow sync is in flight
    await stopConnectorScheduler();

    expect(signalReceivedAbort).toBe(true);
    expect(getSchedulerState().running).toBe(false);
  });

  it("a sync that hangs past its deadline gives its slots back", async () => {
    connector({ hangs: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await tickScheduler();
      await vi.advanceTimersByTimeAsync(10);
      expect(getSchedulerState().activeRunsCount).toBe(1);
      // Two hours, then thirty seconds of grace.
      await vi.advanceTimersByTimeAsync(2 * 60 * 60_000 + 30_000);
      expect(getSchedulerState()).toMatchObject({
        activeRunsCount: 0,
        activeOwnersCount: 0,
      });
    } finally {
      vi.useRealTimers();
      hungResolver?.();
    }
  });

  it("a sync started by hand holds the lock, so a second start or a tick waits", async () => {
    const id = connector({ isSlow: true });
    const scope = scopeForOwnerId(owner1);
    const first = startSync(scope, { id, ownerId: owner1 }, "manual");
    expect(first).not.toBeNull();
    expect(startSync(scope, { id, ownerId: owner1 }, "manual")).toBeNull();
    await tickScheduler();
    await new Promise((r) => setTimeout(r, 50));
    expect(executedConnectorIds).toEqual([id]);
    _slowSyncResolver?.();
    await first;
  });
});

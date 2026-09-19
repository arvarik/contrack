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
} from "vitest";
import { sqlite } from "../../server/db.ts";
import { registerAdapter } from "../../server/connectors/registry.ts";
import {
  tickScheduler,
  stopConnectorScheduler,
  getSchedulerState,
} from "../../server/connectors/scheduler.ts";
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

  it("due selection: selects active connectors due for sync and ignores future or paused connectors", async () => {
    const dueId = "conn-due-" + crypto.randomUUID().slice(0, 8);
    const futureId = "conn-future-" + crypto.randomUUID().slice(0, 8);
    const pausedId = "conn-paused-" + crypto.randomUUID().slice(0, 8);

    const now = Date.now();
    const pastIso = new Date(now - 10 * 60 * 1000).toISOString();
    const futureIso = new Date(now + 60 * 60 * 1000).toISOString();

    // 1. Due active connector
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Due Connector', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(dueId, owner1, mockKind, JSON.stringify({ connId: dueId }), pastIso);

    // 2. Future active connector (not due)
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Future Connector', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        futureId,
        owner2,
        mockKind,
        JSON.stringify({ connId: futureId }),
        futureIso,
      );

    // 3. Paused connector (past nextRunAt, but status is paused)
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Paused Connector', 'paused', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        pausedId,
        owner1,
        mockKind,
        JSON.stringify({ connId: pausedId }),
        pastIso,
      );

    await tickScheduler();

    // Give asynchronous tick task a moment to complete
    await new Promise((r) => setTimeout(r, 100));

    expect(executedConnectorIds).toContain(dueId);
    expect(executedConnectorIds).not.toContain(futureId);
    expect(executedConnectorIds).not.toContain(pausedId);
  });

  it("one per owner per tick: throttles multiple due connectors for the same owner", async () => {
    const connA = "conn-a-" + crypto.randomUUID().slice(0, 8);
    const connB = "conn-b-" + crypto.randomUUID().slice(0, 8);

    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Insert two due connectors for owner1
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Conn A', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(connA, owner1, mockKind, JSON.stringify({ connId: connA }), pastIso);

    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Conn B', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(connB, owner1, mockKind, JSON.stringify({ connId: connB }), pastIso);

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

    const conn1 = "conn-owner1-" + crypto.randomUUID().slice(0, 8);
    const conn2 = "conn-owner2-" + crypto.randomUUID().slice(0, 8);

    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Owner 1 connector
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Owner 1 Conn', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(conn1, owner1, mockKind, JSON.stringify({ connId: conn1 }), pastIso);

    // Owner 2 connector
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Owner 2 Conn', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(conn2, owner2, mockKind, JSON.stringify({ connId: conn2 }), pastIso);

    await tickScheduler();
    await new Promise((r) => setTimeout(r, 100));

    // Concurrency is 1, so only 1 should have run in this tick!
    expect(executedConnectorIds).toHaveLength(1);
  });

  it("shutdown: aborts in-flight sync passes when scheduler is stopped", async () => {
    const slowConn = "conn-slow-" + crypto.randomUUID().slice(0, 8);
    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, nextRunAt, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Slow Conn', 'active', ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        slowConn,
        owner1,
        mockKind,
        JSON.stringify({ connId: slowConn, isSlow: true }),
        pastIso,
      );

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
});

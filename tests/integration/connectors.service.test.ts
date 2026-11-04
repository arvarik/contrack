/**
 * Integration: the connector run loop writes back only what the run owns.
 *
 * Covers:
 * - A pause and a new interval set while a sync runs survive the run, and a
 *   failing run still records the error
 * - The next run is a whole interval out, and moves up when it gets shorter
 * - Runs a crash left `running` are closed at boot
 */

import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { sqlite } from "../../server/db.ts";
import { registerAdapter } from "../../server/connectors/registry.ts";
import {
  recoverInterruptedRuns,
  runNow,
  updateConnector,
} from "../../server/connectors/service.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import type {
  ConnectorAdapter,
  SyncEvent,
} from "../../server/connectors/types.ts";
import type { ConnectorKind } from "../../shared/connectors.ts";

const kind = "mock-service";
const owner = "service-owner-" + crypto.randomUUID().slice(0, 8);
const scope = scopeForOwnerId(owner);

let onStart: () => void = () => {};
let release: () => void = () => {};
let fail = false;

const adapter: ConnectorAdapter<Record<string, unknown>, unknown> = {
  kind: kind as unknown as ConnectorKind,
  label: "Service Mock",
  description: "Waits until the test releases it",
  capabilities: { schedule: true },
  configSchema: z.record(z.string(), z.unknown()),
  secretSchema: null,
  async test() {
    return { ok: true, detail: "ok" };
  },
  async *sync(): AsyncGenerator<SyncEvent, unknown, void> {
    onStart();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (fail) throw new Error("boom");
    yield { kind: "progress", fetched: 0 };
    return { lastSyncAt: new Date().toISOString() };
  },
};

function connector(intervalMinutes = 30): string {
  const id = "conn-" + crypto.randomUUID().slice(0, 8);
  sqlite
    .prepare(
      `INSERT INTO connectors (id, ownerId, kind, name, status, config, intervalMinutes, attempts, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Conn', 'active', '{}', ?, 0, datetime('now'), datetime('now'))`,
    )
    .run(id, owner, kind, intervalMinutes);
  return id;
}

/**
 * Starts a run and waits until the adapter is inside its sync. Returns the
 * run inside an object: an async function that returned the promise itself
 * would make the caller wait for the whole run.
 */
async function startRun(
  id: string,
): Promise<{ run: ReturnType<typeof runNow> }> {
  const started = new Promise<void>((resolve) => {
    onStart = resolve;
  });
  const run = runNow(scope, id, "manual");
  await Promise.race([
    started,
    run.then((result) => {
      throw new Error(
        `The run ended before the sync started: ${JSON.stringify(result)}`,
      );
    }),
  ]);
  return { run };
}

function row(id: string) {
  return sqlite
    .prepare(
      "SELECT status, nextRunAt, lastError, attempts FROM connectors WHERE id = ?",
    )
    .get(id) as {
    status: string;
    nextRunAt: string;
    lastError: string | null;
    attempts: number;
  };
}

describe("connector runs", () => {
  beforeAll(() => {
    registerAdapter(adapter as unknown as ConnectorAdapter<unknown, unknown>);
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')",
      )
      .run(owner, `${owner}@example.com`, owner);
  });

  afterAll(() => {
    for (const table of ["connector_runs", "connectors"]) {
      sqlite.prepare(`DELETE FROM ${table} WHERE ownerId = ?`).run(owner);
    }
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(owner);
  });

  const minutesAhead = (id: string) =>
    (new Date(row(id).nextRunAt).getTime() - Date.now()) / 60_000;

  it.each([
    ["successful", false],
    ["failing", true],
  ])(
    "keeps a pause and a new interval set during a %s run",
    async (_name, failing) => {
      fail = failing;
      const id = connector(30);
      const { run } = await startRun(id);
      await updateConnector(scope, id, {
        status: "paused",
        intervalMinutes: 240,
      });

      release();
      expect((await run).status).toBe(failing ? "error" : "ok");
      expect(row(id).status).toBe("paused");
      if (failing) {
        expect(row(id)).toMatchObject({ lastError: "boom", attempts: 1 });
      } else {
        expect(minutesAhead(id)).toBeGreaterThan(200);
      }
    },
  );

  it("schedules a successful run a whole interval out, a day for Daily", async () => {
    // The next run shared the backoff's four-hour cap, so a Daily connector
    // synced every four hours.
    fail = false;
    const id = connector(1440);
    const { run } = await startRun(id);
    release();
    expect((await run).status).toBe("ok");
    expect(minutesAhead(id)).toBeGreaterThan(1430);
  });

  it("closes the runs a crash left running, and no run this process started", () => {
    const id = connector();
    const insert = sqlite.prepare(
      `INSERT INTO connector_runs (id, connectorId, ownerId, trigger, status, startedAt)
       VALUES (?, ?, ?, 'schedule', ?, ?)`,
    );
    const stuckId = crypto.randomUUID();
    const doneId = crypto.randomUUID();
    const liveId = crypto.randomUUID();
    insert.run(stuckId, id, owner, "running", "2026-01-01T00:00:00.000Z");
    insert.run(doneId, id, owner, "ok", "2026-01-01T00:00:00.000Z");
    // A sync this process started before the recovery job ran.
    insert.run(liveId, id, owner, "running", new Date().toISOString());

    expect(recoverInterruptedRuns()).toBe(1);

    const read = sqlite.prepare(
      "SELECT status, finishedAt, error FROM connector_runs WHERE id = ?",
    );
    expect(read.get(stuckId)).toEqual({
      status: "error",
      finishedAt: expect.any(String),
      error: "The server restarted during this sync",
    });
    expect(read.get(doneId)).toMatchObject({ status: "ok" });
    expect(read.get(liveId)).toMatchObject({ status: "running" });
  });

  it("moves the next run up when the interval gets shorter", async () => {
    const id = connector(10080);
    const weekAway = new Date(Date.now() + 7 * 86_400_000).toISOString();
    sqlite
      .prepare("UPDATE connectors SET nextRunAt = ? WHERE id = ?")
      .run(weekAway, id);
    await updateConnector(scope, id, { intervalMinutes: 30 });
    expect(minutesAhead(id)).toBeLessThanOrEqual(30);
  });
});

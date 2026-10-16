/**
 * Integration: the connector run loop writes back only what the run owns.
 *
 * Covers:
 * - A pause and a new interval set while a sync runs survive the run
 * - A failing run keeps a pause too, and still records the error
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
    sqlite.prepare("DELETE FROM connector_runs WHERE ownerId = ?").run(owner);
    sqlite.prepare("DELETE FROM connectors WHERE ownerId = ?").run(owner);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(owner);
  });

  it("keeps a pause and a new interval set during a successful run", async () => {
    fail = false;
    const id = connector(30);
    const { run } = await startRun(id);
    await updateConnector(scope, id, {
      status: "paused",
      intervalMinutes: 240,
    });

    release();
    expect((await run).status).toBe("ok");

    const after = row(id);
    expect(after.status).toBe("paused");
    const minutesAhead =
      (new Date(after.nextRunAt).getTime() - Date.now()) / 60_000;
    expect(minutesAhead).toBeGreaterThan(200);
  });

  it("keeps a pause set during a failing run, and still records the error", async () => {
    fail = true;
    const id = connector(30);
    const { run } = await startRun(id);
    await updateConnector(scope, id, { status: "paused" });

    release();
    expect((await run).status).toBe("error");

    const after = row(id);
    expect(after.status).toBe("paused");
    expect(after.lastError).toBe("boom");
    expect(after.attempts).toBe(1);
  });

  it("closes the runs a crash left running", () => {
    const id = connector();
    const insert = sqlite.prepare(
      `INSERT INTO connector_runs (id, connectorId, ownerId, trigger, status, startedAt)
       VALUES (?, ?, ?, 'schedule', ?, '2026-01-01T00:00:00.000Z')`,
    );
    const stuckId = crypto.randomUUID();
    const doneId = crypto.randomUUID();
    insert.run(stuckId, id, owner, "running");
    insert.run(doneId, id, owner, "ok");

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
  });
});

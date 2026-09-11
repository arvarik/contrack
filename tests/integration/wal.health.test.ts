// =============================================================================
// Integration Tests — the write-ahead log is checkpointed, and refusals counted
// =============================================================================
// Every write goes to `curator.db-wal` first. SQLite folds it back once the
// log passes a thousand pages, but only when no reader is still looking at an
// older version of the database, so one long reader holds every checkpoint
// off for as long as it runs. Nothing in this codebase called a checkpoint
// before 2.0.
//
// The database here is real and so is its WAL: the tests write rows, read the
// file off disk, and check that the number went down.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite, ensureLocalOwner } = await import("../../server/db.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { contactService } =
  await import("../../server/services/contactService.ts");
const { dedupeQueue } =
  await import("../../server/services/dedupe/jobQueue.ts");
const { runDailyMaintenance } =
  await import("../../server/services/maintenanceService.ts");
const {
  WAL_TRUNCATE_BYTES,
  __resetWriteHealth,
  checkpoint,
  recordBusyError,
  runWalMaintenance,
  walBytes,
  writeHealth,
} = await import("../../server/services/walHealth.ts");

const app = makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

/** Write enough rows that the WAL is unmistakably not empty. */
async function fillTheWal(): Promise<number> {
  await contactService.bulkCreateContacts(
    scope,
    Array.from({ length: 250 }, (_, i) => ({
      name: `WAL Person ${i}`,
      about: "x".repeat(400),
      emails: [`wal${i}@example.com`],
    })),
  );
  return walBytes();
}

beforeEach(() => {
  __resetWriteHealth();
  dedupeQueue.setProcessing(false);
});

afterEach(() => {
  dedupeQueue.setProcessing(false);
});

describe("the write-ahead log", () => {
  it("is in WAL mode, so there is something to checkpoint", () => {
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("grows when rows are written", async () => {
    checkpoint("truncate");
    const before = walBytes();

    const after = await fillTheWal();

    expect(after).toBeGreaterThan(before);
  });

  it("shrinks when a passive checkpoint runs", async () => {
    await fillTheWal();
    const before = walBytes();
    expect(before).toBeGreaterThan(0);

    const result = checkpoint("passive");

    // PASSIVE folds the pages back but leaves the file at its high-water
    // mark, ready to be written into again. What it moves is the measure.
    expect(result.checkpointedPages).toBeGreaterThan(0);
    expect(result.logPages).toBeGreaterThan(0);
    expect(result.busy).toBe(false);
    expect(result.bytesBefore).toBe(before);
  });

  it("empties the file when a truncating checkpoint runs", async () => {
    await fillTheWal();
    expect(walBytes()).toBeGreaterThan(0);

    const result = checkpoint("truncate");

    expect(result.mode).toBe("truncate");
    expect(result.bytesAfter).toBe(0);
    expect(walBytes()).toBe(0);
  });
});

describe("runWalMaintenance", () => {
  it("runs a passive checkpoint and records it", async () => {
    await fillTheWal();

    const result = runWalMaintenance();

    expect(result?.mode).toBe("passive");
    expect(writeHealth().lastCheckpoint?.mode).toBe("passive");
    expect(writeHealth().lastCheckpoint?.checkpointedPages).toBeGreaterThan(0);
  });

  it("does not truncate a log under the threshold", async () => {
    await fillTheWal();
    // Nowhere near 64 MB. A few hundred contacts is a few hundred kilobytes.
    expect(walBytes()).toBeLessThan(WAL_TRUNCATE_BYTES);

    runWalMaintenance();

    expect(writeHealth().lastCheckpoint?.mode).toBe("passive");
  });

  it("truncates a log over the threshold", async () => {
    await fillTheWal();
    expect(walBytes()).toBeGreaterThan(1024);

    // The threshold is an argument so this can reach the branch without
    // first writing 64 MB. Everything else is the real path.
    const result = runWalMaintenance(1024);

    expect(result?.mode).toBe("truncate");
    expect(result?.bytesAfter).toBe(0);
    expect(walBytes()).toBe(0);
  });

  it("leaves an over-threshold log alone while a scan is running", async () => {
    await fillTheWal();
    const before = walBytes();
    expect(before).toBeGreaterThan(1024);
    dedupeQueue.setProcessing(true);

    const result = runWalMaintenance(1024);

    // A passive checkpoint still runs, because it never waits for anybody.
    // What the scan prevents is the truncating one, which would hold the
    // write lock until the scan finished and queue every writer behind it.
    expect(result?.mode).toBe("passive");
    expect(walBytes()).toBeGreaterThan(0);
  });

  it("is part of the daily sweep", async () => {
    await fillTheWal();

    const counts = runDailyMaintenance();

    expect(counts.walPagesCheckpointed).toBeGreaterThan(0);
    expect(writeHealth().lastCheckpoint).not.toBeNull();
  });

  it("checkpoints even when the row deletes fail", () => {
    // The sweep's deletes and its checkpoint share a schedule and nothing
    // else. A failure in one must not skip the other, and the WAL is the half
    // that grows without a bound.
    sqlite.exec("ALTER TABLE audit_log RENAME TO audit_log_hidden");
    try {
      const counts = runDailyMaintenance();
      expect(counts.auditRows).toBe(0);
      expect(writeHealth().lastCheckpoint).not.toBeNull();
    } finally {
      sqlite.exec("ALTER TABLE audit_log_hidden RENAME TO audit_log");
    }
  });
});

describe("write health", () => {
  it("starts with no refused writes", () => {
    const health = writeHealth();

    expect(health.busyErrors).toBe(0);
    expect(health.lastBusyErrorAt).toBeNull();
    expect(health.truncateAtBytes).toBe(WAL_TRUNCATE_BYTES);
    expect(Date.parse(health.startedAt)).not.toBeNaN();
  });

  it("counts a refused write and remembers when", () => {
    recordBusyError();
    recordBusyError();

    const health = writeHealth();
    expect(health.busyErrors).toBe(2);
    expect(Date.parse(health.lastBusyErrorAt!)).not.toBeNaN();
  });

  it("counts a request the error middleware turned away as busy", async () => {
    // The real middleware, with the error better-sqlite3 throws when it gives
    // up waiting for the write lock. The count belongs here and nowhere else:
    // a lock the driver waited out inside its five second busy timeout is one
    // nobody experienced, and counting it would measure the wrong thing.
    const { errorHandler } =
      await import("../../server/middleware/errorHandler.ts");
    const busy = Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    });
    const sent: { status?: number; body?: { error?: { code?: string } } } = {};
    const res = {
      headersSent: false,
      getHeader: () => undefined,
      setHeader: () => undefined,
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: { error?: { code?: string } }) {
        sent.body = body;
        return this;
      },
    };

    errorHandler(
      busy,
      {
        method: "GET",
        originalUrl: "/api/contacts",
        path: "/api/contacts",
      } as never,
      res as never,
      (() => undefined) as never,
    );

    expect(sent.status).toBe(503);
    expect(sent.body?.error?.code).toBe("DB_BUSY");
    expect(writeHealth().busyErrors).toBe(1);
  });

  it("does not count an ordinary error", async () => {
    await request(app).get("/api/contacts/does-not-exist").expect(404);

    expect(writeHealth().busyErrors).toBe(0);
  });

  it("reports the log's size now", async () => {
    checkpoint("truncate");
    expect(writeHealth().walBytes).toBe(0);

    await fillTheWal();

    expect(writeHealth().walBytes).toBeGreaterThan(0);
  });
});

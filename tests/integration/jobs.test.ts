// Integration: the job runner (server/jobs/runner.ts).
// Background jobs are off, so nothing runs unless the test asks:
//
//   1. runJobNow runs a job in the calling process and records it, and an
//      owner's job runs in that owner's scope.
//   2. A job the last process left `running` is queued again at boot.
//   3. A job that throws is tried again later, and after its last try it
//      ends `failed` with its error.
//   4. Two owners' jobs take turns, whoever queued first.
//
// The poll takes the time as an argument, so a retry an hour out is a call
// with a later clock.

import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sqlite } from "../../server/db.ts";
import { currentScopeOrNull } from "../../server/tenancy/requestContext.ts";
import {
  defineJob,
  enqueueJob,
  pollJobs,
  registerJob,
  runJobNow,
  startJobRunner,
} from "../../server/jobs/runner.ts";

interface JobRow {
  id: string;
  kind: string;
  ownerId: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

const row = (id: string): JobRow =>
  sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow;

/** An account to own jobs. `jobs.ownerId` names a user. */
function owner(name: string): string {
  const id = `${name}-${crypto.randomUUID().slice(0, 8)}`;
  sqlite
    .prepare(
      "INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')",
    )
    .run(id, `${id}@example.com`, id);
  return id;
}

const ownerA = owner("owner-a");
const ownerB = owner("owner-b");

beforeEach(() => {
  sqlite.exec("DELETE FROM jobs");
  delete process.env.JOB_CONCURRENCY;
});

afterAll(() => {
  sqlite.exec("DELETE FROM jobs");
  sqlite.prepare("DELETE FROM users WHERE id IN (?, ?)").run(ownerA, ownerB);
});

describe("runJobNow", () => {
  it("runs a job with background jobs disabled, in its owner's scope, and records it", async () => {
    expect(process.env.DISABLE_BACKGROUND_JOBS).toBe("true");
    const ran: { payload: unknown; scope: string | undefined }[] = [];
    registerJob(
      defineJob<{ n: number }>({
        kind: "test.now",
        run(payload) {
          ran.push({ payload, scope: currentScopeOrNull()?.ownerId });
        },
      }),
    );

    const id = await runJobNow("test.now", { n: 1 }, { ownerId: ownerA });

    expect(ran).toEqual([{ payload: { n: 1 }, scope: ownerA }]);
    expect(row(id)).toMatchObject({
      kind: "test.now",
      ownerId: ownerA,
      status: "done",
      attempts: 1,
      lastError: null,
    });
    expect(row(id).finishedAt).not.toBeNull();
  });
});

describe("a job left running at boot", () => {
  it("is queued again", () => {
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO jobs (id, kind, status, attempts, maxAttempts, runAt, startedAt)
         VALUES (?, 'test.interrupted', 'running', 1, 3, ?, ?)`,
      )
      .run(id, new Date().toISOString(), new Date().toISOString());

    // Boot. Background jobs are off, so the poll does not start, and the
    // row waits in the queue for a process that runs it.
    expect(startJobRunner()).toBe(false);

    expect(row(id)).toMatchObject({ status: "queued", attempts: 1 });
  });
});

describe("a job that throws", () => {
  it("is tried again later, then ends failed with its error", async () => {
    let tries = 0;
    registerJob(
      defineJob({
        kind: "test.fails",
        maxAttempts: 3,
        run() {
          tries += 1;
          throw new Error("the provider said no");
        },
      }),
    );
    const id = enqueueJob("test.fails")!;
    const now = Date.now();

    await pollJobs(now);
    expect(tries).toBe(1);
    expect(row(id)).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "the provider said no",
    });
    // Not at once: the poll a second later leaves it waiting.
    expect(Date.parse(row(id).runAt)).toBeGreaterThan(now + 1_000);
    await pollJobs(now + 1_000);
    expect(tries).toBe(1);

    await pollJobs(now + 60 * 60_000);
    expect(row(id)).toMatchObject({ status: "queued", attempts: 2 });

    await pollJobs(now + 2 * 60 * 60_000);
    expect(tries).toBe(3);
    expect(row(id)).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "the provider said no",
    });
    expect(row(id).finishedAt).not.toBeNull();

    // Failed is the end: nothing runs it again.
    await pollJobs(now + 24 * 60 * 60_000);
    expect(tries).toBe(3);
  });
});

describe("two owners' jobs", () => {
  it("take turns, whoever queued first", async () => {
    process.env.JOB_CONCURRENCY = "1";
    const order: string[] = [];
    registerJob(
      defineJob<{ label: string }>({
        kind: "test.turns",
        run({ label }) {
          order.push(label);
        },
      }),
    );
    // A queues three before B queues one.
    const start = Date.now() - 10_000;
    for (const [label, ownerId, at] of [
      ["a1", ownerA, start],
      ["a2", ownerA, start + 1],
      ["a3", ownerA, start + 2],
      ["b1", ownerB, start + 3],
    ] as const) {
      enqueueJob("test.turns", { label }, { ownerId, runAt: at });
    }

    for (let i = 0; i < 4; i++) await pollJobs();

    expect(order).toEqual(["a1", "b1", "a2", "a3"]);
  });
});

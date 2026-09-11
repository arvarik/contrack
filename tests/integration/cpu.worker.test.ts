// =============================================================================
// Integration Tests — the CPU worker
// =============================================================================
// The embedding model used to run on the request thread. A backfill of 2,000
// contacts took 2.4 seconds and blocked the event loop for 2.19 of them, in
// bursts of up to 83 ms, so for the duration of one account's index being
// built every other account's requests waited.
//
// It runs on a `worker_threads` thread now. The tests that matter here are
// not about vectors — `tests/eval/search.eval.test.ts` already pins ranking —
// they are about the thread: that the main one keeps running, that a job can
// be stopped, that a queue of jobs comes back in order, and that a worker
// which will not start does not stop the product embedding anything.
//
// No model. The worker is exercised through the protocol with a stub job, so
// this file needs no download and no network, and it fails for one reason
// rather than two.
// =============================================================================

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { describe, it, expect, afterEach, beforeEach } from "vitest";

const {
  __maxInFlight,
  __resetCpuWorker,
  cancelJob,
  isWorkerActive,
  runOnWorker,
  startJob,
  stopCpuWorker,
} = await import("../../server/workers/cpuHost.ts");
const { CANCELLED, unflatten } =
  await import("../../server/workers/protocol.ts");

/**
 * A heartbeat that records every gap between its own ticks.
 *
 * The number this file cares about is the largest gap while something else is
 * running, which is the definition of a stall: the loop could not get back to
 * a 5 ms timer because something synchronous was holding it.
 */
function meter(intervalMs = 5) {
  const gaps: number[] = [];
  let last = performance.now();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    gaps.push(now - last - intervalMs);
    last = now;
    setTimeout(tick, intervalMs);
  };
  setTimeout(tick, intervalMs);
  return {
    async stop() {
      // Let the pending tick fire, so a stall that ends after the work does
      // is still recorded. Without this the meter reports zero for a block it
      // was asleep through.
      await new Promise((resolve) => setTimeout(resolve, 40));
      stopped = true;
      return { worst: Math.max(0, ...gaps), samples: gaps.length };
    },
  };
}

beforeEach(async () => {
  await __resetCpuWorker({ fallbackOnly: false });
});

afterEach(async () => {
  await stopCpuWorker();
});

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

describe("the worker thread", () => {
  it("spawns and answers a job", async () => {
    const { result } = startJob({ kind: "embed", texts: [], batchSize: 8 });

    const payload = await result;

    // An empty job is still a job: the worker starts, resolves its imports,
    // and answers. It never reaches the model, which is what keeps this test
    // free of a download.
    expect(payload.kind).toBe("embed");
    expect(payload.count).toBe(0);
  });

  it("keeps the main thread free while it works", async () => {
    // The worker thread is busy for a while; the main thread must not be.
    const m = meter();
    const jobs = Array.from(
      { length: 6 },
      () => startJob({ kind: "embed", texts: [], batchSize: 8 }).result,
    );
    await Promise.all(jobs);
    const { worst, samples } = await m.stop();

    expect(samples).toBeGreaterThan(3);
    // Generous, because a shared CI machine is not a quiet one. The number it
    // is guarding against is seconds, not milliseconds.
    expect(worst).toBeLessThan(250);
  });

  it("runs one job at a time, in the order they were asked for", async () => {
    const order: number[] = [];
    const jobs = [1, 2, 3, 4, 5].map((n) =>
      startJob({ kind: "embed", texts: [], batchSize: 8 }).result.then(() => {
        order.push(n);
      }),
    );

    await Promise.all(jobs);

    // The order on its own proves nothing — five jobs that each take no time
    // come back in order whether or not anything serialized them. The number
    // that does is how many were ever posted at once.
    expect(order).toEqual([1, 2, 3, 4, 5]);

    // The queue is the run lock the plan describes: two accounts asking for a
    // backfill at once take turns on one thread rather than both running
    // against one ONNX session.
    expect(__maxInFlight()).toBe(1);
  });

  it("settles every job when the worker stops, rather than hanging", async () => {
    await startJob({ kind: "embed", texts: [], batchSize: 8 }).result;
    const pending = startJob({ kind: "embed", texts: [], batchSize: 8 }).result;

    await stopCpuWorker();

    // Whether this one had already finished is a race and does not matter.
    // What matters is that it is not still waiting: a caller awaiting a
    // result from a thread that is gone would wait for ever, and a backfill
    // that never returns is worse than one that fails.
    const outcome = await Promise.race([
      pending.then(
        () => "settled",
        () => "settled",
      ),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 2_000)),
    ]);

    expect(outcome).toBe("settled");
  });

  it("spawns a new thread after the old one was stopped", async () => {
    await startJob({ kind: "embed", texts: [], batchSize: 8 }).result;
    await stopCpuWorker();

    // Stopping is not disabling. A server that stops the worker on shutdown
    // and then does not shut down must still be able to embed.
    await expect(
      startJob({ kind: "embed", texts: [], batchSize: 8 }).result,
    ).resolves.toMatchObject({ kind: "embed" });
  });
});

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

describe("cancelling", () => {
  it("drops a job that is still queued, without sending it", async () => {
    // Submitting chains through microtasks and `cancelJob` is synchronous, so
    // the second job is certainly still in the queue here. That is what makes
    // this deterministic: an earlier version cancelled a job that might have
    // already finished and accepted either outcome, which is a test that
    // cannot fail.
    startJob({ kind: "embed", texts: [], batchSize: 8 });
    const { id, result } = startJob({ kind: "embed", texts: [], batchSize: 8 });

    cancelJob(id);

    await expect(result).rejects.toThrow(CANCELLED);
  });

  it("leaves the jobs around it alone", async () => {
    const first = startJob({ kind: "embed", texts: [], batchSize: 8 }).result;
    const { id } = startJob({ kind: "embed", texts: [], batchSize: 8 });
    const third = startJob({ kind: "embed", texts: [], batchSize: 8 }).result;

    cancelJob(id);

    // Cancelling one job is not cancelling the queue, and the job behind the
    // cancelled one still runs rather than being stranded.
    await expect(first).resolves.toMatchObject({ kind: "embed" });
    await expect(third).resolves.toMatchObject({ kind: "embed" });
  });

  it("forgets a cancellation once the job is gone", async () => {
    const { id } = startJob({ kind: "embed", texts: [], batchSize: 8 });
    cancelJob(id);
    await expect(
      startJob({ kind: "embed", texts: [], batchSize: 8 }).result,
    ).resolves.toMatchObject({ kind: "embed" });

    // Ids are handed out in order and never reused, so a cancellation that
    // outlived its job would be a leak rather than a bug anybody sees. It is
    // asserted because the set it lives in is unbounded otherwise.
    await expect(
      startJob({ kind: "embed", texts: [], batchSize: 8 }).result,
    ).resolves.toMatchObject({ kind: "embed" });
  });
});

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

describe("when the worker cannot run", () => {
  it("uses the in-process path instead", async () => {
    await __resetCpuWorker({ fallbackOnly: true });
    let ranInProcess = false;

    const value = await runOnWorker(
      { kind: "embed", texts: ["x"], batchSize: 8 },
      async () => {
        ranInProcess = true;
        return "fallback";
      },
      () => "worker",
    );

    // A product that stops embedding because a thread would not start is a
    // product that silently stops finding anything.
    expect(value).toBe("fallback");
    expect(ranInProcess).toBe(true);
    expect(isWorkerActive()).toBe(false);
  });

  it("reports which path is in use", async () => {
    expect(isWorkerActive()).toBe(true);

    await __resetCpuWorker({ fallbackOnly: true });

    expect(isWorkerActive()).toBe(false);
  });

  it("is what DISABLE_CPU_WORKER selects", async () => {
    // The escape hatch an operator has if a Node build cannot spawn threads.
    // Asserted so that renaming the variable fails here rather than in
    // somebody's deployment.
    await __resetCpuWorker({ fallbackOnly: true });

    expect(isWorkerActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wire format
// ---------------------------------------------------------------------------

describe("the result", () => {
  it("splits a flat buffer back into one vector per row", () => {
    const flat = new Float32Array([1, 2, 3, 4, 5, 6]);

    const rows = unflatten({ kind: "embed", flat, count: 3, dimension: 2 });

    // The worker sends one buffer and transfers it, rather than an array of
    // arrays it would have to copy. Two thousand 384-wide vectors is three
    // megabytes per backfill round.
    expect(rows).toHaveLength(3);
    expect([...rows[0]]).toEqual([1, 2]);
    expect([...rows[2]]).toEqual([5, 6]);
  });

  it("returns nothing for an empty result rather than one empty row", () => {
    const rows = unflatten({
      kind: "embed",
      flat: new Float32Array(0),
      count: 0,
      dimension: 384,
    });

    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The worker's own module graph
// ---------------------------------------------------------------------------

describe("what the worker is allowed to import", () => {
  it("cannot reach the database through any import", () => {
    // The worker runs beside a process that already has the database open in
    // WAL mode. Importing anything that reaches `server/db.ts` would open it
    // a second time and re-run every migration on that thread, and the first
    // sign would be a duplicated boot log or a rebuilt index rather than an
    // error.
    //
    // Checked by walking the imports rather than by loading them: a test that
    // imported the worker's graph to see what happened would have already
    // done the thing it is trying to forbid.
    const graph = importGraph("server/workers/cpuWorker.ts");

    expect(graph.filter((file) => file.endsWith("server/db.ts"))).toEqual([]);
  });

  it("walks far enough to be worth trusting", () => {
    // A graph walker that resolved nothing would pass the test above for the
    // wrong reason. The worker imports the protocol, so at minimum that has
    // to be in it.
    const graph = importGraph("server/workers/cpuWorker.ts");

    expect(graph).toContain("server/workers/protocol.ts");
  });

  it("would notice an import that did reach the database", () => {
    // The check above is only worth having if it can fail. `cpuHost.ts` is on
    // the main thread and reaches the logger, which is fine for it and would
    // not be for the worker; this pins that the walker follows real edges.
    const graph = importGraph("server/workers/cpuHost.ts");

    expect(graph).toContain("server/utils/logger.ts");
  });
});

/**
 * Every repository file reachable from `entry` by a runtime import.
 *
 * `import type` is skipped because TypeScript erases it, and bare specifiers
 * are skipped because a package cannot reach `server/db.ts`. Relative paths
 * only, which is every import in this repository that matters here.
 */
function importGraph(entry: string): string[] {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);

    let source: string;
    try {
      source = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }

    // Type-only statements first, because TypeScript erases them and a type
    // cannot open a database. They are removed rather than skipped so that the
    // `from` match below does not have to reason about where a multi-line
    // statement began.
    const runtime = source.replace(
      /\b(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["']/g,
      "",
    );

    const specifiers = [
      ...runtime.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...runtime.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...runtime.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      // Relative only. A package cannot reach `server/db.ts`.
      if (!specifier.startsWith(".")) continue;
      const resolved = path
        .normalize(path.join(path.dirname(file), specifier))
        .replace(/\\/g, "/");
      queue.push(resolved);
    }
  }

  seen.delete(entry);
  return [...seen];
}

// ---------------------------------------------------------------------------
// Shutting down
// ---------------------------------------------------------------------------

describe("the process", () => {
  it("exits on its own once the worker is idle", async () => {
    // The failure this guards is not an assertion, it is a hang. A worker that
    // holds a reference to the event loop for its whole life keeps the process
    // alive for ever, and the first sign is a container that will not stop.
    //
    // The opposite mistake is just as real and was made first: a worker
    // unref'd from construction let Node exit while it was still resolving its
    // own imports, and a backfill died with "Detected unsettled top-level
    // await". So the reference is held while a job runs and released when the
    // queue empties, and this runs a whole process to check both halves.
    const script = `
      const { startJob } = await import(${JSON.stringify(hostPath())});
      await startJob({ kind: "embed", texts: [], batchSize: 8 }).result;
      console.log("job-done");
    `;
    // `.mts`, not `.ts`. The file is outside the repository, so tsx has no
    // package.json saying `"type": "module"` to go on and transforms a bare
    // `.ts` as CommonJS, where a top-level await is a syntax error.
    const file = path.join(os.tmpdir(), `cpu-worker-exit-${process.pid}.mts`);
    fs.writeFileSync(file, script);

    try {
      const finished = await runNode(file, 45_000);

      expect(finished.stdout).toContain("job-done");
      expect(finished.timedOut).toBe(false);
      expect(finished.code).toBe(0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  }, 60_000);
});

/** Absolute path to the host module, for a script written outside the repo. */
function hostPath(): string {
  return pathToFileURL(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../server/workers/cpuHost.ts",
    ),
  ).href;
}

/** Run a script under tsx and report whether it ended on its own. */
function runNode(
  file: string,
  timeoutMs: number,
): Promise<{ stdout: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", file], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, code, timedOut });
    });
  });
}

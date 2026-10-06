import { describe, it, expect, vi } from "vitest";
import {
  GenerationQueue,
  SharedWork,
} from "../../../../server/ai/workQueue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AI work limits", () => {
  it("bounds active work and rejects excess queued requests", async () => {
    const queue = new GenerationQueue(1, 1);
    const first = deferred<string>();
    const second = vi.fn(async () => "second");
    const one = queue.run(() => first.promise);
    const two = queue.run(second);
    await expect(queue.run(async () => "excess")).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_BUSY",
    });
    expect(second).not.toHaveBeenCalled();
    first.resolve("first");
    expect(await one).toBe("first");
    expect(await two).toBe("second");
  });
  it("does not start work canceled before its first microtask", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => 1);
    const result = new GenerationQueue().run(operation, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
  it("shares identical work while each caller retains separate cancellation", async () => {
    const shared = new SharedWork<number>();
    const pending = deferred<number>();
    let sharedSignal!: AbortSignal;
    const operation = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal;
      return pending.promise;
    });
    const controller = new AbortController();
    const one = shared
      .run("same", operation, controller.signal)
      .catch((error) => error);
    const two = shared.run("same", operation);
    await Promise.resolve();
    controller.abort();
    await one;
    expect(sharedSignal.aborted).toBe(false);
    pending.resolve(2);
    expect(await two).toBe(2);
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("cancels shared work when its final caller leaves", async () => {
    const shared = new SharedWork<number>();
    const controller = new AbortController();
    let sharedSignal!: AbortSignal;
    const pending = deferred<number>();
    const result = shared
      .run(
        "one",
        (signal) => {
          sharedSignal = signal;
          return pending.promise;
        },
        controller.signal,
      )
      .catch((error) => error);
    await Promise.resolve();
    controller.abort();
    await result;
    expect(sharedSignal.aborted).toBe(true);
    pending.resolve(1);
  });
});

describe("Multitenant fair AI queueing", () => {
  it("rotates waiting work between accounts in round-robin order", async () => {
    const queue = new GenerationQueue(1, 10);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];

    // Occupy the active concurrency slot
    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A queues 3 jobs
    queue.run(
      async () => {
        executionOrder.push("A1");
      },
      { accountId: "acc-A" },
    );
    queue.run(
      async () => {
        executionOrder.push("A2");
      },
      { accountId: "acc-A" },
    );
    queue.run(
      async () => {
        executionOrder.push("A3");
      },
      { accountId: "acc-A" },
    );

    // Account B queues 1 job
    queue.run(
      async () => {
        executionOrder.push("B1");
      },
      { accountId: "acc-B" },
    );

    // Account C queues 1 job
    queue.run(
      async () => {
        executionOrder.push("C1");
      },
      { accountId: "acc-C" },
    );

    // Release the active slot
    activeJob.resolve();

    await vi.waitFor(() => expect(executionOrder).toHaveLength(5));

    // Fair rotation: A gets one, then B gets one, then C gets one, then A resumes
    expect(executionOrder).toEqual(["A1", "B1", "C1", "A2", "A3"]);
  });

  it("gives interactive requests priority over background requests", async () => {
    const queue = new GenerationQueue(1, 10);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];

    queue.run(() => activeJob.promise, {
      accountId: "acc-init",
      priority: "interactive",
    });

    // Account A queues background work
    queue.run(
      async () => {
        executionOrder.push("A-bg-1");
      },
      { accountId: "acc-A", priority: "background" },
    );
    queue.run(
      async () => {
        executionOrder.push("A-bg-2");
      },
      { accountId: "acc-A", priority: "background" },
    );

    // Account B queues an interactive request after A's background work
    queue.run(
      async () => {
        executionOrder.push("B-interactive");
      },
      { accountId: "acc-B", priority: "interactive" },
    );

    activeJob.resolve();
    await vi.waitFor(() => expect(executionOrder).toHaveLength(3));

    // B's interactive request is prioritized ahead of waiting background work
    expect(executionOrder[0]).toBe("B-interactive");
    expect(executionOrder.slice(1)).toEqual(["A-bg-1", "A-bg-2"]);
  });

  it("ensures background work still progresses despite continuous interactive work", async () => {
    // maxConsecutiveInteractive = 2 to clearly test anti-starvation ratio
    const queue = new GenerationQueue(1, 20, 2);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A queues background jobs
    queue.run(
      async () => {
        executionOrder.push("A-bg-1");
      },
      { accountId: "acc-A", priority: "background" },
    );
    queue.run(
      async () => {
        executionOrder.push("A-bg-2");
      },
      { accountId: "acc-A", priority: "background" },
    );

    // Account B queues 4 interactive jobs
    queue.run(
      async () => {
        executionOrder.push("B-int-1");
      },
      { accountId: "acc-B", priority: "interactive" },
    );
    queue.run(
      async () => {
        executionOrder.push("B-int-2");
      },
      { accountId: "acc-B", priority: "interactive" },
    );
    queue.run(
      async () => {
        executionOrder.push("B-int-3");
      },
      { accountId: "acc-B", priority: "interactive" },
    );
    queue.run(
      async () => {
        executionOrder.push("B-int-4");
      },
      { accountId: "acc-B", priority: "interactive" },
    );

    activeJob.resolve();
    await vi.waitFor(() => expect(executionOrder).toHaveLength(6));

    // Two interactive -> one background -> two interactive -> one background
    expect(executionOrder).toEqual([
      "B-int-1",
      "B-int-2",
      "A-bg-1", // Anti-starvation dispatched background work
      "B-int-3",
      "B-int-4",
      "A-bg-2",
    ]);
  });

  it("evicts noisy tenant tail background job when a quiet tenant arrives at capacity", async () => {
    const queue = new GenerationQueue(1, 3);
    const activeJob = deferred<void>();

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A occupies all 3 waiting positions
    const a1 = queue.run(async () => "a1", {
      accountId: "acc-A",
      priority: "background",
    });
    const a2 = queue.run(async () => "a2", {
      accountId: "acc-A",
      priority: "background",
    });
    const a3 = queue.run(async () => "a3", {
      accountId: "acc-A",
      priority: "background",
    });

    // Account B (0 waiting jobs) arrives with an interactive request
    const bPromise = queue.run(async () => "b-result", {
      accountId: "acc-B",
      priority: "interactive",
    });

    // Account A's tail job a3 is rejected with 429 AI_BUSY
    await expect(a3).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_BUSY",
    });

    // Account B was admitted and runs first when active slot frees up
    activeJob.resolve();
    expect(await bPromise).toBe("b-result");
    expect(await a1).toBe("a1");
    expect(await a2).toBe("a2");
  });

  it("preempts an account's own background job when that account submits an interactive job at capacity", async () => {
    const queue = new GenerationQueue(1, 2);
    const activeJob = deferred<void>();

    queue.run(() => activeJob.promise, { accountId: "acc-A" });

    // Account A fills waiting positions with background work
    const bg1 = queue.run(async () => "bg1", {
      accountId: "acc-A",
      priority: "background",
    });
    const bg2 = queue.run(async () => "bg2", {
      accountId: "acc-A",
      priority: "background",
    });

    // Account A submits an interactive request
    const interactivePromise = queue.run(async () => "interactive-result", {
      accountId: "acc-A",
      priority: "interactive",
    });

    // bg2 is evicted to accommodate the interactive request
    await expect(bg2).rejects.toMatchObject({ statusCode: 429 });

    activeJob.resolve();
    expect(await interactivePromise).toBe("interactive-result");
    expect(await bg1).toBe("bg1");
  });

  it("reports queue metrics and per-account state in getSnapshot", async () => {
    const queue = new GenerationQueue(2, 4);
    const active1 = deferred<void>();
    const active2 = deferred<void>();

    queue.run(() => active1.promise, { accountId: "acc-A" });
    queue.run(() => active2.promise, { accountId: "acc-B" });

    queue.run(async () => "wait-a-bg", {
      accountId: "acc-A",
      priority: "background",
    });
    queue.run(async () => "wait-b-int", {
      accountId: "acc-B",
      priority: "interactive",
    });

    const snapshot = queue.getSnapshot();
    expect(snapshot.active).toBe(2);
    expect(snapshot.concurrency).toBe(2);
    expect(snapshot.waiting).toBe(2);
    expect(snapshot.capacity).toBe(4);

    const accA = snapshot.accounts.find((a) => a.accountId === "acc-A");
    const accB = snapshot.accounts.find((a) => a.accountId === "acc-B");

    expect(accA).toEqual({
      accountId: "acc-A",
      active: 1,
      interactive: 0,
      background: 1,
      total: 1,
    });
    expect(accB).toEqual({
      accountId: "acc-B",
      active: 1,
      interactive: 1,
      background: 0,
      total: 1,
    });

    active1.resolve();
    active2.resolve();
  });

  it("cleans up aborted waiting jobs without disrupting round-robin order of remaining accounts", async () => {
    const queue = new GenerationQueue(1, 10);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];
    const controllerB = new AbortController();

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    queue.run(
      async () => {
        executionOrder.push("A1");
      },
      { accountId: "acc-A" },
    );
    const bJob = queue
      .run(
        async () => {
          executionOrder.push("B1");
        },
        {
          accountId: "acc-B",
          signal: controllerB.signal,
        },
      )
      .catch((e) => e);
    queue.run(
      async () => {
        executionOrder.push("C1");
      },
      { accountId: "acc-C" },
    );
    queue.run(
      async () => {
        executionOrder.push("A2");
      },
      { accountId: "acc-A" },
    );

    // Abort B while waiting
    controllerB.abort();
    expect((await bJob).name).toBe("AbortError");

    activeJob.resolve();
    await vi.waitFor(() => expect(executionOrder).toHaveLength(3));

    // Execution continues without B: A1 -> C1 -> A2
    expect(executionOrder).toEqual(["A1", "C1", "A2"]);
  });

  it("never evicts interactive jobs when an incoming background job arrives at capacity", async () => {
    const queue = new GenerationQueue(1, 2);
    const activeJob = deferred<void>();

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A fills waiting capacity with 2 interactive jobs
    const a1 = queue.run(async () => "a1", {
      accountId: "acc-A",
      priority: "interactive",
    });
    const a2 = queue.run(async () => "a2", {
      accountId: "acc-A",
      priority: "interactive",
    });

    // Account B (quiet tenant) submits a background job at capacity
    const bJob = queue.run(async () => "b-bg", {
      accountId: "acc-B",
      priority: "background",
    });

    // Background job must be rejected with 429 rather than evicting A's interactive jobs
    await expect(bJob).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_BUSY",
    });

    activeJob.resolve();
    expect(await a1).toBe("a1");
    expect(await a2).toBe("a2");
  });

  it("evicts background work from the heaviest background tenant before touching interactive jobs", async () => {
    const queue = new GenerationQueue(1, 3);
    const activeJob = deferred<void>();

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A has 2 interactive jobs
    const a1 = queue.run(async () => "a1", {
      accountId: "acc-A",
      priority: "interactive",
    });
    const a2 = queue.run(async () => "a2", {
      accountId: "acc-A",
      priority: "interactive",
    });

    // Account B has 1 background job
    const b1 = queue.run(async () => "b1", {
      accountId: "acc-B",
      priority: "background",
    });

    // Queue is full (3 waiting). Account C (0 waiting) submits an interactive request
    const cJob = queue.run(async () => "c1", {
      accountId: "acc-C",
      priority: "interactive",
    });

    // Account B's background job must be evicted, NOT Account A's interactive jobs
    await expect(b1).rejects.toMatchObject({
      statusCode: 429,
      code: "AI_BUSY",
    });

    activeJob.resolve();
    expect(await a1).toBe("a1");
    expect(await a2).toBe("a2");
    expect(await cJob).toBe("c1");
  });

  it("preserves an account's round-robin position when preempting its own background job", async () => {
    const queue = new GenerationQueue(1, 2);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A enqueues 1 background job first
    const aBg = queue.run(
      async () => {
        executionOrder.push("A-bg");
      },
      { accountId: "acc-A", priority: "background" },
    );

    // Account B enqueues 1 interactive job second
    queue.run(
      async () => {
        executionOrder.push("B-int");
      },
      { accountId: "acc-B", priority: "interactive" },
    );

    // Queue is now full (2 waiting positions).
    // Account A submits an interactive job, preempting its own background job A-bg
    queue.run(
      async () => {
        executionOrder.push("A-int");
      },
      { accountId: "acc-A", priority: "interactive" },
    );

    await expect(aBg).rejects.toMatchObject({ statusCode: 429 });

    activeJob.resolve();
    await vi.waitFor(() => expect(executionOrder).toHaveLength(2));

    // Account A was first in accountOrder and remains first in round-robin order!
    expect(executionOrder).toEqual(["A-int", "B-int"]);
  });

  it("preserves anti-starvation counter when a background job is canceled before starting", async () => {
    // maxConsecutiveInteractive = 2
    const queue = new GenerationQueue(1, 10, 2);
    const activeJob = deferred<void>();
    const executionOrder: string[] = [];
    const controllerBg1 = new AbortController();

    queue.run(() => activeJob.promise, { accountId: "acc-init" });

    // Account A has 2 background jobs, the first one will be aborted
    const aBg1 = queue
      .run(
        async () => {
          executionOrder.push("A-bg-1");
        },
        {
          accountId: "acc-A",
          priority: "background",
          signal: controllerBg1.signal,
        },
      )
      .catch((e) => e);

    queue.run(
      async () => {
        executionOrder.push("A-bg-2");
      },
      { accountId: "acc-A", priority: "background" },
    );

    // Account B queues 3 interactive jobs
    queue.run(
      async () => {
        executionOrder.push("B-int-1");
      },
      { accountId: "acc-B", priority: "interactive" },
    );
    queue.run(
      async () => {
        executionOrder.push("B-int-2");
      },
      { accountId: "acc-B", priority: "interactive" },
    );
    queue.run(
      async () => {
        executionOrder.push("B-int-3");
      },
      { accountId: "acc-B", priority: "interactive" },
    );

    // Abort the first background job while waiting
    controllerBg1.abort();
    expect((await aBg1).name).toBe("AbortError");

    activeJob.resolve();
    await vi.waitFor(() => expect(executionOrder).toHaveLength(4));

    // B-int-1, B-int-2, then anti-starvation picks background: A-bg-1 was aborted so A-bg-2 runs, then B-int-3
    expect(executionOrder).toEqual(["B-int-1", "B-int-2", "A-bg-2", "B-int-3"]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { RequestCoalescer } from "../../server/utils/requestCoalescer.ts";

describe("RequestCoalescer", () => {
  it("shares identical in-flight requests among concurrent callers", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { data: "success" };
    };

    const p1 = coalescer.coalesce("key-1", action);
    const p2 = coalescer.coalesce("key-1", action);
    const p3 = coalescer.coalesce("key-1", action);

    expect(coalescer.inFlightCount()).toBe(1);
    expect(coalescer.callersCount("key-1")).toBe(3);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(runs).toBe(1);
    expect(r1).toEqual({ data: "success" });
    expect(r2).toEqual({ data: "success" });
    expect(r3).toEqual({ data: "success" });
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("does not share requests with different keys", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async () => {
      const current = ++runs;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return current;
    };

    const p1 = coalescer.coalesce("account-1:search:query", action);
    const p2 = coalescer.coalesce("account-2:search:query", action);

    expect(coalescer.inFlightCount()).toBe(2);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(runs).toBe(2);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("preserves cancellation: if caller 1 aborts, caller 2 still receives result", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async (signal: AbortSignal) => {
      runs++;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve("done"), 60);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Action aborted"));
        });
      });
    };

    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = coalescer.coalesce("key-cancel-1", action, ac1.signal);
    const p2 = coalescer.coalesce("key-cancel-1", action, ac2.signal);

    // Caller 1 aborts early
    ac1.abort(new Error("caller 1 cancelled"));

    let err1: Error | undefined;
    try {
      await p1;
    } catch (e) {
      err1 = e as Error;
    }

    expect(err1).toBeDefined();
    expect(err1?.message).toBe("caller 1 cancelled");

    // Caller 2 still completes successfully!
    const r2 = await p2;
    expect(r2).toBe("done");
    expect(runs).toBe(1);
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("preserves cancellation: if caller 2 aborts, caller 1 still receives result", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async (signal: AbortSignal) => {
      runs++;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve("completed"), 60);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Action aborted"));
        });
      });
    };

    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = coalescer.coalesce("key-cancel-2", action, ac1.signal);
    const p2 = coalescer.coalesce("key-cancel-2", action, ac2.signal);

    // Caller 2 aborts early
    ac2.abort(new Error("caller 2 cancelled"));

    let err2: Error | undefined;
    try {
      await p2;
    } catch (e) {
      err2 = e as Error;
    }

    expect(err2).toBeDefined();
    expect(err2?.message).toBe("caller 2 cancelled");

    // Caller 1 still completes successfully!
    const r1 = await p1;
    expect(r1).toBe("completed");
    expect(runs).toBe(1);
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("aborts underlying work when ALL waiting callers abort", async () => {
    const coalescer = new RequestCoalescer();
    let actionAborted = false;

    const action = async (signal: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve("done"), 100);
        signal.addEventListener("abort", () => {
          actionAborted = true;
          clearTimeout(timer);
          reject(signal.reason ?? new Error("Action aborted"));
        });
      });
    };

    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = coalescer.coalesce("key-all-abort", action, ac1.signal);
    const p2 = coalescer.coalesce("key-all-abort", action, ac2.signal);

    ac1.abort();
    ac2.abort();

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();

    expect(actionAborted).toBe(true);
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("rejects immediately if caller passes an already aborted signal", async () => {
    const coalescer = new RequestCoalescer();
    const action = vi.fn().mockResolvedValue("result");

    const ac = new AbortController();
    ac.abort(new Error("Already dead"));

    await expect(
      coalescer.coalesce("key-pre-aborted", action, ac.signal),
    ).rejects.toThrow("Already dead");

    expect(action).not.toHaveBeenCalled();
    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("propagates underlying failure to all waiting callers", async () => {
    const coalescer = new RequestCoalescer();

    const action = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("Provider quota exceeded");
    };

    const p1 = coalescer.coalesce("key-err", action);
    const p2 = coalescer.coalesce("key-err", action);

    await expect(p1).rejects.toThrow("Provider quota exceeded");
    await expect(p2).rejects.toThrow("Provider quota exceeded");

    expect(coalescer.inFlightCount()).toBe(0);
  });

  it("runs fresh action after previous request completes", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async () => {
      runs++;
      return runs;
    };

    const r1 = await coalescer.coalesce("key-sequential", action);
    expect(r1).toBe(1);

    const r2 = await coalescer.coalesce("key-sequential", action);
    expect(r2).toBe(2);

    expect(runs).toBe(2);
  });

  it("does not delete newly started in-flight entry if a previous aborted entry settles afterwards", async () => {
    const coalescer = new RequestCoalescer();
    let resolveFirstAction!: () => void;
    const firstAction = async (signal: AbortSignal) => {
      await new Promise<void>((resolve) => {
        resolveFirstAction = resolve;
        signal.addEventListener("abort", () => {
          // Slow async cleanup simulating unwinding
        });
      });
      return "first";
    };

    const ac1 = new AbortController();
    const p1 = coalescer.coalesce("key-race", firstAction, ac1.signal);
    // Abort caller 1 (the only caller)
    ac1.abort();
    await expect(p1).rejects.toThrow();

    // Now caller 2 immediately starts with the same key while firstAction has not resolved yet
    let runsSecond = 0;
    const secondAction = async () => {
      runsSecond++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "second";
    };

    const p2a = coalescer.coalesce("key-race", secondAction);
    expect(coalescer.inFlightCount()).toBe(1);

    // Now firstAction finally finishes and executes its finally block
    resolveFirstAction();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Caller 2's entry MUST still be in-flight! It should NOT have been deleted by firstAction's finally block
    expect(coalescer.inFlightCount()).toBe(1);

    // Caller 2b attaches to the same key and MUST coalesce with p2a, not start a new run
    const p2b = coalescer.coalesce("key-race", secondAction);
    const [resA, resB] = await Promise.all([p2a, p2b]);
    expect(resA).toBe("second");
    expect(resB).toBe("second");
    expect(runsSecond).toBe(1);
    expect(coalescer.inFlightCount()).toBe(0);
  });
});

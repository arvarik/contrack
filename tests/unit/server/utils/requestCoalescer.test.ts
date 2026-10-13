import { describe, it, expect, vi } from "vitest";
import { RequestCoalescer } from "../../../../server/utils/requestCoalescer.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Nothing is left in flight under `key`: a new call runs its own action
 * rather than joining a finished, failed or abandoned one.
 */
async function expectRunsFresh(coalescer: RequestCoalescer, key: string) {
  const fresh = vi.fn().mockResolvedValue("fresh");
  await expect(coalescer.coalesce(key, fresh)).resolves.toBe("fresh");
  expect(fresh).toHaveBeenCalledTimes(1);
}

describe("RequestCoalescer", () => {
  it("shares identical in-flight requests among concurrent callers", async () => {
    const coalescer = new RequestCoalescer();
    const gate = deferred<{ data: string }>();
    let runs = 0;

    const action = () => {
      runs++;
      return gate.promise;
    };

    const p1 = coalescer.coalesce("key-1", action);
    const p2 = coalescer.coalesce("key-1", action);
    const p3 = coalescer.coalesce("key-1", action);

    gate.resolve({ data: "success" });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(runs).toBe(1);
    expect(r1).toEqual({ data: "success" });
    expect(r2).toEqual({ data: "success" });
    expect(r3).toEqual({ data: "success" });
    await expectRunsFresh(coalescer, "key-1");
  });

  it("does not share requests with different keys", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async () => ++runs;

    const p1 = coalescer.coalesce("account-1:search:query", action);
    const p2 = coalescer.coalesce("account-2:search:query", action);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(runs).toBe(2);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    await expectRunsFresh(coalescer, "account-1:search:query");
    await expectRunsFresh(coalescer, "account-2:search:query");
  });

  // One Set holds every caller, so the first caller is no different from one
  // that joined later. Both are checked.
  it.each([
    ["the caller that started the work", 0],
    ["a caller that joined it", 1],
  ] as const)(
    "preserves cancellation: if %s aborts, the other still receives the result",
    async (_who, aborting) => {
      const coalescer = new RequestCoalescer();
      const gate = deferred<string>();
      let runs = 0;

      const action = (signal: AbortSignal) => {
        runs++;
        signal.addEventListener("abort", () => {
          gate.reject(signal.reason ?? new Error("Action aborted"));
        });
        return gate.promise;
      };

      const controllers = [new AbortController(), new AbortController()];
      const callers = controllers.map((ac) =>
        coalescer.coalesce("key-cancel", action, ac.signal),
      );

      // One caller aborts early
      const reason = new Error("caller cancelled");
      controllers[aborting].abort(reason);
      await expect(callers[aborting]).rejects.toBe(reason);

      // The other still completes successfully!
      gate.resolve("done");
      await expect(callers[1 - aborting]).resolves.toBe("done");
      expect(runs).toBe(1);
      await expectRunsFresh(coalescer, "key-cancel");
    },
  );

  it("aborts underlying work when ALL waiting callers abort", async () => {
    const coalescer = new RequestCoalescer();
    let actionAborted = false;

    const action = (signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          actionAborted = true;
          reject(signal.reason ?? new Error("Action aborted"));
        });
      });

    const ac1 = new AbortController();
    const ac2 = new AbortController();

    const p1 = coalescer.coalesce("key-all-abort", action, ac1.signal);
    const p2 = coalescer.coalesce("key-all-abort", action, ac2.signal);

    ac1.abort();
    ac2.abort();

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();

    expect(actionAborted).toBe(true);
    await expectRunsFresh(coalescer, "key-all-abort");
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
    await expectRunsFresh(coalescer, "key-pre-aborted");
  });

  it("propagates underlying failure to all waiting callers", async () => {
    const coalescer = new RequestCoalescer();
    const gate = deferred<never>();

    const p1 = coalescer.coalesce("key-err", () => gate.promise);
    const p2 = coalescer.coalesce("key-err", () => gate.promise);

    gate.reject(new Error("Provider quota exceeded"));
    await expect(p1).rejects.toThrow("Provider quota exceeded");
    await expect(p2).rejects.toThrow("Provider quota exceeded");

    await expectRunsFresh(coalescer, "key-err");
  });

  it("runs fresh action after previous request completes", async () => {
    const coalescer = new RequestCoalescer();
    let runs = 0;

    const action = async () => ++runs;

    const r1 = await coalescer.coalesce("key-sequential", action);
    expect(r1).toBe(1);

    const r2 = await coalescer.coalesce("key-sequential", action);
    expect(r2).toBe(2);

    expect(runs).toBe(2);
  });

  it("does not delete newly started in-flight entry if a previous aborted entry settles afterwards", async () => {
    const coalescer = new RequestCoalescer();
    const firstGate = deferred();
    const secondGate = deferred<string>();

    const firstAction = async () => {
      await firstGate.promise;
      return "first";
    };

    const ac1 = new AbortController();
    const p1 = coalescer.coalesce("key-race", firstAction, ac1.signal);
    ac1.abort();
    await expect(p1).rejects.toThrow();

    let runsSecond = 0;
    const secondAction = () => {
      runsSecond++;
      return secondGate.promise;
    };

    const p2a = coalescer.coalesce("key-race", secondAction);

    // First action settles and executes its finally block while p2a is in flight.
    firstGate.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const p2b = coalescer.coalesce("key-race", secondAction);
    secondGate.resolve("second");
    const [resA, resB] = await Promise.all([p2a, p2b]);
    expect(resA).toBe("second");
    expect(resB).toBe("second");
    expect(runsSecond).toBe(1);
    await expectRunsFresh(coalescer, "key-race");
  });
});

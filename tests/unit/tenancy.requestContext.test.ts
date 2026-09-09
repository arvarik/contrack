// =============================================================================
// Unit Tests — request context (AsyncLocalStorage)
// =============================================================================
// These tests pin the two facts Phase 2 depends on.
//
// 1. The store survives every async boundary the request path uses, so an
//    insert deep in a service can still read who is asking.
// 2. An EventEmitter listener runs in the context of whoever calls emit(),
//    NOT the context that subscribed. Every SSE and NDJSON handler therefore
//    captures its Scope in the closure before subscribing. This test is the
//    reason that rule exists, so it asserts the surprising behavior directly.
// =============================================================================

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import {
  runWithContext,
  getContext,
  currentScope,
  currentScopeOrNull,
  type RequestContext,
} from "../../server/tenancy/requestContext.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { AppError } from "../../server/utils/AppError.ts";

const ctx = (id: string): RequestContext => ({
  requestId: `req-${id}`,
  principal: null,
  scope: scopeForOwnerId(id),
});

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("request context: async boundaries", () => {
  it("survives await", async () => {
    await runWithContext(ctx(A), async () => {
      await Promise.resolve();
      expect(currentScope().ownerId).toBe(A);
    });
  });

  it("survives setTimeout", async () => {
    await runWithContext(
      ctx(A),
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            expect(currentScope().ownerId).toBe(A);
            resolve();
          }, 1),
        ),
    );
  });

  it("survives setImmediate", async () => {
    await runWithContext(
      ctx(A),
      () =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            expect(currentScope().ownerId).toBe(A);
            resolve();
          }),
        ),
    );
  });

  it("survives Promise.all and keeps each context separate", async () => {
    const read = async () => {
      await Promise.resolve();
      return currentScope().ownerId;
    };
    const [a, b] = await Promise.all([
      runWithContext(ctx(A), () => Promise.all([read(), read()])),
      runWithContext(ctx(B), () => Promise.all([read(), read()])),
    ]);
    expect(a).toEqual([A, A]);
    expect(b).toEqual([B, B]);
  });

  it("survives a for await loop", async () => {
    async function* gen() {
      yield 1;
      await Promise.resolve();
      yield 2;
    }
    await runWithContext(ctx(A), async () => {
      for await (const _ of gen()) {
        expect(currentScope().ownerId).toBe(A);
      }
    });
  });
});

describe("request context: the EventEmitter rule", () => {
  it("gives a listener the emitter's context, not the subscriber's", () => {
    const bus = new EventEmitter();
    const seen: (string | null)[] = [];

    // Subscribe inside A.
    runWithContext(ctx(A), () => {
      bus.on("tick", () => seen.push(currentScopeOrNull()?.ownerId ?? null));
    });

    // Emit from inside B. The listener sees B, not A.
    runWithContext(ctx(B), () => bus.emit("tick"));
    expect(seen).toEqual([B]);

    // Emit from outside any context. The listener sees nothing at all.
    bus.emit("tick");
    expect(seen).toEqual([B, null]);
  });
});

describe("request context: no scope", () => {
  it("currentScope throws NO_SCOPE outside a context", () => {
    expect(() => currentScope()).toThrow(AppError);
    try {
      currentScope();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(500);
      expect((e as AppError).code).toBe("NO_SCOPE");
    }
  });

  it("currentScope throws when the context carries a null scope", () => {
    runWithContext({ requestId: "r", principal: null, scope: null }, () => {
      expect(() => currentScope()).toThrow(/No owner scope/);
    });
  });

  it("currentScopeOrNull returns null instead of throwing", () => {
    expect(currentScopeOrNull()).toBeNull();
    runWithContext({ requestId: "r", principal: null, scope: null }, () => {
      expect(currentScopeOrNull()).toBeNull();
    });
  });

  it("getContext returns null outside a context and the context inside", () => {
    expect(getContext()).toBeNull();
    runWithContext(ctx(A), () => {
      expect(getContext()?.requestId).toBe(`req-${A}`);
    });
  });
});

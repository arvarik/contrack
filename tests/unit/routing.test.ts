// =============================================================================
// Unit Tests — AI Routing Layer (Smart Mesh v1.2)
// =============================================================================
// Pure-logic tests for all 4 routing modules. Zero I/O — no network calls,
// no database, no mocks of external services. Only vi.useFakeTimers() for
// sliding window expiry tests.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module imports ───────────────────────────────────────────────────────────
import {
  compareForClass,
  previewModelForClass,
  GEMINI_REGISTRY,
  type ModelConfig,
} from "../../server/ai/routing/registry.ts";
import { QuotaTracker } from "../../server/ai/routing/QuotaTracker.ts";
import { SmartRouter } from "../../server/ai/routing/SmartRouter.ts";
import { ParallelQueue } from "../../server/ai/routing/ParallelQueue.ts";

// =============================================================================
// 1. Registry
// =============================================================================

describe("Registry", () => {
  it("lists each model once", () => {
    const ids = GEMINI_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers no model Google has closed to new projects", () => {
    // 2.5 answers a new key with 404 "no longer available to new users".
    expect(GEMINI_REGISTRY.some((m) => m.generation < 3)).toBe(false);
  });

  it("carries no free or paid limits", () => {
    // Google sets a key's limits from its Cloud project's billing and no
    // longer publishes free-tier numbers, so the router must not hold any.
    for (const model of GEMINI_REGISTRY) {
      expect(Object.keys(model).sort()).toEqual([
        "costPerM",
        "generation",
        "id",
        "modelClass",
        "stability",
        "supportsGrounding",
      ]);
    }
  });

  it("names what Auto runs for each class", () => {
    expect(previewModelForClass("lite")).toBe("gemini-3.5-flash-lite");
    expect(previewModelForClass("flash")).toBe("gemini-3.8-flash");
    expect(previewModelForClass("pro")).toBe("gemini-3.1-pro-preview");
  });

  it("names a model that can search when research asks", () => {
    const id = previewModelForClass("flash", true);
    expect(GEMINI_REGISTRY.find((m) => m.id === id)?.supportsGrounding).toBe(
      true,
    );
  });

  describe("compareForClass", () => {
    const model = (overrides: Partial<ModelConfig>): ModelConfig => ({
      id: "m",
      modelClass: "flash",
      generation: 3,
      stability: "stable",
      costPerM: 1,
      supportsGrounding: true,
      ...overrides,
    });

    it("puts the preferred class first", () => {
      const lite = model({ id: "lite", modelClass: "lite", generation: 9 });
      const flash = model({ id: "flash", modelClass: "flash", generation: 1 });
      expect([lite, flash].sort(compareForClass("flash"))[0].id).toBe("flash");
    });

    it("puts a newer generation first, then stable, then the cheaper", () => {
      const old = model({ id: "old", generation: 2.5, costPerM: 0.1 });
      const preview = model({ id: "preview", stability: "preview" });
      const dear = model({ id: "dear", costPerM: 9 });
      const cheap = model({ id: "cheap", costPerM: 2 });
      expect(
        [old, preview, dear, cheap]
          .sort(compareForClass("flash"))
          .map((m) => m.id),
      ).toEqual(["cheap", "dear", "preview", "old"]);
    });
  });
});

// =============================================================================
// 2. QuotaTracker — a usage meter now, with no limits to enforce
// =============================================================================

describe("QuotaTracker", () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker();
  });

  describe("estimateTokens", () => {
    it("produces reasonable estimates for typical prompts", () => {
      // "Hello world" = 11 chars → 11/4 * 1.1 ≈ 4 tokens
      const tokens = tracker.estimateTokens("Hello world");
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20);
    });

    it("adds overhead for JSON responses", () => {
      const textTokens = tracker.estimateTokens(
        "Test prompt",
        undefined,
        false,
      );
      const jsonTokens = tracker.estimateTokens("Test prompt", undefined, true);
      // JSON overhead is +50 tokens on top of the base estimate
      expect(jsonTokens).toBe(textTokens + 50);
    });

    it("includes system prompt in estimate", () => {
      const withoutSystem = tracker.estimateTokens("Prompt");
      const withSystem = tracker.estimateTokens(
        "Prompt",
        "System instructions",
      );
      expect(withSystem).toBeGreaterThan(withoutSystem);
    });
  });

  describe("reserve → rollback", () => {
    it("fully unwinds a request the provider refused", () => {
      tracker.reserve("model-a", 500);
      tracker.rollback("model-a");
      expect(tracker.getSnapshot().models["model-a"]).toEqual({
        rpm: 0,
        tpm: 0,
        rpd: 0,
      });
    });
  });

  describe("reconcile", () => {
    it("adjusts token count to reflect actual usage", () => {
      // Estimate 500 tokens, actually used 300
      tracker.reserve("model-a", 500);
      tracker.reconcile("model-a", 500, 300);

      // Snapshot should show 300 TPM, not 500
      const snapshot = tracker.getSnapshot();
      expect(snapshot.models["model-a"].tpm).toBe(300);
    });

    it("clamps to zero — never produces negative token counts", () => {
      tracker.reserve("model-a", 100);
      tracker.reconcile("model-a", 100, 10);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(10);

      // Now reconcile again with bad data — would push below zero without clamp
      tracker.reconcile("model-a", 100, 0);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(0);
    });
  });

  describe("grounded requests", () => {
    it("counts them and takes one back", () => {
      tracker.reserveGrounding();
      tracker.reserveGrounding();
      tracker.rollbackGrounding();
      expect(tracker.getSnapshot().grounding).toEqual({ rpd: 1 });
    });
  });

  describe("getSnapshot", () => {
    it("returns current usage state", () => {
      tracker.reserve("model-a", 100);
      tracker.reserve("model-a", 200);
      tracker.reserveGrounding();

      const snapshot = tracker.getSnapshot();
      expect(snapshot.models["model-a"]).toEqual({
        rpm: 2,
        tpm: 300,
        rpd: 2,
      });
      expect(snapshot.grounding).toEqual({ rpd: 1 });
    });
  });

  describe("sliding window expiry", () => {
    it("expires entries older than 60s from RPM and TPM", () => {
      vi.useFakeTimers();

      try {
        tracker.reserve("model-a", 100);
        vi.advanceTimersByTime(61_000);

        const snapshot = tracker.getSnapshot();
        expect(snapshot.models["model-a"].rpm).toBe(0);
        expect(snapshot.models["model-a"].tpm).toBe(0);
        expect(snapshot.models["model-a"].rpd).toBe(1); // Daily counter persists
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// =============================================================================
// 3. SmartRouter
// =============================================================================

describe("SmartRouter", () => {
  const router = new SmartRouter(GEMINI_REGISTRY);
  const noPauses = new Set<string>();
  const byId = (id: string) => GEMINI_REGISTRY.find((m) => m.id === id);

  it("routes to the newest model of the preferred class", () => {
    expect(
      router.getNextAvailableRoute({ prefer: "lite" }, noPauses).modelId,
    ).toBe("gemini-3.5-flash-lite");
    expect(
      router.getNextAvailableRoute({ prefer: "flash" }, noPauses).modelId,
    ).toBe("gemini-3.8-flash");
  });

  it("routes to the newest generation with no preference", () => {
    expect(router.getNextAvailableRoute({}, noPauses).modelId).toBe(
      "gemini-3.8-flash",
    );
  });

  it("respects denyModels policy", () => {
    const route = router.getNextAvailableRoute(
      { prefer: "flash", denyModels: ["gemini-3.8-flash"] },
      noPauses,
    );
    expect(route.modelId).toBe("gemini-3.7-flash");
  });

  it("respects allowModels policy", () => {
    const route = router.getNextAvailableRoute(
      { allowModels: ["gemini-3.6-flash"] },
      noPauses,
    );
    expect(route.modelId).toBe("gemini-3.6-flash");
  });

  it("steps past a paused model to the next in its class", () => {
    const route = router.getNextAvailableRoute(
      { prefer: "flash" },
      new Set(["gemini-3.8-flash"]),
    );
    expect(route.modelId).toBe("gemini-3.7-flash");
  });

  it("keeps grounded requests on models that can search", () => {
    const route = router.getNextAvailableRoute(
      { prefer: "flash" },
      noPauses,
      true,
    );
    expect(byId(route.modelId)?.supportsGrounding).toBe(true);
  });

  it("falls back to other classes when the preferred class is paused", () => {
    const proIds = GEMINI_REGISTRY.filter((m) => m.modelClass === "pro").map(
      (m) => m.id,
    );
    const route = router.getNextAvailableRoute(
      { prefer: "pro" },
      new Set(proIds),
    );
    expect(byId(route.modelId)?.modelClass).not.toBe("pro");
  });

  it("throws when every model is paused", () => {
    const all = new Set(GEMINI_REGISTRY.map((m) => m.id));
    expect(() => router.getNextAvailableRoute({}, all)).toThrow(
      "No models match routing criteria",
    );
  });

  it("prefers a stable model to a preview of the same generation", () => {
    const registry: ModelConfig[] = [
      {
        id: "preview",
        modelClass: "flash",
        generation: 4,
        stability: "preview",
        costPerM: 1,
        supportsGrounding: true,
      },
      {
        id: "stable",
        modelClass: "flash",
        generation: 4,
        stability: "stable",
        costPerM: 5,
        supportsGrounding: true,
      },
    ];
    expect(
      new SmartRouter(registry).getNextAvailableRoute(
        { prefer: "flash" },
        noPauses,
      ).modelId,
    ).toBe("stable");
  });
});

// =============================================================================
// 4. ParallelQueue
// =============================================================================

describe("ParallelQueue", () => {
  it("processes all items with correct results in order", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await ParallelQueue.process(items, 3, async (n) => n * 2);

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const items = Array.from({ length: 10 }, (_, i) => i);
    await ParallelQueue.process(items, 3, async (n) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));

      currentConcurrent--;
      return n;
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThan(1); // Should actually parallelize
  });

  it("isolates per-item errors without crashing the batch", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await ParallelQueue.process(items, 3, async (n) => {
      if (n === 3) throw new Error("item 3 failed");
      return n * 10;
    });

    expect(results[0]).toBe(10);
    expect(results[1]).toBe(20);
    expect(results[2]).toBeInstanceOf(Error);
    expect((results[2] as Error).message).toBe("item 3 failed");
    expect(results[3]).toBe(40);
    expect(results[4]).toBe(50);
  });
});

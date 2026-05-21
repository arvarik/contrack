// =============================================================================
// Unit Tests — AI Routing Layer (Smart Mesh v1.2)
// =============================================================================
// Pure-logic tests for all 4 routing modules. Zero I/O — no network calls,
// no database, no mocks of external services. Only vi.useFakeTimers() for
// sliding window expiry tests.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module imports ───────────────────────────────────────────────────────────
import {
  getAITier,
  getActiveLimits,
  getAvailableModels,
  getGroundingRPDLimit,
  GEMINI_REGISTRY,
  type TierLimits,
} from "../../server/ai/routing/registry.ts";
import { QuotaTracker } from "../../server/ai/routing/QuotaTracker.ts";
import { SmartRouter } from "../../server/ai/routing/SmartRouter.ts";
import { ParallelQueue } from "../../server/ai/routing/ParallelQueue.ts";

// =============================================================================
// 1. Registry
// =============================================================================

describe("Registry", () => {
  const originalEnv = process.env.AI_TIER;

  afterEach(() => {
    // Restore original env after each test
    if (originalEnv !== undefined) {
      process.env.AI_TIER = originalEnv;
    } else {
      delete process.env.AI_TIER;
    }
  });

  describe("getAITier", () => {
    it("defaults to FREE when AI_TIER is not set", () => {
      delete process.env.AI_TIER;
      expect(getAITier()).toBe("FREE");
    });

    it("reads PAID from environment (case-insensitive)", () => {
      process.env.AI_TIER = "paid";
      expect(getAITier()).toBe("PAID");
    });

    it("returns FREE for any unrecognized value", () => {
      process.env.AI_TIER = "premium";
      expect(getAITier()).toBe("FREE");
    });
  });

  describe("getActiveLimits", () => {
    const model = GEMINI_REGISTRY[0]; // gemini-2.5-flash-lite

    it("returns free limits on FREE tier", () => {
      const limits = getActiveLimits(model, "FREE");
      expect(limits).toBe(model.freeLimits);
    });

    it("returns paid limits on PAID tier", () => {
      const limits = getActiveLimits(model, "PAID");
      expect(limits).toBe(model.paidLimits);
    });
  });

  describe("getAvailableModels", () => {
    it("excludes paid-only models on FREE tier", () => {
      const models = getAvailableModels("FREE");
      const allHaveFreeTier = models.every((m) => m.hasFreeTier);
      expect(allHaveFreeTier).toBe(true);
      expect(models.length).toBeLessThan(GEMINI_REGISTRY.length);
    });

    it("includes all models on PAID tier", () => {
      const models = getAvailableModels("PAID");
      expect(models.length).toBe(GEMINI_REGISTRY.length);
    });
  });

  describe("getGroundingRPDLimit", () => {
    it("returns 500 for FREE tier", () => {
      expect(getGroundingRPDLimit("FREE")).toBe(500);
    });

    it("returns 5000 for PAID tier", () => {
      expect(getGroundingRPDLimit("PAID")).toBe(5000);
    });
  });
});

// =============================================================================
// 2. QuotaTracker
// =============================================================================

describe("QuotaTracker", () => {
  let tracker: QuotaTracker;

  beforeEach(() => {
    tracker = new QuotaTracker(500); // 500 grounding RPD limit
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

  describe("hasCapacity", () => {
    const limits: TierLimits = { rpm: 10, tpm: 1000, rpd: 100 };

    it("returns true when under all limits", () => {
      expect(tracker.hasCapacity("model-a", 100, limits)).toBe(true);
    });

    it("returns false when RPM would be exceeded", () => {
      // Fill up RPM
      for (let i = 0; i < 10; i++) {
        tracker.reserve("model-a", 10);
      }
      expect(tracker.hasCapacity("model-a", 10, limits)).toBe(false);
    });

    it("returns false when TPM would be exceeded", () => {
      // Reserve 950 tokens — next request of 100 would exceed 1000
      tracker.reserve("model-a", 950);
      expect(tracker.hasCapacity("model-a", 100, limits)).toBe(false);
    });

    it("returns false when RPD would be exceeded", () => {
      const tightLimits: TierLimits = { rpm: 1000, tpm: 1_000_000, rpd: 3 };
      for (let i = 0; i < 3; i++) {
        tracker.reserve("model-a", 10);
      }
      expect(tracker.hasCapacity("model-a", 10, tightLimits)).toBe(false);
    });
  });

  describe("reserve → rollback", () => {
    it("fully unwinds a reservation", () => {
      const limits: TierLimits = { rpm: 2, tpm: 1000, rpd: 100 };

      // Reserve then rollback
      tracker.reserve("model-a", 500);
      tracker.rollback("model-a");

      // Should have capacity again
      expect(tracker.hasCapacity("model-a", 500, limits)).toBe(true);
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
      // Estimate 100 tokens, actually used 10
      // Delta = 10 - 100 = -90 → count would go to 100 + (-90) = 10
      tracker.reserve("model-a", 100);
      tracker.reconcile("model-a", 100, 10);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(10);

      // Now reconcile again with bad data — would push below zero without clamp
      tracker.reconcile("model-a", 100, 0);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(0);
    });
  });

  describe("grounding tracking", () => {
    it("hasGroundingCapacity returns true when under limit", () => {
      expect(tracker.hasGroundingCapacity()).toBe(true);
    });

    it("hasGroundingCapacity returns false when exhausted", () => {
      for (let i = 0; i < 500; i++) {
        tracker.reserveGrounding();
      }
      expect(tracker.hasGroundingCapacity()).toBe(false);
    });

    it("rollbackGrounding unwinds a reservation", () => {
      for (let i = 0; i < 500; i++) {
        tracker.reserveGrounding();
      }
      tracker.rollbackGrounding();
      expect(tracker.hasGroundingCapacity()).toBe(true);
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
      expect(snapshot.grounding).toEqual({
        rpd: 1,
        limit: 500,
        remaining: 499,
      });
    });
  });

  describe("sliding window expiry", () => {
    it("expires entries older than 60s from RPM and TPM", () => {
      vi.useFakeTimers();
      const limits: TierLimits = { rpm: 2, tpm: 1000, rpd: 100 };

      try {
        // Reserve at T=0
        tracker.reserve("model-a", 100);

        // Advance past 60s
        vi.advanceTimersByTime(61_000);

        // RPM and TPM should have expired, but RPD persists (daily counter)
        expect(tracker.hasCapacity("model-a", 100, limits)).toBe(true);

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
  let tracker: QuotaTracker;
  let emptyBreakers: Set<string>;

  beforeEach(() => {
    tracker = new QuotaTracker(500);
    emptyBreakers = new Set();
  });

  it("routes to cheapest model by default on PAID tier", () => {
    const router = new SmartRouter(tracker, "PAID");
    const route = router.getNextAvailableRoute(100, {}, emptyBreakers);

    // gemini-2.5-flash-lite is the cheapest at $0.40/M
    expect(route.modelId).toBe("gemini-2.5-flash-lite");
    expect(route.tier).toBe("paid");
  });

  it("routes to cheapest free-tier model on FREE tier", () => {
    const router = new SmartRouter(tracker, "FREE");
    const route = router.getNextAvailableRoute(100, {}, emptyBreakers);

    // gemini-2.5-flash-lite is cheapest with hasFreeTier=true
    expect(route.modelId).toBe("gemini-2.5-flash-lite");
    expect(route.tier).toBe("free");
  });

  it("respects denyModels policy", () => {
    const router = new SmartRouter(tracker, "PAID");
    const route = router.getNextAvailableRoute(
      100,
      { denyModels: ["gemini-2.5-flash-lite"] },
      emptyBreakers,
    );

    expect(route.modelId).not.toBe("gemini-2.5-flash-lite");
  });

  it("respects allowModels policy", () => {
    const router = new SmartRouter(tracker, "PAID");
    const route = router.getNextAvailableRoute(
      100,
      { allowModels: ["gemini-2.5-flash"] },
      emptyBreakers,
    );

    expect(route.modelId).toBe("gemini-2.5-flash");
  });

  it("excludes circuit-broken models", () => {
    const router = new SmartRouter(tracker, "PAID");
    const breakers = new Set(["gemini-2.5-flash-lite"]);
    const route = router.getNextAvailableRoute(100, {}, breakers);

    expect(route.modelId).not.toBe("gemini-2.5-flash-lite");
  });

  it("excludes non-grounding models when grounding requested", () => {
    const router = new SmartRouter(tracker, "PAID");
    const route = router.getNextAvailableRoute(100, {}, emptyBreakers, true);

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.supportsGrounding).toBe(true);
  });

  it("excludes preview models by default", () => {
    const router = new SmartRouter(tracker, "PAID");
    const route = router.getNextAvailableRoute(100, {}, emptyBreakers);

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.stability).toBe("stable");
  });

  it("includes preview models when allowPreview is true on PAID tier", () => {
    const router = new SmartRouter(tracker, "PAID");

    // Deny all stable models to force preview selection
    const stableIds = GEMINI_REGISTRY.filter(
      (m) => m.stability === "stable",
    ).map((m) => m.id);

    const route = router.getNextAvailableRoute(
      100,
      { allowPreview: true, denyModels: stableIds },
      emptyBreakers,
    );

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.stability).toBe("preview");
  });

  it("throws when all models are exhausted", () => {
    const router = new SmartRouter(tracker, "FREE");

    // Circuit-break all free-tier models
    const freeModels = GEMINI_REGISTRY.filter((m) => m.hasFreeTier);
    const allBroken = new Set(freeModels.map((m) => m.id));

    expect(() => router.getNextAvailableRoute(100, {}, allBroken)).toThrow(
      "No models match routing criteria",
    );
  });

  // ── Model Preference Routing ────────────────────────────────────────

  it("prefers the requested model class", () => {
    const router = new SmartRouter(tracker, "PAID");

    // Prefer flash — should pick a flash model, not the cheapest (lite)
    const route = router.getNextAvailableRoute(
      100,
      { prefer: "flash" },
      emptyBreakers,
    );

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.modelClass).toBe("flash");
  });

  it("prefers Gemini 3 over Gemini 2 within the same class", () => {
    const router = new SmartRouter(tracker, "PAID");

    // Prefer lite — should pick gemini-3.1-flash-lite (gen 3)
    // over gemini-2.5-flash-lite (gen 2), despite the latter being cheaper
    const route = router.getNextAvailableRoute(
      100,
      { prefer: "lite" },
      emptyBreakers,
    );

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.modelClass).toBe("lite");
    expect(model?.generation).toBe(3);
  });

  it("falls back to other classes when preferred class is exhausted", () => {
    const router = new SmartRouter(tracker, "PAID");

    // Circuit-break ALL pro models
    const proIds = GEMINI_REGISTRY.filter((m) => m.modelClass === "pro").map(
      (m) => m.id,
    );
    const breakers = new Set(proIds);

    // Prefer pro — all pro models broken, should fall back to another class
    const route = router.getNextAvailableRoute(
      100,
      { prefer: "pro" },
      breakers,
    );

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.modelClass).not.toBe("pro");
    // Should still route successfully (graceful degradation)
    expect(route.modelId).toBeTruthy();
  });

  it("auto-enables preview models when prefer is set", () => {
    const router = new SmartRouter(tracker, "PAID");

    // Deny all stable models — without auto-preview, this would throw.
    // With prefer set, preview models are automatically allowed.
    // (Note: after gemini-3.1-flash-lite went GA on 2026-05-07 the only
    // remaining preview-class models are flash and pro, so the router
    // falls back to the cheapest preview rather than a lite. The test
    // asserts the *behavior* — preview models become eligible — rather
    // than a specific class to remain robust to future GA promotions.)
    const stableIds = GEMINI_REGISTRY.filter(
      (m) => m.stability === "stable",
    ).map((m) => m.id);

    const route = router.getNextAvailableRoute(
      100,
      { prefer: "lite", denyModels: stableIds },
      emptyBreakers,
    );

    const model = GEMINI_REGISTRY.find((m) => m.id === route.modelId);
    expect(model?.stability).toBe("preview");
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

// =============================================================================
// Unit Tests — AI Routing Layer (Smart Mesh v1.2)
// =============================================================================
// Pure-logic tests for all 4 routing modules. Zero I/O — no network calls,
// no database, no mocks of external services. A settings mock holds the
// models discovery found, and fake timers pin the clock for the usage
// windows and the daily reset.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Discovered models are a DB-backed setting; the registry tests drive them
// through this mock.
const settingsStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../../../server/services/settingsService.ts", () => ({
  getSetting: (key: string) => settingsStore.get(key) ?? null,
  SETTING_KEYS: { aiModelCache: "ai.modelCache" },
}));

// ── Module imports ───────────────────────────────────────────────────────────
import {
  compareForClass,
  previewModelForClass,
  GEMINI_REGISTRY,
  type ModelConfig,
} from "../../../../server/ai/routing/registry.ts";
import { QuotaTracker } from "../../../../server/ai/routing/QuotaTracker.ts";
import { SmartRouter } from "../../../../server/ai/routing/SmartRouter.ts";

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
      expect(
        Object.keys(model).filter((key) => /rpm|tpm|rpd|limit|tier/i.test(key)),
      ).toEqual([]);
    }
  });

  it("names what Auto runs for each class", () => {
    expect(previewModelForClass("lite")).toBe("gemini-3.5-flash-lite");
    expect(previewModelForClass("flash")).toBe("gemini-3.8-flash");
    expect(previewModelForClass("pro")).toBe("gemini-3.1-pro-preview");
  });

  it("names a model that can search when research asks", () => {
    // Discovery found a newer flash model that cannot search.
    settingsStore.set("ai.modelCache", {
      gemini: {
        models: [
          {
            id: "gemini-3.9-flash",
            label: "gemini-3.9-flash",
            capabilities: ["chat"],
            capabilityConfidence: "declared",
          },
        ],
      },
    });
    try {
      // Plain work runs it, as the newest flash model…
      expect(previewModelForClass("flash")).toBe("gemini-3.9-flash");
      // …but research needs a model that can search.
      expect(previewModelForClass("flash", true)).toBe("gemini-3.8-flash");
    } finally {
      settingsStore.clear();
    }
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

  describe("reconcile", () => {
    it("clamps to zero — never produces negative token counts", () => {
      const id = tracker.reserve("model-a", 100);
      tracker.reconcile("model-a", 100, 10, id);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(10);

      // Bad data: a negative count would push TPM below zero without the clamp
      tracker.reconcile("model-a", 100, -5, id);
      expect(tracker.getSnapshot().models["model-a"].tpm).toBe(0);
    });
  });

  describe("grounded requests", () => {
    it("counts them and takes one back", () => {
      tracker.reserveGrounding();
      const reservedDate = tracker.reserveGrounding();
      tracker.rollbackGrounding(reservedDate);
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
        // Mid-afternoon Pacific, so the 61 s never cross the daily reset.
        vi.setSystemTime(new Date("2026-09-09T20:00:00Z"));
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

describe("concurrent quota reservations", () => {
  it("reconciles and rolls back the correct request when completions arrive out of order", () => {
    const tracker = new QuotaTracker();
    const first = tracker.reserve("same", 100);
    const second = tracker.reserve("same", 200);
    tracker.reconcile("same", 100, 40, first);
    expect(tracker.getSnapshot().models.same.tpm).toBe(240);
    tracker.rollback("same", second);
    expect(tracker.getSnapshot().models.same).toEqual({
      tpm: 40,
      rpm: 1,
      rpd: 1,
    });
    tracker.rollback("same", second);
    expect(tracker.getSnapshot().models.same.rpd).toBe(1);
  });
  it.each([
    ["2026-09-09T06:59:00Z", "2026-09-09T07:01:00Z"],
    ["2026-12-09T07:59:00Z", "2026-12-09T08:01:00Z"],
  ])("resets daily quotas at Pacific midnight from %s", (before, after) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(before));
      const tracker = new QuotaTracker();
      tracker.reserve("same", 100);
      tracker.reserveGrounding();
      vi.setSystemTime(new Date(after));
      const snapshot = tracker.getSnapshot();
      expect(snapshot.models.same).toEqual({ rpm: 0, tpm: 0, rpd: 0 });
      expect(snapshot.grounding.rpd).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps the quota at UTC midnight and preserves new-day usage after an old rejection", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-08T23:59:00Z"));
      const tracker = new QuotaTracker();
      const oldRequest = tracker.reserve("same", 100);
      const oldGroundingDate = tracker.reserveGrounding();
      vi.setSystemTime(new Date("2026-09-09T00:01:00Z"));
      expect(tracker.getSnapshot().models.same.rpd).toBe(1);
      expect(tracker.getSnapshot().grounding.rpd).toBe(1);
      vi.setSystemTime(new Date("2026-09-09T07:01:00Z"));
      tracker.reserve("same", 50);
      tracker.reserveGrounding();
      tracker.rollback("same", oldRequest);
      tracker.rollbackGrounding(oldGroundingDate);
      expect(tracker.getSnapshot().models.same.rpd).toBe(1);
      expect(tracker.getSnapshot().grounding.rpd).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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

  it("steps past a paused model to the next in its class", () => {
    const route = router.getNextAvailableRoute(
      { prefer: "flash" },
      new Set(["gemini-3.8-flash"]),
    );
    expect(route.modelId).toBe("gemini-3.7-flash");
  });

  it("keeps grounded requests on models that can search", () => {
    const registry: ModelConfig[] = [
      {
        id: "no-search",
        modelClass: "flash",
        generation: 4,
        stability: "stable",
        costPerM: 1,
        supportsGrounding: false,
      },
      {
        id: "search",
        modelClass: "flash",
        generation: 3,
        stability: "stable",
        costPerM: 1,
        supportsGrounding: true,
      },
    ];
    const mixed = new SmartRouter(registry);
    // The newer model wins a plain request…
    expect(
      mixed.getNextAvailableRoute({ prefer: "flash" }, noPauses).modelId,
    ).toBe("no-search");
    // …but a grounded one stays on the model that can search.
    expect(
      mixed.getNextAvailableRoute({ prefer: "flash" }, noPauses, true).modelId,
    ).toBe("search");
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

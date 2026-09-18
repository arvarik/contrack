import { describe, it, expect } from "vitest";
import {
  DEFAULT_PULSE_LAYOUT,
  PULSE_COLUMNS,
  PULSE_CARD_IDS,
  resolveLayout,
  pulseLayoutReducer,
  MAX_CARDS_PER_COL,
} from "../../src/views/pulse/lib/layout";
import type { PulseLayout } from "../../src/views/pulse/lib/layout";

describe("pulse.layout", () => {
  it("provides sensible defaults for all 3 columns", () => {
    const layout = resolveLayout(DEFAULT_PULSE_LAYOUT);
    expect(PULSE_COLUMNS).toEqual(["focus", "network", "intel"]);
    expect(PULSE_CARD_IDS).toHaveLength(9);
    expect(MAX_CARDS_PER_COL).toBe(20);
    expect(layout.visible.focus).toEqual(["up-next", "completed"]);
    expect(layout.visible.network).toEqual([
      "activity",
      "momentum",
      "composition",
    ]);
    expect(layout.visible.intel).toEqual([
      "insight",
      "inbox",
      "coming-up",
      "new-people",
    ]);
    expect(layout.hidden).toEqual([]);
  });

  it("handles null or undefined layout gracefully", () => {
    const layout = resolveLayout(null);
    expect(layout.visible.focus).toContain("up-next");
    expect(layout.hidden).toEqual([]);
  });

  it("hides a visible card", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const next = pulseLayoutReducer(state, {
      type: "hide",
      cardId: "momentum",
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).toContain("momentum");
    expect(resolved.visible.network).not.toContain("momentum");
    expect(resolved.visible.network).toContain("activity");
    expect(resolved.visible.network).toContain("composition");
  });

  it("shows a previously hidden card", () => {
    const hiddenState: PulseLayout = {
      hidden: ["insight"],
      order: {
        focus: ["up-next", "completed"],
        network: ["activity", "momentum", "composition"],
        intel: ["inbox", "coming-up", "new-people"],
      },
    };
    const next = pulseLayoutReducer(hiddenState, {
      type: "show",
      cardId: "insight",
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).not.toContain("insight");
    expect(resolved.visible.intel).toContain("insight");
  });

  it("moves a card across columns", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const next = pulseLayoutReducer(state, {
      type: "move",
      cardId: "insight",
      targetColumn: "focus",
      targetIndex: 0,
    });
    const resolved = resolveLayout(next);
    expect(resolved.visible.focus[0]).toBe("insight");
    expect(resolved.visible.intel).not.toContain("insight");
  });

  it("reorders cards within a column", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const next = pulseLayoutReducer(state, {
      type: "reorder",
      column: "intel",
      cardIds: ["new-people", "coming-up", "inbox", "insight"],
    });
    const resolved = resolveLayout(next);
    expect(resolved.visible.intel).toEqual([
      "new-people",
      "coming-up",
      "inbox",
      "insight",
    ]);
  });

  it("resets layout back to default", () => {
    const modifiedState: PulseLayout = {
      hidden: ["up-next", "insight"],
      order: {
        focus: ["completed"],
        network: [],
        intel: ["inbox"],
      },
    };
    const reset = pulseLayoutReducer(modifiedState, { type: "reset" });
    const resolved = resolveLayout(reset);
    expect(resolved.hidden).toEqual([]);
    expect(resolved.visible.focus).toEqual(["up-next", "completed"]);
    expect(resolved.visible.network).toEqual([
      "activity",
      "momentum",
      "composition",
    ]);
  });

  it("drops unknown card ids and ignores hide/show/move for unknown cards", () => {
    const dirtyLayout: PulseLayout = {
      hidden: ["bogus-card", "random-id", "up-next"],
      order: {
        focus: ["fake-1", "completed"],
        network: ["fake-2", "activity"],
        intel: ["fake-3"],
      },
    };
    const resolved = resolveLayout(dirtyLayout);
    expect(resolved.hidden).toEqual(["up-next"]);
    expect(resolved.hidden).not.toContain("bogus-card");
    expect(resolved.visible.focus).not.toContain("fake-1");
    expect(resolved.visible.focus).toContain("completed");

    // Ignored action on unknown card
    const state = DEFAULT_PULSE_LAYOUT;
    const unmod = pulseLayoutReducer(state, {
      type: "hide",
      cardId: "alien-card",
    });
    expect(unmod).toEqual(state);
  });

  it("unhides a card when moved directly to a target column", () => {
    const hiddenState: PulseLayout = {
      hidden: ["momentum"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(hiddenState, {
      type: "move",
      cardId: "momentum",
      targetColumn: "focus",
      targetIndex: 0,
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).not.toContain("momentum");
    expect(resolved.visible.focus[0]).toBe("momentum");
  });

  it("clamps out-of-bounds target indices on move", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const nextNegative = pulseLayoutReducer(state, {
      type: "move",
      cardId: "momentum",
      targetColumn: "focus",
      targetIndex: -5,
    });
    expect(resolveLayout(nextNegative).visible.focus[0]).toBe("momentum");

    const nextHuge = pulseLayoutReducer(state, {
      type: "move",
      cardId: "momentum",
      targetColumn: "focus",
      targetIndex: 999,
    });
    const resolvedHuge = resolveLayout(nextHuge);
    expect(
      resolvedHuge.visible.focus[resolvedHuge.visible.focus.length - 1],
    ).toBe("momentum");
  });

  it("shows card in an explicitly specified target column", () => {
    const hiddenState: PulseLayout = {
      hidden: ["momentum"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(hiddenState, {
      type: "show",
      cardId: "momentum",
      column: "focus",
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).not.toContain("momentum");
    expect(resolved.visible.focus).toContain("momentum");
    expect(resolved.visible.network).not.toContain("momentum");
  });

  it("returns same state when hiding an already hidden card", () => {
    const state: PulseLayout = {
      hidden: ["momentum"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(state, {
      type: "hide",
      cardId: "momentum",
    });
    expect(next).toBe(state);
  });
});

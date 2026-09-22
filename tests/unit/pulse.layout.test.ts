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
    expect(PULSE_CARD_IDS).toHaveLength(8);
    expect(MAX_CARDS_PER_COL).toBe(20);
    expect(layout.visible.focus).toEqual(["up-next", "completed"]);
    // The Network column is the people you track and their habits.
    expect(layout.visible.network).toEqual(["keeping-up", "activity"]);
    // Composition is last in Intelligence, and New people is gone.
    expect(layout.visible.intel).toEqual([
      "insight",
      "inbox",
      "coming-up",
      "composition",
    ]);
    expect(layout.hidden).toEqual([]);
    expect(PULSE_CARD_IDS).not.toContain("new-people");
  });

  it("handles null or undefined layout gracefully", () => {
    const layout = resolveLayout(null);
    expect(layout.visible.focus).toContain("up-next");
    expect(layout.hidden).toEqual([]);
  });

  // The server's default preference is an empty order, not a missing one.
  // Every card is restored, and in the default order of its column.
  it("restores an empty stored order to the default order, column by column", () => {
    const layout = resolveLayout({ hidden: [], order: {} });
    expect(layout).toEqual(resolveLayout(null));
    expect(layout.visible.intel).toEqual([
      "insight",
      "inbox",
      "coming-up",
      "composition",
    ]);
    // A column with one card named keeps it first, then the rest in order.
    const partial = resolveLayout({
      hidden: [],
      order: { intel: ["coming-up"] },
    });
    expect(partial.visible.intel).toEqual([
      "coming-up",
      "insight",
      "inbox",
      "composition",
    ]);
  });

  it("hides a visible card", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const next = pulseLayoutReducer(state, {
      type: "hide",
      cardId: "keeping-up",
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).toContain("keeping-up");
    expect(resolved.visible.network).not.toContain("keeping-up");
    expect(resolved.visible.network).toContain("activity");
  });

  it("shows a previously hidden card", () => {
    const hiddenState: PulseLayout = {
      hidden: ["insight"],
      order: {
        focus: ["up-next", "completed"],
        network: ["keeping-up", "activity"],
        intel: ["inbox", "coming-up", "composition"],
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
      cardIds: ["composition", "coming-up", "inbox", "insight"],
    });
    const resolved = resolveLayout(next);
    expect(resolved.visible.intel).toEqual([
      "composition",
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
    expect(resolved.visible.network).toEqual(["keeping-up", "activity"]);
    expect(resolved.visible.intel).toEqual([
      "insight",
      "inbox",
      "coming-up",
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
      hidden: ["keeping-up"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(hiddenState, {
      type: "move",
      cardId: "keeping-up",
      targetColumn: "focus",
      targetIndex: 0,
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).not.toContain("keeping-up");
    expect(resolved.visible.focus[0]).toBe("keeping-up");
  });

  it("clamps out-of-bounds target indices on move", () => {
    const state = DEFAULT_PULSE_LAYOUT;
    const nextNegative = pulseLayoutReducer(state, {
      type: "move",
      cardId: "keeping-up",
      targetColumn: "focus",
      targetIndex: -5,
    });
    expect(resolveLayout(nextNegative).visible.focus[0]).toBe("keeping-up");

    const nextHuge = pulseLayoutReducer(state, {
      type: "move",
      cardId: "keeping-up",
      targetColumn: "focus",
      targetIndex: 999,
    });
    const resolvedHuge = resolveLayout(nextHuge);
    expect(
      resolvedHuge.visible.focus[resolvedHuge.visible.focus.length - 1],
    ).toBe("keeping-up");
  });

  it("shows card in an explicitly specified target column", () => {
    const hiddenState: PulseLayout = {
      hidden: ["keeping-up"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(hiddenState, {
      type: "show",
      cardId: "keeping-up",
      column: "focus",
    });
    const resolved = resolveLayout(next);
    expect(resolved.hidden).not.toContain("keeping-up");
    expect(resolved.visible.focus).toContain("keeping-up");
    expect(resolved.visible.network).not.toContain("keeping-up");
  });

  it("returns same state when hiding an already hidden card", () => {
    const state: PulseLayout = {
      hidden: ["keeping-up"],
      order: {
        focus: ["up-next"],
        network: ["activity"],
        intel: ["insight"],
      },
    };
    const next = pulseLayoutReducer(state, {
      type: "hide",
      cardId: "keeping-up",
    });
    expect(next).toBe(state);
  });

  // A layout stored before the Momentum card became Keeping up. The old id
  // is unknown now and drops out. The new id is not named, so the card comes
  // back in its default place: first in the Network column.
  it("drops a stored momentum id and shows Keeping up in its default place", () => {
    const stored: PulseLayout = {
      hidden: ["momentum"],
      order: {
        focus: ["up-next", "completed"],
        network: ["activity", "momentum", "composition"],
        intel: ["insight", "inbox", "coming-up"],
      },
    };
    const resolved = resolveLayout(stored);
    expect(resolved.hidden).toEqual([]);
    expect(resolved.visible.network).toEqual([
      "activity",
      "composition",
      "keeping-up",
    ]);
    expect(Object.values(resolved.visible).flat()).not.toContain("momentum");
  });

  // A layout stored before New people folded into Inbox. The id is unknown
  // now and drops out of the order and the hidden list alike. Composition
  // keeps the place the person gave it.
  it("drops a stored new-people id from the order and from the hidden list", () => {
    const stored: PulseLayout = {
      hidden: ["new-people"],
      order: {
        focus: ["up-next", "completed"],
        network: ["keeping-up", "activity", "composition"],
        intel: ["insight", "inbox", "coming-up", "new-people"],
      },
    };
    const resolved = resolveLayout(stored);
    expect(resolved.hidden).toEqual([]);
    expect(resolved.visible.intel).toEqual(["insight", "inbox", "coming-up"]);
    expect(resolved.visible.network).toEqual([
      "keeping-up",
      "activity",
      "composition",
    ]);
    expect(Object.values(resolved.visible).flat()).not.toContain("new-people");
  });

  it("shows Keeping up in the Network column when a stored order does not name it", () => {
    const stored: PulseLayout = {
      hidden: [],
      order: {
        focus: ["up-next", "completed"],
        network: ["composition", "activity"],
        intel: ["insight", "inbox", "coming-up"],
      },
    };
    const resolved = resolveLayout(stored);
    expect(resolved.visible.network).toEqual([
      "composition",
      "activity",
      "keeping-up",
    ]);
  });
});

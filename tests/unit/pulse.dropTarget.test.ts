// =============================================================================
// Where a card lands in customize mode
// =============================================================================
// `lib/dropTarget.ts` is the geometry of the drag: which column the pointer
// is in, which place in that column, and one keyboard step at a time. It is
// pure, so the boxes here are written out by hand, in px, the way the page
// lays them out at 1440 px (three columns side by side), at 1024 px (the
// Intelligence column as a grid two across) and on a phone (one column).
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  columnDropId,
  insertionIndex,
  keyboardStep,
  overIdFor,
  pickColumn,
  positionOf,
  slotAim,
  targetFor,
  visualColumnOrder,
  type Box,
} from "../../src/views/pulse/lib/dropTarget";
import {
  DEFAULT_PULSE_LAYOUT,
  resolveLayout,
  type PulseCardId,
  type VisibleColumns,
} from "../../src/views/pulse/lib/layout";

const box = (
  left: number,
  top: number,
  width: number,
  height: number,
): Box => ({
  left,
  top,
  width,
  height,
});

const start = (): VisibleColumns => resolveLayout(DEFAULT_PULSE_LAYOUT).visible;

describe("pickColumn", () => {
  // 1440 px: Focus, Intelligence, Network side by side, of three heights.
  const wide = [
    { id: "focus" as const, rect: box(100, 120, 530, 800) },
    { id: "intel" as const, rect: box(646, 120, 320, 1100) },
    { id: "network" as const, rect: box(982, 120, 420, 520) },
  ];

  it("takes the column whose width holds the pointer", () => {
    expect(pickColumn(wide, { x: 300, y: 400 })).toBe("focus");
    expect(pickColumn(wide, { x: 800, y: 900 })).toBe("intel");
    expect(pickColumn(wide, { x: 1200, y: 300 })).toBe("network");
  });

  it("gives the empty space under a short column to that column", () => {
    // Under Network's last card, level with Intelligence's fourth card.
    expect(pickColumn(wide, { x: 1200, y: 1000 })).toBe("network");
  });

  it("gives a pointer in a gutter to the nearest column", () => {
    expect(pickColumn(wide, { x: 636, y: 300 })).toBe("focus");
    expect(pickColumn(wide, { x: 640, y: 300 })).toBe("intel");
  });

  it("picks between stacked columns by height", () => {
    // 1024 px: Focus beside Network, Intelligence under both, full width.
    const stacked = [
      { id: "focus" as const, rect: box(100, 120, 380, 700) },
      { id: "network" as const, rect: box(496, 120, 520, 600) },
      { id: "intel" as const, rect: box(100, 836, 916, 700) },
    ];
    expect(pickColumn(stacked, { x: 300, y: 500 })).toBe("focus");
    expect(pickColumn(stacked, { x: 300, y: 900 })).toBe("intel");
    // Under Network, nearer to it than to the grid below.
    expect(pickColumn(stacked, { x: 700, y: 760 })).toBe("network");
    expect(pickColumn(stacked, { x: 700, y: 820 })).toBe("intel");
  });

  it("answers null only when there are no columns", () => {
    expect(pickColumn([], { x: 0, y: 0 })).toBeNull();
  });
});

describe("insertionIndex", () => {
  // A list: Up next (800 px), then a 40 px line, then a 160 px card.
  const list = [
    box(0, 0, 400, 800),
    box(0, 824, 400, 40),
    box(0, 888, 400, 160),
  ];

  it("puts the card before the first card whose middle is below the pointer", () => {
    expect(insertionIndex(list, { x: 200, y: 10 }, "list")).toBe(0);
    expect(insertionIndex(list, { x: 200, y: 399 }, "list")).toBe(0);
    // Past Up next's middle, not its top: a tall card is passed at its half.
    expect(insertionIndex(list, { x: 200, y: 401 }, "list")).toBe(1);
    expect(insertionIndex(list, { x: 200, y: 850 }, "list")).toBe(2);
    expect(insertionIndex(list, { x: 200, y: 2000 }, "list")).toBe(3);
  });

  it("puts the card first in an empty column", () => {
    expect(insertionIndex([], { x: 0, y: 0 }, "list")).toBe(0);
    expect(insertionIndex([], { x: 0, y: 0 }, "grid")).toBe(0);
  });

  // A grid two across with rows of different heights, cells stretched to
  // their row: row 1 (insight, inbox) 280 px, row 2 (coming up, composition)
  // 440 px.
  const grid = [
    box(0, 0, 450, 280),
    box(474, 0, 450, 280),
    box(0, 304, 450, 440),
    box(474, 304, 450, 440),
  ];

  it("reads a grid in reading order: the row, then left or right of each middle", () => {
    expect(insertionIndex(grid, { x: 100, y: 100 }, "grid")).toBe(0);
    expect(insertionIndex(grid, { x: 300, y: 100 }, "grid")).toBe(1);
    expect(insertionIndex(grid, { x: 600, y: 100 }, "grid")).toBe(1);
    expect(insertionIndex(grid, { x: 800, y: 100 }, "grid")).toBe(2);
    expect(insertionIndex(grid, { x: 100, y: 500 }, "grid")).toBe(2);
    expect(insertionIndex(grid, { x: 800, y: 700 }, "grid")).toBe(4);
  });

  it("splits the rows halfway through the gap, and ends under the last row", () => {
    // The gap runs from 280 to 304: its halfway line is 292.
    expect(insertionIndex(grid, { x: 100, y: 291 }, "grid")).toBe(0);
    expect(insertionIndex(grid, { x: 100, y: 293 }, "grid")).toBe(2);
    expect(insertionIndex(grid, { x: 100, y: 900 }, "grid")).toBe(4);
  });

  it("fills a short last row from the left", () => {
    const three = grid.slice(0, 3);
    expect(insertionIndex(three, { x: 800, y: 400 }, "grid")).toBe(3);
    expect(insertionIndex(three, { x: 100, y: 400 }, "grid")).toBe(2);
  });
});

describe("visualColumnOrder", () => {
  it("reads the columns row by row, left to right", () => {
    // 1440 px.
    expect(
      visualColumnOrder([
        { id: "focus", rect: box(100, 120, 530, 800) },
        { id: "network", rect: box(982, 120, 420, 520) },
        { id: "intel", rect: box(646, 120, 320, 1100) },
      ]),
    ).toEqual(["focus", "intel", "network"]);
    // 1024 px.
    expect(
      visualColumnOrder([
        { id: "focus", rect: box(100, 120, 380, 700) },
        { id: "intel", rect: box(100, 836, 916, 700) },
        { id: "network", rect: box(496, 120, 520, 600) },
      ]),
    ).toEqual(["focus", "network", "intel"]);
  });

  it("keeps the order it was given when every box is at 0", () => {
    const zero = box(0, 0, 0, 0);
    expect(
      visualColumnOrder([
        { id: "focus", rect: zero },
        { id: "network", rect: zero },
        { id: "intel", rect: zero },
      ]),
    ).toEqual(["focus", "network", "intel"]);
  });
});

describe("keyboardStep", () => {
  const order = ["focus", "intel", "network"] as const;

  it("moves one place down or up through a column", () => {
    expect(keyboardStep(start(), "keeping-up", "down", order)).toEqual({
      column: "network",
      index: 1,
    });
    expect(keyboardStep(start(), "coming-up", "up", order)).toEqual({
      column: "intel",
      index: 1,
    });
  });

  it("goes on past a column's end into the next column in reading order", () => {
    // Completed is last in Focus. Intelligence follows Focus at 1440.
    expect(keyboardStep(start(), "completed", "down", order)).toEqual({
      column: "intel",
      index: 0,
    });
    // Insight is first in Intelligence: up goes to the end of Focus.
    expect(keyboardStep(start(), "insight", "up", order)).toEqual({
      column: "focus",
      index: 2,
    });
  });

  it("moves left and right to the column beside, at the same place or its end", () => {
    expect(keyboardStep(start(), "coming-up", "right", order)).toEqual({
      column: "network",
      index: 2,
    });
    expect(keyboardStep(start(), "inbox", "left", order)).toEqual({
      column: "focus",
      index: 1,
    });
  });

  it("answers null at the edges", () => {
    expect(keyboardStep(start(), "up-next", "up", order)).toBeNull();
    expect(keyboardStep(start(), "up-next", "left", order)).toBeNull();
    expect(keyboardStep(start(), "activity", "down", order)).toBeNull();
    expect(keyboardStep(start(), "activity", "right", order)).toBeNull();
  });
});

describe("overIdFor and targetFor", () => {
  it("names a place by the card the moved card goes before", () => {
    expect(
      overIdFor(start(), "keeping-up", { column: "intel", index: 2 }),
    ).toBe("coming-up");
    expect(targetFor(start(), "keeping-up", "coming-up")).toEqual({
      column: "intel",
      index: 2,
    });
  });

  it("names a column's end by the column's own droppable", () => {
    expect(
      overIdFor(start(), "keeping-up", { column: "focus", index: 2 }),
    ).toBe(columnDropId("focus"));
    expect(targetFor(start(), "keeping-up", "column-focus")).toEqual({
      column: "focus",
      index: 2,
    });
  });

  it("counts places without the moved card, so its own place round-trips", () => {
    const place = targetFor(start(), "keeping-up", "activity");
    expect(place).toEqual({ column: "network", index: 0 });
    expect(overIdFor(start(), "keeping-up", place!)).toBe("activity");
    expect(targetFor(start(), "keeping-up", "keeping-up")).toEqual({
      column: "network",
      index: 0,
    });
  });

  it("knows no id it has not made", () => {
    expect(targetFor(start(), "keeping-up", "column-nowhere")).toBeNull();
    expect(targetFor(start(), "keeping-up", "not-a-card")).toBeNull();
  });
});

describe("slotAim", () => {
  const boxes: Record<string, Box> = {
    "keeping-up": box(982, 120, 420, 64),
    activity: box(982, 208, 420, 466),
    "column-focus": box(96, 116, 538, 900),
    insight: box(646, 120, 320, 330),
    inbox: box(646, 474, 320, 140),
  };
  const boxOf = (id: string) => boxes[id];

  it("aims a step later in the column under the card it passes", () => {
    // Keeping up's slot passes Activity, which rises by a slot and a gap.
    expect(
      slotAim(
        start(),
        "keeping-up",
        { column: "network", index: 1 },
        boxOf,
        24,
        64,
      ),
    ).toEqual({ x: 982, y: 208 + 466 - 64 });
  });

  it("aims at the top of the card it goes before in another column", () => {
    expect(
      slotAim(
        start(),
        "keeping-up",
        { column: "intel", index: 1 },
        boxOf,
        24,
        64,
      ),
    ).toEqual({ x: 646, y: 474 });
  });

  it("aims a gap under the last card, or at the top of an empty column", () => {
    const shortIntel: VisibleColumns = {
      ...start(),
      intel: ["insight", "inbox"],
    };
    expect(
      slotAim(
        shortIntel,
        "keeping-up",
        { column: "intel", index: 2 },
        boxOf,
        24,
        64,
      ),
    ).toEqual({ x: 646, y: 474 + 140 + 24 });
    const emptyFocus: VisibleColumns = { ...start(), focus: [] };
    expect(
      slotAim(
        emptyFocus,
        "keeping-up",
        { column: "focus", index: 0 },
        boxOf,
        24,
        64,
      ),
    ).toEqual({ x: 100, y: 120 });
  });

  it("answers null when a box it needs is missing", () => {
    expect(
      slotAim(
        start(),
        "keeping-up",
        { column: "intel", index: 2 },
        boxOf,
        24,
        64,
      ),
    ).toBeNull();
  });
});

describe("positionOf", () => {
  it("counts a card's place from 1 of its column", () => {
    expect(positionOf(start(), "coming-up")).toEqual({
      column: "intel",
      position: 3,
      total: 4,
    });
    expect(positionOf(start(), "not-a-card" as PulseCardId)).toBeNull();
  });
});

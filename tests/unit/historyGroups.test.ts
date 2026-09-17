import { describe, it, expect } from "vitest";
import { groupHistoryEntries } from "../../src/views/search/historyGroups";
import type { HistoryEntry } from "../../shared/searchHistory";

function makeEntry(
  id: string,
  lastRunAt: string,
  query: string,
  pinned = false,
  mode: "people" | "notes" | "palette" = "people",
): HistoryEntry {
  return {
    id,
    ownerId: "user-1",
    mode,
    query,
    normalizedQuery: query.toLowerCase(),
    resultCount: 5,
    resultIds: ["c1", "c2"],
    fallback: false,
    pinned,
    runCount: 1,
    createdAt: lastRunAt,
    lastRunAt,
  };
}

describe("groupHistoryEntries", () => {
  // Let fixed clock be Thursday, September 17, 2026, 12:00:00 UTC
  // Monday of this week: September 14, 2026
  // Sunday of this week: September 20, 2026
  const clock = new Date("2026-09-17T12:00:00.000Z");

  it("groups entries into Pinned, Today, Yesterday, This week, and months in order", () => {
    const entries: HistoryEntry[] = [
      makeEntry("1", "2026-09-17T10:00:00.000Z", "Today question"),
      makeEntry("2", "2026-09-16T15:00:00.000Z", "Yesterday question"),
      makeEntry("3", "2026-09-15T09:00:00.000Z", "Earlier this week question"),
      makeEntry("4", "2026-08-20T14:00:00.000Z", "August question"),
      makeEntry("5", "2026-07-04T12:00:00.000Z", "July question"),
    ];

    const groups = groupHistoryEntries(entries, clock);

    expect(groups.map((g) => g.label)).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "August 2026",
      "July 2026",
    ]);

    expect(groups[0].entries.map((e) => e.id)).toEqual(["1"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["2"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["3"]);
    expect(groups[3].entries.map((e) => e.id)).toEqual(["4"]);
    expect(groups[4].entries.map((e) => e.id)).toEqual(["5"]);
  });

  it("puts pinned rows in Pinned only, never duplicating into Today or other groups", () => {
    const entries: HistoryEntry[] = [
      makeEntry(
        "pinned-today",
        "2026-09-17T11:00:00.000Z",
        "Pinned asked today",
        true,
      ),
      makeEntry(
        "unpinned-today",
        "2026-09-17T10:00:00.000Z",
        "Regular asked today",
        false,
      ),
      makeEntry(
        "pinned-august",
        "2026-08-15T10:00:00.000Z",
        "Pinned asked in August",
        true,
      ),
    ];

    const groups = groupHistoryEntries(entries, clock);

    expect(groups.map((g) => g.label)).toEqual(["Pinned", "Today"]);

    // Pinned group contains both pinned entries
    expect(groups[0].entries.map((e) => e.id)).toEqual([
      "pinned-today",
      "pinned-august",
    ]);

    // Today group contains ONLY unpinned-today
    expect(groups[1].entries.map((e) => e.id)).toEqual(["unpinned-today"]);

    // Verify each row appears exactly once across all groups
    const allGroupedIds = groups.flatMap((g) => g.entries.map((e) => e.id));
    expect(allGroupedIds).toEqual([
      "pinned-today",
      "pinned-august",
      "unpinned-today",
    ]);
  });

  it("returns empty array if no entries are provided", () => {
    const groups = groupHistoryEntries([], clock);
    expect(groups).toEqual([]);
  });
});

// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapContact } from "../../../../shared/geo";

const computeMapStats = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/views/map/mapStats", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../src/views/map/mapStats")>();
  computeMapStats.mockImplementation(actual.computeMapStats);
  return { ...actual, computeMapStats };
});

import { useMapStats } from "../../../../src/views/map/useMapStats";

const contact: MapContact = {
  id: "1",
  name: "Ada Lovelace",
  company: "Babbage & Co",
  role: null,
  industry: "Computing",
  location: "London, UK",
  avatarUrl: null,
  isTracked: true,
  lat: 51.5074,
  lng: -0.1278,
  relationshipScore: null,
  lastContactedAt: null,
  nextFollowUpAt: null,
  interactionCount: 0,
  tags: [],
  lists: [],
};

/** One array, as the page passes one memoised list between renders. */
const one = [contact];
const two = [contact, { ...contact, id: "2" }];

describe("useMapStats", () => {
  beforeEach(() => {
    computeMapStats.mockClear();
  });

  // Each count walks every contact on the map, so the first render reads the
  // view once, and the effect after it does not read it again.
  it("reads the view once when it mounts", () => {
    const { result } = renderHook(() =>
      useMapStats({ contacts: one, map: null }),
    );
    expect(result.current.stats.inView).toBe(1);
    expect(computeMapStats).toHaveBeenCalledTimes(1);
  });

  it("reads the view again when the contacts change", () => {
    const { rerender } = renderHook(
      ({ contacts }) => useMapStats({ contacts, map: null }),
      { initialProps: { contacts: one } },
    );
    rerender({ contacts: two });
    expect(computeMapStats).toHaveBeenCalledTimes(2);
  });

  it("reads the view again when a cover opens", () => {
    const { rerender } = renderHook(
      ({ covers }) => useMapStats({ contacts: one, map: null, covers }),
      { initialProps: { covers: "false:" } },
    );
    rerender({ covers: "true:" });
    expect(computeMapStats).toHaveBeenCalledTimes(2);
  });
});

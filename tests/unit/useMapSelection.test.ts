// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useMapSelection } from "../../src/views/map/useMapSelection";
import type { MapContact } from "../../shared/geo";

describe("useMapSelection", () => {
  const contacts: MapContact[] = [
    {
      id: "c1",
      name: "Ada Lovelace",
      company: "Babbage & Co",
      location: "London, UK",
      avatarUrl: null,
      lat: 51.5074,
      lng: -0.1278,
    },
    {
      id: "c2",
      name: "Grace Hopper",
      company: "US Navy",
      location: "Arlington, VA",
      avatarUrl: null,
      lat: 38.8799,
      lng: -77.1067,
    },
    {
      id: "c3",
      name: "Katherine Johnson",
      company: "NASA",
      location: "Hampton, VA",
      avatarUrl: null,
      lat: 37.0299,
      lng: -76.3452,
    },
    {
      id: "c4",
      name: "Edsger Dijkstra",
      company: "UT Austin",
      location: "Austin, TX",
      avatarUrl: null,
      lat: 30.2672,
      lng: -97.7431,
    },
  ];

  it("selects only points inside a box", () => {
    const { result } = renderHook(() => useMapSelection({ contacts }));

    // Bounding box for Virginia: west -83.6, south 36.5, east -75.2, north 39.5
    act(() => {
      result.current.selectBox([-83.6, 36.5, -75.2, 39.5]);
    });

    // Grace Hopper (Arlington) and Katherine Johnson (Hampton) should be selected
    expect(result.current.selectedIds.has("c2")).toBe(true);
    expect(result.current.selectedIds.has("c3")).toBe(true);
    expect(result.current.selectedIds.has("c1")).toBe(false);
    expect(result.current.selectedIds.has("c4")).toBe(false);
    expect(result.current.selectedCount).toBe(2);
  });

  it("selects points using lasso polygon ring", () => {
    const { result } = renderHook(() => useMapSelection({ contacts }));

    // Polygon enclosing Texas (Austin):
    const texasRing = [
      { lng: -106.0, lat: 31.0 },
      { lng: -94.0, lat: 33.0 },
      { lng: -94.0, lat: 29.0 },
      { lng: -100.0, lat: 26.0 },
    ];

    act(() => {
      result.current.selectLasso(texasRing);
    });

    expect(result.current.selectedIds.has("c4")).toBe(true);
    expect(result.current.selectedIds.has("c1")).toBe(false);
    expect(result.current.selectedIds.has("c2")).toBe(false);
    expect(result.current.selectedCount).toBe(1);
  });

  it("adds cluster leaves without duplicates", async () => {
    const { result } = renderHook(() => useMapSelection({ contacts }));

    const getSource = vi.fn().mockReturnValue({
      getClusterLeaves: vi.fn().mockResolvedValue([
        { properties: { id: "c1" } },
        { properties: { id: "c2" } },
        { properties: { id: "c1" } }, // Duplicate leaf
      ]),
    });
    const mockMap = { getSource } as unknown as Parameters<
      typeof result.current.selectCluster
    >[1];

    await act(async () => {
      await result.current.selectCluster(101, mockMap);
    });

    expect(result.current.selectedIds.has("c1")).toBe(true);
    expect(result.current.selectedIds.has("c2")).toBe(true);
    expect(result.current.selectedCount).toBe(2);

    // Call again with another cluster that shares c2
    getSource.mockReturnValue({
      getClusterLeaves: vi
        .fn()
        .mockResolvedValue([
          { properties: { id: "c2" } },
          { properties: { id: "c3" } },
        ]),
    });

    await act(async () => {
      await result.current.selectCluster(102, mockMap);
    });

    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedCount).toBe(3);
  });

  it("clears selection when clear() is called or Escape key is pressed", () => {
    const { result } = renderHook(() => useMapSelection({ contacts }));

    act(() => {
      result.current.addMany(["c1", "c2"]);
    });
    expect(result.current.selectedCount).toBe(2);

    // Press Escape
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.selectedCount).toBe(0);
  });

  it("tracks visible and hidden selection count when filtered", () => {
    const filteredContacts = [contacts[0], contacts[1]]; // Only c1 and c2 visible
    const { result } = renderHook(() =>
      useMapSelection({ contacts, filteredContacts }),
    );

    act(() => {
      result.current.addMany(["c1", "c3"]); // c3 is hidden by filter
    });

    expect(result.current.selectedCount).toBe(2);
    expect(result.current.visibleSelectedCount).toBe(1);
    expect(result.current.hiddenCount).toBe(1);
    expect(result.current.announcement).toBe(
      "2 people selected (1 hidden by filter)",
    );
  });
});

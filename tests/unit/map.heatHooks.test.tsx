// @vitest-environment jsdom
/**
 * The heat layer's three hooks: its ramp read from the page's accent, the
 * zoom where the pins come back, and its place under the basemap's labels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Map as MapLibreMap } from "maplibre-gl";

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ mode: "light", preferences: { accent: "#006a91" } }),
}));

const { HEAT_LAYER_ID, useHeatStops, useHeatUnderLabels, useZoomAtLeast } =
  await import("../../src/views/map/heat");

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--color-primary");
});

interface Layer {
  id: string;
  type: string;
  source?: string;
}

/** Enough of a MapLibre map for the hooks: layers, sources, zoom, events. */
function fakeMap(layers: Layer[], sources: Record<string, { type: string }>) {
  const handlers = new Map<string, Set<() => void>>();
  let order = layers.map((layer) => layer.id);
  let zoom = 3;
  const map = {
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    getLayersOrder: () => order,
    getSource: (id: string) => sources[id],
    moveLayer: vi.fn((id: string, before: string) => {
      order = order.filter((other) => other !== id);
      order.splice(order.indexOf(before), 0, id);
    }),
    getZoom: () => zoom,
    on: (event: string, fn: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: () => void) => handlers.get(event)?.delete(fn),
  };
  const emit = (event: string) => handlers.get(event)?.forEach((fn) => fn());
  const listening = (event: string) => handlers.get(event)?.size ?? 0;
  const setZoom = (next: number) => {
    zoom = next;
    emit("zoom");
  };
  return {
    map: map as unknown as MapLibreMap,
    raw: map,
    emit,
    listening,
    setZoom,
    order: () => order,
  };
}

const BASEMAP: Layer[] = [
  { id: "background", type: "background" },
  { id: "water", type: "fill" },
  { id: "road", type: "line" },
  { id: "place_city", type: "symbol", source: "openmaptiles" },
];

describe("useHeatUnderLabels", () => {
  it("moves the heat under the first label, and again after a new style", () => {
    const layers: Layer[] = [
      ...BASEMAP,
      { id: HEAT_LAYER_ID, type: "heatmap", source: "contacts-heat" },
      // The app's own layer over GeoJSON is not the basemap's.
      { id: "contacts-presence", type: "circle", source: "contacts" },
    ];
    const fake = fakeMap(layers, {
      openmaptiles: { type: "vector" },
      "contacts-heat": { type: "geojson" },
      contacts: { type: "geojson" },
    });
    const { unmount } = renderHook(() => useHeatUnderLabels(fake.map, true));
    expect(fake.raw.moveLayer).toHaveBeenCalledWith(
      HEAT_LAYER_ID,
      "place_city",
    );
    expect(fake.order().indexOf(HEAT_LAYER_ID)).toBeLessThan(
      fake.order().indexOf("place_city"),
    );

    // Already under the labels: a style event moves nothing.
    fake.raw.moveLayer.mockClear();
    fake.emit("styledata");
    expect(fake.raw.moveLayer).not.toHaveBeenCalled();

    unmount();
    expect(fake.listening("styledata")).toBe(0);
  });

  it("does nothing while the heat is off", () => {
    const fake = fakeMap(BASEMAP, { openmaptiles: { type: "vector" } });
    renderHook(() => useHeatUnderLabels(fake.map, false));
    expect(fake.listening("styledata")).toBe(0);
    expect(fake.raw.moveLayer).not.toHaveBeenCalled();
  });
});

describe("useZoomAtLeast", () => {
  it("changes only when the zoom crosses the line", () => {
    const fake = fakeMap(BASEMAP, {});
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useZoomAtLeast(fake.map, 8, true);
    });
    expect(result.current).toBe(false);
    const settled = renders;
    act(() => fake.setZoom(5));
    act(() => fake.setZoom(7.9));
    expect(renders - settled).toBeLessThanOrEqual(1);
    act(() => fake.setZoom(8));
    expect(result.current).toBe(true);
  });

  it("is false while it is not asked", () => {
    const fake = fakeMap(BASEMAP, {});
    act(() => fake.setZoom(12));
    const { result } = renderHook(() => useZoomAtLeast(fake.map, 8, false));
    expect(result.current).toBe(false);
  });
});

describe("useHeatStops", () => {
  it("reads the page's accent into a ramp while the heat is on", async () => {
    document.documentElement.style.setProperty("--color-primary", "#006a91");
    const { result } = renderHook(() => useHeatStops(true));
    await waitFor(() => expect(result.current).not.toBeNull());
    // Transparent first, then the doubling stops.
    expect(result.current![0].color).toMatch(/, 0\)$/);
    expect(result.current!.length).toBe(9);
  });

  it("gives nothing while the heat is off", () => {
    const { result } = renderHook(() => useHeatStops(false));
    expect(result.current).toBeNull();
  });
});

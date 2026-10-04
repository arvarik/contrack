// @vitest-environment jsdom
/**
 * The view the map remembers.
 *
 * A `localStorage` that holds a view hands it back, and one that holds
 * anything else hands back nothing, so the map falls back to its default
 * instead of opening on a corrupt spot. A `localStorage` that throws, which
 * is what a locked browser's does, is the same as none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_VIEW_KEY,
  readLastView,
  writeLastView,
} from "../../../../src/views/map/lastView";

const LONDON = { longitude: -0.1278, latitude: 51.5074, zoom: 11 };

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("lastView", () => {
  it("hands back the view it was given, trimmed to what the eye can tell", () => {
    writeLastView({
      longitude: -0.12781234567,
      latitude: 51.50741234567,
      zoom: 11.123456,
    });
    expect(readLastView()).toEqual({
      longitude: -0.127812,
      latitude: 51.507412,
      zoom: 11.12,
    });
  });

  it.each([
    ["nothing", null],
    ["text that is not JSON", "not json"],
    ["a zoom and no place", JSON.stringify({ zoom: 3 })],
    ["a latitude past the pole", JSON.stringify({ ...LONDON, latitude: 91 })],
    [
      "a longitude past the antimeridian",
      JSON.stringify({ ...LONDON, longitude: 181 }),
    ],
    ["a zoom written as text", JSON.stringify({ ...LONDON, zoom: "11" })],
    ["null", JSON.stringify(null)],
    ["a bare string", JSON.stringify("London")],
  ])("reads nothing from a store that holds %s", (_label, stored) => {
    if (stored !== null) window.localStorage.setItem(LAST_VIEW_KEY, stored);
    expect(readLastView()).toBeNull();
  });

  it("treats a store that throws as no store", () => {
    // A store whose reads and writes throw.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(readLastView()).toBeNull();
    expect(() => writeLastView(LONDON)).not.toThrow();
    vi.unstubAllGlobals();

    // A browser that refuses to hand over the store at all.
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLastView()).toBeNull();
    expect(() => writeLastView(LONDON)).not.toThrow();
  });

  it("refuses to write a view the map could not open on", () => {
    writeLastView({ longitude: Number.NaN, latitude: 0, zoom: 1 });
    writeLastView({ longitude: 0, latitude: 0, zoom: -1 });
    expect(window.localStorage.length).toBe(0);
  });
});

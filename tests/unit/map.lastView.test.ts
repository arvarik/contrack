/**
 * The view the map remembers.
 *
 * A store that holds a view hands it back, and one that holds anything else
 * hands back nothing, so the map falls back to its default instead of
 * opening on a corrupt spot. A store that throws, which is what a locked
 * browser's `localStorage` does, is the same as no store.
 */
import { describe, expect, it } from "vitest";
import {
  LAST_VIEW_KEY,
  readLastView,
  writeLastView,
  type ViewStore,
} from "../../src/views/map/lastView";

const memoryStore = (
  initial: Record<string, string> = {},
): ViewStore & {
  data: Record<string, string>;
} => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
};

const LONDON = { longitude: -0.1278, latitude: 51.5074, zoom: 11 };

describe("lastView", () => {
  it("hands back the view it was given, trimmed to what the eye can tell", () => {
    const store = memoryStore();
    writeLastView(
      { longitude: -0.12781234567, latitude: 51.50741234567, zoom: 11.123456 },
      store,
    );
    expect(readLastView(store)).toEqual({
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
    const store = memoryStore(
      stored === null ? {} : { [LAST_VIEW_KEY]: stored },
    );
    expect(readLastView(store)).toBeNull();
  });

  it("treats a store that throws as no store", () => {
    const broken: ViewStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readLastView(broken)).toBeNull();
    expect(() => writeLastView(LONDON, broken)).not.toThrow();
    expect(readLastView(null)).toBeNull();
    expect(() => writeLastView(LONDON, null)).not.toThrow();
  });

  it("refuses to write a view the map could not open on", () => {
    const store = memoryStore();
    writeLastView({ longitude: Number.NaN, latitude: 0, zoom: 1 }, store);
    writeLastView({ longitude: 0, latitude: 0, zoom: -1 }, store);
    expect(store.data).toEqual({});
  });
});

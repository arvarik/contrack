/**
 * The heat layer's numbers: who weighs what, the scale a network sets, the
 * ramp in both palettes, and where the heat sits among the basemap's layers.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ mode: "light", preferences: { accent: "#006a91" } }),
}));

const {
  HEAT_END_ZOOM,
  HEAT_FADE_ZOOM,
  HEAT_PINS_ZOOM,
  firstLabelLayer,
  heatGradient,
  heatIntensity,
  heatPaint,
  heatStops,
  heatWeight,
} = await import("../../src/views/map/heat");
const { hexToRgb, rgbToOklch } = await import("../../src/lib/color");

/** MapLibre's kernel peak per unit of weight. */
const PEAK = 1 / Math.sqrt(2 * Math.PI);

/** `rgba(r, g, b, a)` read back into OKLCH and the alpha. */
function read(color: string) {
  const [r, g, b, a] = color.match(/[\d.]+/g)!.map(Number);
  return { ...rgbToOklch({ r, g, b }), alpha: a };
}

const person = (lat: number, lng: number, interactionCount = 0) => ({
  lat,
  lng,
  interactionCount,
});

describe("heatWeight", () => {
  it("counts every person, and a long history up to twice", () => {
    expect(heatWeight(0)).toBe(1);
    expect(heatWeight(3)).toBeCloseTo(1.3);
    expect(heatWeight(1.5)).toBeCloseTo(1.15);
    expect(heatWeight(25)).toBe(2);
    expect(heatWeight(400)).toBe(2);
  });
});

describe("heatIntensity", () => {
  it("puts the densest place at full density", () => {
    const city = Array.from({ length: 10 }, () => person(51.5, -0.12));
    expect(heatIntensity(city) * PEAK * 10).toBeCloseTo(1);
    // A long history weighs more: five people with long histories are ten.
    const close = Array.from({ length: 5 }, () => person(51.5, -0.12, 25));
    expect(heatIntensity(close)).toBeCloseTo(heatIntensity(city));
  });

  it("groups people by the degree they fall in", () => {
    // Twenty people 30 km apart are one place, and 300 km apart two.
    const near = [
      ...Array.from({ length: 10 }, () => person(51.2, -0.1)),
      ...Array.from({ length: 10 }, () => person(51.4, 0.3)),
    ];
    const far = [
      ...Array.from({ length: 10 }, () => person(51.5, -0.12)),
      ...Array.from({ length: 10 }, () => person(48.86, 2.35)),
    ];
    expect(heatIntensity(near) * PEAK * 20).toBeCloseTo(1);
    expect(heatIntensity(far) * PEAK * 10).toBeCloseTo(1);
  });

  it("keeps a person alone from being the whole ramp, and caps a crowd", () => {
    const scattered = [
      person(51.5, -0.12),
      person(40.7, -74),
      person(35.7, 139.7),
    ];
    expect(heatIntensity(scattered) * PEAK * 4).toBeCloseTo(1);
    const crowd = Array.from({ length: 500 }, () => person(40.7, -74));
    expect(heatIntensity(crowd) * PEAK * 128).toBeCloseTo(1);
  });
});

describe("heatStops", () => {
  it("fades in from transparent, doubling in density to the densest place", () => {
    const stops = heatStops("#006a91", "light")!;
    expect(stops.map((stop) => stop.density)).toEqual([
      0,
      1 / 128,
      1 / 64,
      1 / 32,
      1 / 16,
      1 / 8,
      1 / 4,
      1 / 2,
      1,
    ]);
    const alphas = stops.map((stop) => read(stop.color).alpha);
    expect(alphas[0]).toBe(0);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
    }
  });

  it("darkens toward the most over a light map, from a pale yellow to the accent", () => {
    // The first stop is the second's colour with no alpha.
    const stops = heatStops("#006a91", "light")!.map((stop) =>
      read(stop.color),
    );
    for (let i = 2; i < stops.length; i++) {
      expect(stops[i].l).toBeLessThan(stops[i - 1].l);
    }
    const accent = rgbToOklch(hexToRgb("#006a91"));
    expect(stops[0].h).toBeGreaterThan(100);
    expect(stops[0].h).toBeLessThan(125);
    expect(Math.abs(stops.at(-1)!.h - accent.h)).toBeLessThan(3);
  });

  it("brightens toward the most over a dark map, from the accent to a yellow", () => {
    // The dark palette's primary is the light one, and the ramp takes it
    // down to a deep tone of the same hue for the least.
    const stops = heatStops("#6ec6ee", "dark")!.map((stop) => read(stop.color));
    for (let i = 2; i < stops.length; i++) {
      expect(stops[i].l).toBeGreaterThan(stops[i - 1].l);
    }
    const accent = rgbToOklch(hexToRgb("#6ec6ee"));
    expect(stops[0].l).toBeCloseTo(0.4, 1);
    expect(Math.abs(stops[0].h - accent.h)).toBeLessThan(3);
    expect(stops.at(-1)!.l).toBeGreaterThan(0.9);
  });

  it("follows a picked accent the short way round, never through violet", () => {
    // Rose to yellow goes through orange. Blue to yellow goes through teal
    // and green. Neither passes the AI colour's hue, 293.
    for (const [accent, mode] of [
      ["#e11d48", "light"],
      ["#006a91", "light"],
      ["#6ec6ee", "dark"],
    ] as const) {
      for (const stop of heatStops(accent, mode)!) {
        const { h } = read(stop.color);
        expect(Math.abs(h - 293)).toBeGreaterThan(30);
      }
    }
    const rose = heatStops("#e11d48", "light")!.map((stop) => read(stop.color));
    expect(rose.at(-1)!.h).toBeLessThan(40);
  });

  it("draws no heat rather than a colour of its own for an unreadable token", () => {
    expect(heatStops("", "light")).toBeNull();
    expect(heatStops("oklch(0.7 0.1 230)", "dark")).toBeNull();
  });
});

describe("heatPaint", () => {
  const stops = heatStops("#006a91", "light")!;
  const paint = heatPaint(0.5, stops)!;

  it("weighs every person, more with a longer history", () => {
    expect(paint["heatmap-weight"]).toEqual([
      "interpolate",
      ["linear"],
      ["get", "weight"],
      0,
      1,
      3,
      1.3,
      10,
      1.6,
      25,
      2,
    ]);
  });

  it("grows its radius and its intensity with the zoom", () => {
    expect(paint["heatmap-radius"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      16,
      4,
      26,
      HEAT_END_ZOOM,
      44,
    ]);
    expect(paint["heatmap-intensity"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      0.35,
      HEAT_END_ZOOM,
      0.6,
    ]);
  });

  it("gives way to the pins: it fades as they come back, and is gone after", () => {
    expect(paint["heatmap-opacity"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      HEAT_FADE_ZOOM,
      1,
      HEAT_END_ZOOM,
      0,
    ]);
    expect(HEAT_PINS_ZOOM).toBeGreaterThan(HEAT_FADE_ZOOM);
    expect(HEAT_PINS_ZOOM).toBeLessThan(HEAT_END_ZOOM);
  });

  it("colours the density with the ramp", () => {
    expect(paint["heatmap-color"]).toEqual([
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      ...stops.flatMap((stop) => [stop.density, stop.color]),
    ]);
  });
});

describe("heatGradient", () => {
  it("lays the stops out evenly, as the legend reads them", () => {
    const stops = heatStops("#006a91", "light")!;
    const gradient = heatGradient(stops);
    expect(gradient.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(gradient).toContain(`${stops[0].color} 0%`);
    expect(gradient).toContain(`${stops[4].color} 50%`);
    expect(gradient.endsWith(`${stops[8].color} 100%)`)).toBe(true);
  });
});

describe("firstLabelLayer", () => {
  it("finds where the labels start, over the last road", () => {
    // The dark basemap names the water under its roads. The heat under that
    // label had the roads drawn across it.
    expect(
      firstLabelLayer([
        { id: "background", type: "background" },
        { id: "water", type: "fill" },
        { id: "water_name", type: "symbol" },
        { id: "road", type: "line" },
        { id: "place_city", type: "symbol" },
        { id: "place_town", type: "symbol" },
      ]),
    ).toBe("place_city");
  });

  it("finds nothing in a style with no labels", () => {
    expect(
      firstLabelLayer([
        { id: "background", type: "background" },
        { id: "water", type: "fill" },
      ]),
    ).toBeUndefined();
    expect(firstLabelLayer([])).toBeUndefined();
  });
});

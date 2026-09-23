/**
 * Which basemap style the map asks for.
 *
 * The client must ask for the style the server named, because the server is
 * also what allowed that origin in the CSP. When the server said nothing, the
 * client falls back to the OpenFreeMap defaults, which are the two URLs the
 * server would have sent.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const addProtocol = vi.fn();
const tilev4 = vi.fn();

vi.mock("maplibre-gl", () => ({ addProtocol }));
vi.mock("pmtiles", () => ({
  Protocol: class {
    tilev4 = tilev4;
  },
}));

const loadModule = async () => {
  vi.resetModules();
  return import("../../src/views/map/mapStyles");
};

beforeEach(() => {
  addProtocol.mockClear();
});

describe("styleFor", () => {
  it("returns the palette the server named", async () => {
    const { styleFor } = await loadModule();
    const fromServer = {
      light: "https://maps.example.com/light",
      dark: "https://maps.example.com/dark",
    };
    expect(styleFor("light", fromServer)).toBe(
      "https://maps.example.com/light",
    );
    expect(styleFor("dark", fromServer)).toBe("https://maps.example.com/dark");
  });

  it("falls back to OpenFreeMap when the status has not answered", async () => {
    const { styleFor, DEFAULT_MAP_STYLES, OPENFREEMAP_STYLES } =
      await loadModule();
    expect(styleFor("light", null)).toBe(OPENFREEMAP_STYLES.positron);
    expect(styleFor("dark", undefined)).toBe(OPENFREEMAP_STYLES.dark);
    expect(styleFor("dark", {})).toBe(DEFAULT_MAP_STYLES.dark);
  });

  it("defaults to positron for light and dark for dark", async () => {
    const { DEFAULT_MAP_STYLES } = await loadModule();
    expect(DEFAULT_MAP_STYLES).toEqual({
      light: "https://tiles.openfreemap.org/styles/positron",
      dark: "https://tiles.openfreemap.org/styles/dark",
    });
  });
});

describe("registerPmtilesProtocol", () => {
  it("registers pmtiles:// with MapLibre once, however often it is called", async () => {
    const { registerPmtilesProtocol } = await loadModule();
    registerPmtilesProtocol();
    registerPmtilesProtocol();
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol).toHaveBeenCalledWith("pmtiles", tilev4);
  });
});

describe("heatRamp", () => {
  // The heat layer was one fixed blue in both palettes. It is the accent's
  // tokens as the page computes them: the pale container at low density,
  // then the primary at rising strength.
  it("builds the ramp from the primary and the pale container", async () => {
    const { heatRamp } = await loadModule();
    expect(heatRamp(" #006a91", "#47befd")).toEqual([
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0, 106, 145, 0)",
      0.2,
      "rgba(71, 190, 253, 0.2)",
      0.4,
      "rgba(0, 106, 145, 0.4)",
      0.6,
      "rgba(0, 106, 145, 0.6)",
      0.8,
      "rgba(0, 106, 145, 0.8)",
      1,
      "rgba(0, 106, 145, 1)",
    ]);
  });

  it("follows another accent and the dark palette", async () => {
    const { heatRamp } = await loadModule();
    const dark = heatRamp("#6ec6ee", "#004d6b");
    expect(dark?.[4]).toBe("rgba(110, 198, 238, 0)");
    expect(dark?.[6]).toBe("rgba(0, 77, 107, 0.2)");
    expect(dark?.[14]).toBe("rgba(110, 198, 238, 1)");
  });

  it("draws nothing rather than a colour of its own for an unreadable token", async () => {
    const { heatRamp } = await loadModule();
    expect(heatRamp("", "#47befd")).toBeNull();
    expect(heatRamp("#006a91", "oklch(0.7 0.1 230)")).toBeNull();
  });
});

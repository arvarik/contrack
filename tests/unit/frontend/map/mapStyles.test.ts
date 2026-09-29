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
  return import("../../../../src/views/map/mapStyles");
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
    const { styleFor } = await loadModule();
    expect(styleFor("light", null)).toBe(
      "https://tiles.openfreemap.org/styles/positron",
    );
    expect(styleFor("dark", undefined)).toBe(
      "https://tiles.openfreemap.org/styles/dark",
    );
    expect(styleFor("dark", {})).toBe(
      "https://tiles.openfreemap.org/styles/dark",
    );
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

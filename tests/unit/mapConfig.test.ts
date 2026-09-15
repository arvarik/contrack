/**
 * The basemap style config, and the CSP that has to agree with it.
 *
 * One module answers both questions: which style URL the client loads, and
 * which origin the production CSP allows it to load from. A change to either
 * that does not change the other is the failure this design exists to
 * prevent: a working style the browser refuses to fetch, or an allowed host
 * nothing uses. The header this feeds is asserted in
 * `tests/integration/api.map.test.ts`, which can build the real app.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAP_STYLE_DARK,
  DEFAULT_MAP_STYLE_LIGHT,
  getMapStyles,
  parseStyleUrl,
  styleOrigins,
} from "../../server/utils/mapConfig.ts";
import { log } from "../../server/utils/logger.ts";

const OPENFREEMAP = "https://tiles.openfreemap.org";

afterEach(() => {
  vi.restoreAllMocks();
  // The module caches by env value, and an empty env is the default case.
  getMapStyles({});
});

describe("parseStyleUrl", () => {
  it("accepts an https URL and a root-relative path", () => {
    expect(parseStyleUrl("https://maps.example.com/style.json")).toBe(
      "https://maps.example.com/style.json",
    );
    expect(parseStyleUrl("  /map/style.json  ")).toBe("/map/style.json");
  });

  it("refuses anything else", () => {
    // http is refused: a style is loaded by a page that is usually https.
    expect(parseStyleUrl("http://maps.example.com/style.json")).toBeNull();
    expect(parseStyleUrl("//maps.example.com/style.json")).toBeNull();
    expect(parseStyleUrl("map/style.json")).toBeNull();
    expect(parseStyleUrl("javascript:alert(1)")).toBeNull();
    expect(parseStyleUrl("https://user:pass@maps.example.com/s")).toBeNull();
    expect(parseStyleUrl("")).toBeNull();
    // A value that would otherwise inject a second directive into the CSP.
    expect(parseStyleUrl("/x; script-src *")).toBeNull();
  });
});

describe("getMapStyles", () => {
  it("defaults to the two OpenFreeMap styles", () => {
    expect(getMapStyles({})).toEqual({
      light: DEFAULT_MAP_STYLE_LIGHT,
      dark: DEFAULT_MAP_STYLE_DARK,
    });
    expect(DEFAULT_MAP_STYLE_LIGHT).toBe(`${OPENFREEMAP}/styles/positron`);
    expect(DEFAULT_MAP_STYLE_DARK).toBe(`${OPENFREEMAP}/styles/dark`);
  });

  it("takes the operator's override", () => {
    expect(
      getMapStyles({
        MAP_STYLE_LIGHT: "https://maps.example.com/day",
        MAP_STYLE_DARK: "/map/night.json",
      }),
    ).toEqual({
      light: "https://maps.example.com/day",
      dark: "/map/night.json",
    });
  });

  it("treats an empty value as unset", () => {
    expect(getMapStyles({ MAP_STYLE_LIGHT: "", MAP_STYLE_DARK: "  " })).toEqual(
      { light: DEFAULT_MAP_STYLE_LIGHT, dark: DEFAULT_MAP_STYLE_DARK },
    );
  });

  it("warns and keeps the default when a value is not a style URL", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(getMapStyles({ MAP_STYLE_LIGHT: "not a url" }).light).toBe(
      DEFAULT_MAP_STYLE_LIGHT,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toContain("MAP_STYLE_LIGHT");
  });

  it("warns once for the same value, not once per request", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const env = { MAP_STYLE_DARK: "ftp://example.com/style" };
    getMapStyles(env);
    getMapStyles(env);
    getMapStyles(env);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("styleOrigins", () => {
  it("names the shared origin of the defaults once", () => {
    expect(styleOrigins(getMapStyles({}))).toEqual([OPENFREEMAP]);
  });

  it("names both origins when the palettes come from two hosts", () => {
    expect(
      styleOrigins({
        light: "https://a.example.com/light",
        dark: "https://b.example.com/dark",
      }),
    ).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("adds nothing for a self-hosted style", () => {
    expect(
      styleOrigins({ light: "/map/light.json", dark: "/map/dark.json" }),
    ).toEqual([]);
  });
});

import { afterEach, describe, it, expect, vi } from "vitest";
import { queueGeocode } from "../../server/services/geocoding/index.ts";
import { normalizeLocationKey } from "../../server/services/geocoding/cache.ts";
import { geocodeWithFallback } from "../../server/services/geocoding/provider.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Geocoding Integration Tests", () => {
  it("normalizes location keys accurately", () => {
    expect(normalizeLocationKey(" San Francisco , CA ")).toBe(
      "san francisco, ca",
    );
    expect(normalizeLocationKey("san  francisco,ca")).toBe("san francisco, ca");
  });

  it("skips processing if location is null or empty", () => {
    const fnCacheHit = vi.spyOn(console, "log");
    queueGeocode("123", "");
    expect(fnCacheHit).not.toHaveBeenCalled();
  });

  it("asks Nominatim with its User-Agent and names it as the provider", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json([{ lat: "48.8566", lon: "2.3522" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeWithFallback("Paris, France");

    expect(result).toEqual({
      lat: 48.8566,
      lng: 2.3522,
      provider: "Nominatim",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Paris%2C%20France",
    );
    expect(new Headers(init?.headers).get("User-Agent")).toMatch(
      /^ContrackCRM\//,
    );
  });
});

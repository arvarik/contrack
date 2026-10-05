import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { queueGeocode } from "../../server/services/geocoding/index.ts";
import {
  getCachedGeocode,
  isRecentFailure,
  normalizeLocationKey,
} from "../../server/services/geocoding/cache.ts";
import {
  geocodeWithFallback,
  INTER_REQUEST_DELAY_MS,
} from "../../server/services/geocoding/provider.ts";
import { searchPlace } from "../../server/services/geocoding/search.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Geocoding Integration Tests", () => {
  it("normalizes location keys accurately", () => {
    expect(normalizeLocationKey(" San Francisco , CA ")).toBe(
      "san francisco, ca",
    );
    expect(normalizeLocationKey("san  francisco,ca")).toBe("san francisco, ca");
  });

  it("skips processing if location is null or empty", async () => {
    // The suite turns background jobs off, and queueGeocode returns on that
    // before it looks at the location. The flag is read at the call.
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", "false");
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    queueGeocode("123", "   ");
    queueGeocode("123", "");
    queueGeocode("123", null as unknown as string);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks Nominatim with its User-Agent and names the place it found", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json([
        { lat: "48.8566", lon: "2.3522", display_name: "Paris, France" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeWithFallback("Paris, France");

    expect(result).toEqual({
      status: "found",
      lat: 48.8566,
      lng: 2.3522,
      provider: "Nominatim",
      displayName: "Paris, France",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=Paris%2C%20France",
    );
    expect(new Headers(init?.headers).get("User-Agent")).toMatch(
      /^ContrackCRM\//,
    );

    vi.stubEnv("NOMINATIM_URL", "http://nominatim.internal:8080/");
    await geocodeWithFallback("Paris");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "http://nominatim.internal:8080/search?format=json&limit=1&q=Paris",
    );
  });
});

// One fake clock for the block, so the pacing carries from test to test.
describe("no answer, and the pace", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  it("takes no answer as no answer: no broader address, nothing found", async () => {
    for (const reply of [
      () => Promise.resolve(new Response("busy", { status: 429 })),
      () => Promise.reject(new TypeError("fetch failed")),
    ]) {
      const fetchMock = vi.fn(reply);
      vi.stubGlobal("fetch", fetchMock);
      const outcome = geocodeWithFallback("12 Harbour Road, Porto, Portugal");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await outcome).toEqual({ status: "error" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps the place search and the queue to one call a second", async () => {
    const starts: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        starts.push(Date.now());
        return Response.json([]);
      }),
    );

    const both = Promise.all([
      geocodeWithFallback("Braga"),
      searchPlace("Faro"),
    ]);
    await vi.advanceTimersByTimeAsync(5_000);
    await both;

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(
      INTER_REQUEST_DELAY_MS,
    );
  });

  it("keeps looking up after one lookup throws", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", "false");
    const fetchMock = vi
      .fn()
      // A name that is not text cannot be cached, so the write throws.
      .mockResolvedValueOnce(
        Response.json([{ lat: "1", lon: "2", display_name: { odd: 1 } }]),
      )
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    queueGeocode("throwing-contact", "Odd Place");
    await vi.advanceTimersByTimeAsync(5_000);
    queueGeocode("next-contact", "Viseu");
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks again after a wait when there is no answer, and caches nothing until then", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", "false");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json([
          { lat: "41.1579", lon: "-8.6291", display_name: "Porto, Portugal" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const key = normalizeLocationKey("Porto, Portugal");

    queueGeocode("waiting-contact", "Porto, Portugal");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedGeocode(key)).toBeNull();
    expect(isRecentFailure(key)).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getCachedGeocode(key)).toEqual({
      lat: 41.1579,
      lng: -8.6291,
      provider: "Nominatim",
      displayName: "Porto, Portugal",
    });
  });
});

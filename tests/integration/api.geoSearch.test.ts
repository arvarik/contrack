import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  pruneGeocodeCache,
  queueGeocode,
} from "../../server/services/geocoding/index.ts";

vi.mock("../../server/services/geocoding/provider.ts", () => ({
  geocodeWithFallback: vi.fn(),
}));

import { geocodeWithFallback } from "../../server/services/geocoding/provider.ts";
import { __resetGeoSearchLimiter } from "../../server/routes/geo.ts";

const app = makeTestApp();

describe("GET /api/geo/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGeoSearchLimiter();
  });

  it("first call hits provider and caches; second call is cached: true", async () => {
    const LONDON = {
      lat: 51.5074,
      lng: -0.1278,
      provider: "Nominatim",
      displayName: "London, Greater London, England, United Kingdom",
    };
    vi.mocked(geocodeWithFallback).mockResolvedValueOnce({
      status: "found",
      ...LONDON,
    });

    const res1 = await request(app).get("/api/geo/search?q=London");
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ query: "London", ...LONDON, cached: false });
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);

    // Second call for the same place should use cache, the name included.
    const res2 = await request(app).get("/api/geo/search?q=London");
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ query: "London", ...LONDON, cached: true });
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);
  });

  it("returns 404 NO_RESULT when place is not found and caches the failure", async () => {
    vi.mocked(geocodeWithFallback).mockResolvedValue({ status: "none" });

    const res1 = await request(app).get("/api/geo/search?q=AtlantisNotFound");
    expect(res1.status).toBe(404);
    expect(res1.body.error.code).toBe("NO_RESULT");
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);

    // Second call hits the negative cache (isRecentFailure)
    const res2 = await request(app).get("/api/geo/search?q=AtlantisNotFound");
    expect(res2.status).toBe(404);
    expect(res2.body.error.code).toBe("NO_RESULT");
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);
  });

  it("answers 503 when Nominatim gives no answer, and caches nothing", async () => {
    vi.mocked(geocodeWithFallback).mockResolvedValue({ status: "error" });

    for (let i = 0; i < 2; i++) {
      const res = await request(app).get("/api/geo/search?q=Porto");
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("GEOCODER_UNAVAILABLE");
      expect(res.body.error.message).toMatch(/busy or unavailable/);
    }
    // Not remembered as "nothing found": the second search asked again.
    expect(geocodeWithFallback).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when query is 1 character or missing", async () => {
    const res1 = await request(app).get("/api/geo/search?q=a");
    expect(res1.status).toBe(400);
    expect(res1.body.error.code).toBe("VALIDATION_ERROR");

    const res2 = await request(app).get("/api/geo/search");
    expect(res2.status).toBe(400);
    expect(res2.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("enforces 30 requests per minute rate limit and returns 429 on the 31st request", async () => {
    vi.mocked(geocodeWithFallback).mockResolvedValue({
      status: "found",
      lat: 48.8566,
      lng: 2.3522,
      provider: "Nominatim",
    });

    // Make 30 requests
    for (let i = 0; i < 30; i++) {
      const res = await request(app).get("/api/geo/search?q=Paris");
      expect(res.status).toBe(200);
    }

    // 31st request triggers rate limiter
    const res31 = await request(app).get("/api/geo/search?q=Paris");
    expect(res31.status).toBe(429);
    expect(res31.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("address lookups off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGeoSearchLimiter();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends no address to Nominatim, and an admin turns lookups back on unless the environment holds them off", async () => {
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", "false");
    const put = (off: boolean) =>
      request(app).put("/api/geo/lookups").send({ off });
    expect((await put(true)).body).toMatchObject({ off: true });

    queueGeocode("off-contact", "Coimbra, Portugal");
    const search = await request(app).get("/api/geo/search?q=Braga");
    expect(search.body.error.code).toBe("GEOCODING_OFF");
    expect(geocodeWithFallback).not.toHaveBeenCalled();

    vi.stubEnv("GEOCODING_DISABLED", "true");
    expect((await put(false)).status).toBe(409);
    vi.unstubAllEnvs();
    expect((await put(false)).body.off).toBe(false);
  });

  it("prunes the cached lookups that no contact uses, once they are a day old", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Pinned Person", location: "Évora, Portugal" })
      .expect(201);
    const cache = sqlite.prepare(
      `INSERT INTO geocode_cache (key, provider, createdAt)
       VALUES (?, 'Nominatim', datetime('now', ?))`,
    );
    cache.run("évora, portugal", "-3 days");
    cache.run("old unused", "-3 days");
    cache.run("fresh search", "-1 hours");

    pruneGeocodeCache();

    const keys = sqlite
      .prepare(
        `SELECT key FROM geocode_cache
          WHERE key IN ('évora, portugal', 'old unused', 'fresh search')
          ORDER BY key`,
      )
      .pluck()
      .all();
    expect(keys).toEqual(["fresh search", "évora, portugal"]);
  });
});

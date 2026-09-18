import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

vi.mock("../../server/services/geocoding/provider.ts", () => ({
  geocodeWithFallback: vi.fn(),
  INTER_REQUEST_DELAY_MS: 0,
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
    vi.mocked(geocodeWithFallback).mockResolvedValueOnce({
      lat: 51.5074,
      lng: -0.1278,
      provider: "Nominatim",
    });

    const res1 = await request(app).get("/api/geo/search?q=London");
    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({
      query: "London",
      lat: 51.5074,
      lng: -0.1278,
      provider: "Nominatim",
      cached: false,
    });
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);

    // Second call for the same place should use cache
    const res2 = await request(app).get("/api/geo/search?q=London");
    expect(res2.status).toBe(200);
    expect(res2.body).toMatchObject({
      query: "London",
      lat: 51.5074,
      lng: -0.1278,
      provider: "Nominatim",
      cached: true,
    });
    expect(geocodeWithFallback).toHaveBeenCalledTimes(1);
  });

  it("returns 404 NO_RESULT when place is not found and caches the failure", async () => {
    vi.mocked(geocodeWithFallback).mockResolvedValue(null);

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

describe("GET /api/contacts?view=slim", () => {
  it("excludes trashed contacts", async () => {
    const createRes = await request(app).post("/api/contacts").send({
      name: "Temporary Mappable",
      location: "Austin, TX",
      lat: 30.2672,
      lng: -97.7431,
    });
    expect(createRes.status).toBe(201);
    const contactId = createRes.body.id;

    // Verify present in slim view
    const listBefore = await request(app).get("/api/contacts?view=slim");
    expect(listBefore.status).toBe(200);
    expect(
      (listBefore.body as { id: string }[]).some((c) => c.id === contactId),
    ).toBe(true);

    // Delete contact (move to trash)
    const deleteRes = await request(app).delete(`/api/contacts/${contactId}`);
    expect(deleteRes.status).toBe(200);

    // Verify absent from slim view
    const listAfter = await request(app).get("/api/contacts?view=slim");
    expect(listAfter.status).toBe(200);
    expect(
      (listAfter.body as { id: string }[]).some((c) => c.id === contactId),
    ).toBe(false);
  });
});

/**
 * The map's arithmetic and its data shape.
 *
 * Three rules live here, and each was a bug before it was a rule. The world
 * must cover the container at every window size, which is what `minZoomFor`
 * answers. A row with coordinates the map cannot draw must never reach the
 * map, which is what `toFeatureCollection` guarantees. And a contact on a
 * tile boundary is one pin, not two, which is what `toVisibleFeatures` does.
 */
import { describe, expect, it } from "vitest";
import {
  isValidLatLng,
  toFeatureCollection,
  type MapContact,
} from "../../shared/geo";
import {
  sameFeatures,
  toVisibleFeatures,
  type VisibleFeature,
} from "../../src/views/map/useClusterFeatures";
import {
  FALLBACK_MIN_ZOOM,
  LNG_EPSILON,
  MAX_MIN_ZOOM,
  MERCATOR_MAX_LAT,
  TILE_SIZE,
  WORLD_BOUNDS,
  minZoomFor,
} from "../../src/views/map/mapMath";

const person = (over: Partial<MapContact> = {}): MapContact => ({
  id: "c1",
  name: "Ada Lovelace",
  company: "Babbage & Co",
  avatarUrl: null,
  location: "London, UK",
  lat: 51.5074,
  lng: -0.1278,
  ...over,
});

describe("minZoomFor", () => {
  it("covers the larger dimension with 512 pixel tiles", () => {
    // 1024 is two tiles wide, which is zoom 1 exactly.
    expect(minZoomFor(1024, 768)).toBe(1);
    // A tile fills the container at zoom 0.
    expect(minZoomFor(512, 400)).toBe(0);
  });

  it("returns a fraction, rounded up, for a size between two zooms", () => {
    // log2(2560 / 512) is 2.3219, and rounding down would show background.
    expect(minZoomFor(2560, 1440)).toBeCloseTo(2.33, 5);
    expect(minZoomFor(2560, 1440)).toBeGreaterThanOrEqual(
      Math.log2(2560 / TILE_SIZE),
    );
    // A phone: the height decides, not the width.
    expect(minZoomFor(400, 800)).toBeCloseTo(0.65, 5);
    expect(minZoomFor(400, 800)).toBeGreaterThanOrEqual(
      Math.log2(800 / TILE_SIZE),
    );
  });

  it("never goes below zero and never past the cap", () => {
    expect(minZoomFor(200, 200)).toBe(0);
    expect(minZoomFor(100000, 100000)).toBe(MAX_MIN_ZOOM);
  });

  it("falls back when the container has no size yet", () => {
    expect(minZoomFor(0, 0)).toBe(FALLBACK_MIN_ZOOM);
    expect(minZoomFor(1024, 0)).toBe(FALLBACK_MIN_ZOOM);
    expect(minZoomFor(-1, 500)).toBe(FALLBACK_MIN_ZOOM);
  });
});

describe("WORLD_BOUNDS", () => {
  it("is the Mercator limit in latitude", () => {
    const [, south, , north] = WORLD_BOUNDS;
    expect(north).toBe(MERCATOR_MAX_LAT);
    expect(south).toBe(-MERCATOR_MAX_LAT);
  });

  it("stops a hair inside the meridian, which MapLibre needs", () => {
    const [west, , east] = WORLD_BOUNDS;
    expect(west).toBe(-180 + LNG_EPSILON);
    expect(east).toBe(180 - LNG_EPSILON);
    expect(west).toBeGreaterThan(-180);
    expect(east).toBeLessThan(180);
  });
});

describe("isValidLatLng", () => {
  it("accepts a pair inside the WGS 84 ranges", () => {
    expect(isValidLatLng(51.5074, -0.1278)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(-90, 180)).toBe(true);
  });

  it("refuses anything the map cannot draw", () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(Number.NaN, 0)).toBe(false);
    expect(isValidLatLng(Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect(isValidLatLng(null, 0)).toBe(false);
    expect(isValidLatLng("51.5", "-0.12")).toBe(false);
  });
});

describe("toFeatureCollection", () => {
  it("keeps the contact id as the feature id and as a property", () => {
    const collection = toFeatureCollection([person()]);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].id).toBe("c1");
    expect(collection.features[0].properties.id).toBe("c1");
  });

  it("orders a position longitude first", () => {
    const [feature] = toFeatureCollection([person()]).features;
    expect(feature.geometry.coordinates).toEqual([-0.1278, 51.5074]);
  });

  it("drops a row the map cannot draw", () => {
    const collection = toFeatureCollection([
      person(),
      person({ id: "c2", lat: 999, lng: 0 }),
      person({ id: "c3", lat: 0, lng: Number.NaN }),
    ]);
    expect(collection.features.map((f) => f.id)).toEqual(["c1"]);
  });

  it("leaves an empty field out rather than sending null", () => {
    const [feature] = toFeatureCollection([
      person({ company: null, avatarUrl: null, location: null }),
    ]).features;
    expect(feature.properties).toEqual({
      id: "c1",
      name: "Ada Lovelace",
      score: 0,
      atRisk: 1,
      overdue: 0,
      weight: 0,
    });
  });

  it("carries the company, avatar and location when they exist", () => {
    const [feature] = toFeatureCollection([
      person({ avatarUrl: "/api/avatar/avataaars?seed=ada" }),
    ]).features;
    expect(feature.properties).toEqual({
      id: "c1",
      name: "Ada Lovelace",
      company: "Babbage & Co",
      avatarUrl: "/api/avatar/avataaars?seed=ada",
      location: "London, UK",
      score: 0,
      atRisk: 1,
      overdue: 0,
      weight: 0,
    });
  });

  it("computes score, atRisk, overdue and weight properties", () => {
    const [feature] = toFeatureCollection([
      person({
        relationshipScore: 85,
        interactionCount: 7,
        nextFollowUpAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ]).features;
    expect(feature.properties.score).toBe(85);
    expect(feature.properties.atRisk).toBe(0);
    expect(feature.properties.overdue).toBe(1);
    expect(feature.properties.weight).toBe(7);
  });
});

describe("toVisibleFeatures", () => {
  const pointFeature = (id: string, lng = 0, lat = 0) => ({
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id },
  });
  const clusterFeature = (
    clusterId: number,
    count: number,
    atRisk = 0,
    overdue = 0,
    scoreSum = 0,
  ) => ({
    geometry: { type: "Point", coordinates: [1, 2] },
    properties: {
      cluster: true,
      cluster_id: clusterId,
      point_count: count,
      atRisk,
      overdue,
      scoreSum,
    },
  });

  it("reads a contact point and a cluster", () => {
    expect(
      toVisibleFeatures([
        pointFeature("c1", -0.12, 51.5),
        clusterFeature(7, 12, 1, 2, 85),
      ]),
    ).toEqual([
      {
        kind: "point",
        key: "point:c1",
        id: "c1",
        longitude: -0.12,
        latitude: 51.5,
      },
      {
        kind: "cluster",
        key: "cluster:7",
        clusterId: 7,
        count: 12,
        atRisk: 1,
        overdue: 2,
        scoreSum: 85,
        longitude: 1,
        latitude: 2,
      },
    ]);
  });

  it("draws a feature on two tiles once", () => {
    // A tile edge puts the same contact, and the same cluster, in the result
    // of both tiles. Drawn twice, the pin would be two buttons for one person.
    const features = toVisibleFeatures([
      pointFeature("c1"),
      pointFeature("c1"),
      clusterFeature(7, 12),
      clusterFeature(7, 12),
    ]);
    expect(features.map((f) => f.key)).toEqual(["point:c1", "cluster:7"]);
  });

  it("skips anything without a point and an id", () => {
    expect(
      toVisibleFeatures([
        {
          geometry: { type: "LineString", coordinates: [] },
          properties: { id: "c1" },
        },
        {
          geometry: { type: "Point", coordinates: ["x", 2] },
          properties: { id: "c2" },
        },
        { geometry: { type: "Point", coordinates: [1, 2] }, properties: null },
        {
          geometry: { type: "Point", coordinates: [1, 2] },
          properties: { id: 5 },
        },
      ]),
    ).toEqual([]);
  });
});

describe("sameFeatures", () => {
  const at = (key: string, longitude: number): VisibleFeature => ({
    kind: "point",
    key,
    id: key,
    longitude,
    latitude: 0,
  });

  it("is true for the same features in the same places", () => {
    expect(
      sameFeatures([at("a", 1), at("b", 2)], [at("a", 1), at("b", 2)]),
    ).toBe(true);
  });

  it("is false when a feature moves, arrives or leaves", () => {
    expect(sameFeatures([at("a", 1)], [at("a", 2)])).toBe(false);
    expect(sameFeatures([at("a", 1)], [at("a", 1), at("b", 2)])).toBe(false);
    expect(sameFeatures([at("a", 1)], [at("b", 1)])).toBe(false);
  });
});

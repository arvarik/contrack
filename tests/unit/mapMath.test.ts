import { describe, it, expect } from "vitest";
import {
  haversineKm,
  boundsContain,
  pointInPolygon,
  boundsOf,
} from "../../src/views/map/mapMath";

describe("mapMath", () => {
  describe("haversineKm", () => {
    it("calculates London to Paris within 1 percent of 344 km", () => {
      // London: 51.5074 N, 0.1278 W (-0.1278)
      // Paris: 48.8566 N, 2.3522 E
      const london = { lat: 51.5074, lng: -0.1278 };
      const paris = { lat: 48.8566, lng: 2.3522 };

      const distance = haversineKm(london, paris);
      expect(distance).toBeGreaterThan(344 * 0.99);
      expect(distance).toBeLessThan(344 * 1.01);
    });

    it("returns 0 for identical points", () => {
      const p = { lat: 37.7749, lng: -122.4194 };
      expect(haversineKm(p, p)).toBe(0);
    });
  });

  describe("boundsContain", () => {
    // Standard bounds: [west, south, east, north]
    // California: [-124.4, 32.5, -114.1, 42.0]
    const calBounds: [number, number, number, number] = [
      -124.4, 32.5, -114.1, 42.0,
    ];

    it("returns true for point inside bounds", () => {
      // San Francisco: 37.7749, -122.4194
      expect(boundsContain(calBounds, { lat: 37.7749, lng: -122.4194 })).toBe(
        true,
      );
    });

    it("returns false for point outside bounds", () => {
      // London: 51.5074, -0.1278
      expect(boundsContain(calBounds, { lat: 51.5074, lng: -0.1278 })).toBe(
        false,
      );
      // North of CA: 43.0, -120.0
      expect(boundsContain(calBounds, { lat: 43.0, lng: -120.0 })).toBe(false);
      // South of CA: 30.0, -120.0
      expect(boundsContain(calBounds, { lat: 30.0, lng: -120.0 })).toBe(false);
    });

    it("supports object with getWest, getSouth, getEast, getNorth", () => {
      const objBounds = {
        getWest: () => -124.4,
        getSouth: () => 32.5,
        getEast: () => -114.1,
        getNorth: () => 42.0,
      };
      expect(boundsContain(objBounds, { lat: 37.7749, lng: -122.4194 })).toBe(
        true,
      );
      expect(boundsContain(objBounds, { lat: 51.5074, lng: -0.1278 })).toBe(
        false,
      );
    });

    it("handles antimeridian crossing", () => {
      // West: 170 (E), East: -170 (190 / 170 W)
      const pacificBounds: [number, number, number, number] = [
        170, -20, -170, 20,
      ];
      // Point at 175 longitude is inside
      expect(boundsContain(pacificBounds, { lat: 0, lng: 175 })).toBe(true);
      // Point at -175 longitude is inside
      expect(boundsContain(pacificBounds, { lat: 0, lng: -175 })).toBe(true);
      // Point at 0 longitude is outside
      expect(boundsContain(pacificBounds, { lat: 0, lng: 0 })).toBe(false);
    });
  });

  describe("pointInPolygon", () => {
    // Square from (0,0) to (10,10): [(0,0), (10,0), (10,10), (0,10)]
    const square = [
      { lng: 0, lat: 0 },
      { lng: 10, lat: 0 },
      { lng: 10, lat: 10 },
      { lng: 0, lat: 10 },
    ];

    it("returns true for point inside polygon", () => {
      expect(pointInPolygon({ lng: 5, lat: 5 }, square)).toBe(true);
      expect(pointInPolygon([5, 5], square)).toBe(true);
    });

    it("returns false for point outside polygon", () => {
      expect(pointInPolygon({ lng: 15, lat: 5 }, square)).toBe(false);
      expect(pointInPolygon({ lng: -1, lat: 5 }, square)).toBe(false);
      expect(pointInPolygon({ lng: 5, lat: 15 }, square)).toBe(false);
    });

    it("returns true for point directly on a vertex", () => {
      expect(pointInPolygon({ lng: 0, lat: 0 }, square)).toBe(true);
      expect(pointInPolygon({ lng: 10, lat: 10 }, square)).toBe(true);
    });

    it("handles concave polygon correctly", () => {
      // L-shaped polygon
      // (0,0) -> (10,0) -> (10,4) -> (4,4) -> (4,10) -> (0,10)
      const lShape = [
        { lng: 0, lat: 0 },
        { lng: 10, lat: 0 },
        { lng: 10, lat: 4 },
        { lng: 4, lat: 4 },
        { lng: 4, lat: 10 },
        { lng: 0, lat: 10 },
      ];

      // Inside bottom-right bar
      expect(pointInPolygon({ lng: 7, lat: 2 }, lShape)).toBe(true);
      // Inside top-left bar
      expect(pointInPolygon({ lng: 2, lat: 7 }, lShape)).toBe(true);
      // In the hollow corner (outside)
      expect(pointInPolygon({ lng: 7, lat: 7 }, lShape)).toBe(false);
    });

    it("returns false for degenerate rings with fewer than 3 vertices", () => {
      expect(
        pointInPolygon({ lng: 1, lat: 1 }, [
          { lng: 0, lat: 0 },
          { lng: 2, lat: 2 },
        ]),
      ).toBe(false);
    });
  });

  describe("boundsOf", () => {
    it("returns null for empty points array", () => {
      expect(boundsOf([])).toBeNull();
    });

    it("calculates bounds of one point", () => {
      const p = { lat: 37.7749, lng: -122.4194 };
      expect(boundsOf([p])).toEqual([-122.4194, 37.7749, -122.4194, 37.7749]);
    });

    it("calculates bounds of multiple points", () => {
      const points = [
        { lat: 10, lng: -20 },
        { lat: 40, lng: 50 },
        { lat: -5, lng: 15 },
      ];
      expect(boundsOf(points)).toEqual([-20, -5, 50, 40]);
    });

    it("calculates bounds across the antimeridian (unsupported, returns wide box)", () => {
      const points = [
        { lat: 0, lng: 179 },
        { lat: 10, lng: -179 },
      ];
      // Returns wide box: minLng is -179, maxLng is 179
      expect(boundsOf(points)).toEqual([-179, 0, 179, 10]);
    });
  });
});

import { describe, it, expect } from "vitest";
import { haversineKm, boundsContain } from "../../src/views/map/mapMath";

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
});

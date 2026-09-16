/**
 * How the map moves to a contact.
 *
 * Two rules, and a person can hold either one. The move never pulls back
 * from a view the reader chose, and it never animates for a reader who asked
 * their system for less motion. The stand-in map below records the calls,
 * because a real MapLibre map needs WebGL and jsdom has none.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FLY_DURATION_MS,
  flyToContact,
  type MovableMap,
} from "../../src/views/map/flyTo";
import { CONTACT_ZOOM } from "../../src/views/map/mapMath";

const LONDON = { longitude: -0.1278, latitude: 51.5074 };

const mapAtZoom = (zoom: number) => {
  const map = {
    getZoom: () => zoom,
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
  } satisfies MovableMap;
  return map;
};

describe("flyToContact", () => {
  it("flies to the contact at the contact zoom", () => {
    const map = mapAtZoom(1);
    flyToContact(map, LONDON, { reducedMotion: false });
    expect(map.flyTo).toHaveBeenCalledWith({
      center: [LONDON.longitude, LONDON.latitude],
      zoom: CONTACT_ZOOM,
      duration: FLY_DURATION_MS,
    });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it("keeps a closer view the reader already chose", () => {
    const map = mapAtZoom(15);
    flyToContact(map, LONDON, { reducedMotion: false });
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ zoom: 15 }),
    );
  });

  it("jumps, and lands in the same place, under reduced motion", () => {
    const map = mapAtZoom(1);
    flyToContact(map, LONDON, { reducedMotion: true });
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [LONDON.longitude, LONDON.latitude],
      zoom: CONTACT_ZOOM,
    });
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it("asks the system when the caller does not say", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("window", { matchMedia });
    const map = mapAtZoom(1);
    flyToContact(map, LONDON);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(map.jumpTo).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

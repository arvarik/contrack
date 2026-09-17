/**
 * How the map moves to a contact, and how it makes room for one.
 *
 * Three rules, and a person can hold each one. The move never pulls back
 * from a view the reader chose, it never animates for a reader who asked
 * their system for less motion, and the covers over the map travel with it
 * as padding. The stand-in map below records the calls, because a real
 * MapLibre map needs WebGL and jsdom has none.
 */
import { describe, expect, it, vi } from "vitest";
import {
  FLY_DURATION_MS,
  PADDING_DURATION_MS,
  flyToContact,
  settlePadding,
  type MovableMap,
} from "../../src/views/map/flyTo";
import { CONTACT_ZOOM } from "../../src/views/map/mapMath";

const LONDON = { longitude: -0.1278, latitude: 51.5074 };

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };
const BESIDE_PANEL = { top: 0, right: 760, bottom: 0, left: 0 };

const mapAtZoom = (zoom: number, padding = NONE) => {
  const map = {
    getZoom: () => zoom,
    getPadding: () => padding,
    flyTo: vi.fn(),
    easeTo: vi.fn(),
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

  it("takes the covers over the map with it, on both paths", () => {
    const flown = mapAtZoom(1);
    flyToContact(flown, LONDON, {
      reducedMotion: false,
      padding: BESIDE_PANEL,
    });
    expect(flown.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ padding: BESIDE_PANEL }),
    );

    const jumped = mapAtZoom(1);
    flyToContact(jumped, LONDON, {
      reducedMotion: true,
      padding: BESIDE_PANEL,
    });
    expect(jumped.jumpTo).toHaveBeenCalledWith(
      expect.objectContaining({ padding: BESIDE_PANEL }),
    );
  });

  it("leaves the padding alone when the caller says nothing about it", () => {
    const map = mapAtZoom(1);
    flyToContact(map, LONDON, { reducedMotion: false });
    expect(map.flyTo.mock.calls[0][0]).not.toHaveProperty("padding");
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

describe("settlePadding", () => {
  it("eases the padding away as fast as the contact slides out", () => {
    const map = mapAtZoom(11, BESIDE_PANEL);
    settlePadding(map, NONE, { reducedMotion: false });
    expect(map.easeTo).toHaveBeenCalledWith({
      padding: NONE,
      duration: PADDING_DURATION_MS,
    });
    expect(map.jumpTo).not.toHaveBeenCalled();
  });

  it("jumps under reduced motion", () => {
    const map = mapAtZoom(11, BESIDE_PANEL);
    settlePadding(map, NONE, { reducedMotion: true });
    expect(map.jumpTo).toHaveBeenCalledWith({ padding: NONE });
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it("does nothing when the padding is already this", () => {
    const map = mapAtZoom(11, BESIDE_PANEL);
    settlePadding(map, { ...BESIDE_PANEL }, { reducedMotion: false });
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
  });
});

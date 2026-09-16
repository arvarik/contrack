/**
 * How the map moves to a contact.
 *
 * Opening a contact from a pin, or from a link on the contact page, ends on
 * the same view: that person centred at {@link CONTACT_ZOOM}, or closer if
 * the map was already closer. The move is an animation, because a map that
 * jumps leaves the reader to find where they landed.
 *
 * Every animation asks one question first. A person who set "reduce motion"
 * in their system asked for no animation, so for them the same move happens
 * with `jumpTo`, at the same end position. See WCAG 2.3.3.
 *
 * @module views/map/flyTo
 */
import { CONTACT_ZOOM } from "./mapMath";

/** Long enough to follow the move, short enough not to wait for it. */
export const FLY_DURATION_MS = 800;

export interface FlyTarget {
  longitude: number;
  latitude: number;
}

/**
 * The part of a MapLibre map this module uses.
 *
 * A structural type, not the class: a unit test passes a stand-in that
 * records the calls, and jsdom has no WebGL to hold a real map.
 */
export interface MovableMap {
  getZoom: () => number;
  flyTo: (options: {
    center: [number, number];
    zoom: number;
    duration: number;
  }) => void;
  jumpTo: (options: { center: [number, number]; zoom: number }) => void;
}

/** True when this person asked their system for less animation. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Move the map to one contact.
 *
 * @param map     The map to move.
 * @param target  Where the contact is, in degrees.
 * @param options `reducedMotion` forces the jump. It defaults to what the
 *                system says, and a caller passes it only to be explicit.
 */
export function flyToContact(
  map: MovableMap,
  target: FlyTarget,
  options: { reducedMotion?: boolean } = {},
): void {
  const center: [number, number] = [target.longitude, target.latitude];
  // Never pull back. A reader who zoomed in to a street keeps that street.
  const zoom = Math.max(map.getZoom(), CONTACT_ZOOM);
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  if (reduced) {
    map.jumpTo({ center, zoom });
    return;
  }
  map.flyTo({ center, zoom, duration: FLY_DURATION_MS });
}

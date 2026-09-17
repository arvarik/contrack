/**
 * How the map moves to a contact, and how it makes room for one.
 *
 * Opening a contact from a pin, or from a link on the contact page, ends on
 * the same view: that person centred at {@link CONTACT_ZOOM}, or closer if
 * the map was already closer. The move is an animation, because a map that
 * jumps leaves the reader to find where they landed.
 *
 * "Centred" means centred in the part of the map nothing covers. The open
 * contact covers the right of the map on a wide screen, so the fly-to takes
 * the covers as MapLibre padding (see `insets.ts`), and the pin lands in the
 * open part. When the contact closes, {@link settlePadding} eases the
 * padding away and the pin glides to the centre of the whole map.
 *
 * Every animation asks one question first. A person who set "reduce motion"
 * in their system asked for no animation, so for them the same move happens
 * with `jumpTo`, at the same end position. See WCAG 2.3.3.
 *
 * @module views/map/flyTo
 */
import type { PaddingOptions } from "maplibre-gl";
import { samePadding } from "./insets";
import { CONTACT_ZOOM } from "./mapMath";

/** Long enough to follow the move, short enough not to wait for it. */
export const FLY_DURATION_MS = 800;

/** The contact panel's slide takes 400 ms, and the map moves with it. */
export const PADDING_DURATION_MS = 400;

export interface FlyTarget {
  longitude: number;
  latitude: number;
}

/** What one move asks of the camera. */
export interface CameraMove {
  center?: [number, number];
  zoom?: number;
  padding?: PaddingOptions;
  duration?: number;
}

/**
 * The part of a MapLibre map this module uses.
 *
 * A structural type, not the class: a unit test passes a stand-in that
 * records the calls, and jsdom has no WebGL to hold a real map.
 */
export interface MovableMap {
  getZoom: () => number;
  getPadding: () => PaddingOptions;
  flyTo: (options: CameraMove) => void;
  easeTo: (options: CameraMove) => void;
  jumpTo: (options: CameraMove) => void;
}

/** True when this person asked their system for less animation. */
export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export interface MoveOptions {
  /**
   * Forces the jump. It defaults to what the system says, and a caller
   * passes it only to be explicit.
   */
  reducedMotion?: boolean;
  /** The covers over the map. Left out, the map keeps the padding it has. */
  padding?: PaddingOptions;
}

/**
 * Move the map to one contact.
 *
 * @param map     The map to move.
 * @param target  Where the contact is, in degrees.
 * @param options See {@link MoveOptions}.
 */
export function flyToContact(
  map: MovableMap,
  target: FlyTarget,
  options: MoveOptions = {},
): void {
  const center: [number, number] = [target.longitude, target.latitude];
  // Never pull back. A reader who zoomed in to a street keeps that street.
  const zoom = Math.max(map.getZoom(), CONTACT_ZOOM);
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const move: CameraMove = { center, zoom };
  if (options.padding) move.padding = options.padding;
  if (reduced) {
    map.jumpTo(move);
    return;
  }
  map.flyTo({ ...move, duration: FLY_DURATION_MS });
}

/**
 * Give the map new covers without changing what is centred.
 *
 * The map keeps its centre in the open part, so the view slides by half the
 * difference. Nothing happens when the padding is already this.
 */
export function settlePadding(
  map: MovableMap,
  padding: PaddingOptions,
  options: Pick<MoveOptions, "reducedMotion"> = {},
): void {
  if (samePadding(map.getPadding(), padding)) return;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  if (reduced) {
    map.jumpTo({ padding });
    return;
  }
  map.easeTo({ padding, duration: PADDING_DURATION_MS });
}

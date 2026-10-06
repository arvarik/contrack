/**
 * How the map moves to a contact and makes room for one. A contact opens
 * centered at {@link CONTACT_ZOOM} or closer, in the part of the map nothing
 * covers (the covers become padding, see `insets.ts`). The move animates so
 * the reader sees where they land. With reduced motion (the Motion setting or
 * the system), the same move uses `jumpTo` (WCAG 2.3.3).
 */
import type { PaddingOptions } from "maplibre-gl";
import { samePadding } from "./insets";
import { CONTACT_ZOOM } from "./mapMath";
import { prefersReducedMotion } from "../../lib/motion";

/** Long enough to follow the move, short enough not to wait for it. */
export const FLY_DURATION_MS = 800;

/** The contact panel's slide takes 400 ms, and the map moves with it. */
export const PADDING_DURATION_MS = 400;

interface FlyTarget {
  longitude: number;
  latitude: number;
}

export interface CameraMove {
  center?: [number, number];
  zoom?: number;
  padding?: PaddingOptions;
  duration?: number;
  /** The curve, from 0 to 1 over the duration. MapLibre's own by default. */
  easing?: (t: number) => number;
}

/** A structural type, not the class: jsdom has no WebGL for a real map. */
export interface MovableMap {
  getZoom: () => number;
  getPadding: () => PaddingOptions;
  flyTo: (options: CameraMove) => void;
  easeTo: (options: CameraMove) => void;
  jumpTo: (options: CameraMove) => void;
}

interface MoveOptions {
  /** Overrides the reduced motion preference. */
  reducedMotion?: boolean;
  /** The covers over the map. Left out, the map keeps the padding it has. */
  padding?: PaddingOptions;
}

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
 * Give the map new covers and keep the same point centered in the open part.
 * The default duration matches the contact's slide. A caller that moves with
 * another cover passes that cover's duration and curve.
 */
export function settlePadding(
  map: MovableMap,
  padding: PaddingOptions,
  options: Pick<MoveOptions, "reducedMotion"> &
    Pick<CameraMove, "duration" | "easing"> = {},
): void {
  if (samePadding(map.getPadding(), padding)) return;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  if (reduced) {
    map.jumpTo({ padding });
    return;
  }
  map.easeTo({
    padding,
    duration: options.duration ?? PADDING_DURATION_MS,
    ...(options.easing && { easing: options.easing }),
  });
}

/**
 * Two MapLibre defaults this map undoes after load. The compact attribution
 * opens expanded until the first drag, which covers a corner of every visit,
 * so it starts collapsed (the required credit stays one click away). Rotation
 * is off, because the map draws no compass to put north back up.
 */

/** MapLibre's class for the expanded compact attribution. */
export const ATTRIBUTION_SHOWN = "maplibregl-compact-show";

/**
 * Collapse the compact attribution as MapLibre's toggle does, and return
 * whether one was open. The strip is a `<details>`, so `open` goes with the
 * class, or MapLibre's next click starts from the wrong state.
 */
export function collapseAttribution(container: ParentNode): boolean {
  const strip = container.querySelector(
    `.maplibregl-ctrl-attrib.${ATTRIBUTION_SHOWN}`,
  );
  if (!strip) return false;
  strip.classList.remove(ATTRIBUTION_SHOWN);
  strip.removeAttribute("open");
  return true;
}

interface RotatableMap {
  touchZoomRotate: { disableRotation(): void };
  keyboard: { disableRotation(): void };
}

/** Keep north up: no rotation by touch, none by key. Zoom and pan stay. */
export function disableRotation(map: RotatableMap): void {
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
}

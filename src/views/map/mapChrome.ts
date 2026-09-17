/**
 * Two things MapLibre's own chrome does on its own that this map undoes once
 * the map has loaded.
 *
 * The attribution. In compact form the credit is an "i" button, and MapLibre
 * opens it expanded on load and collapses it on the first drag. The map page
 * is the page, so the strip sat open over the bottom corner of every visit
 * until something moved. It opens collapsed here. The credit the basemap's
 * terms require is one click away, exactly where MapLibre puts it after a
 * drag.
 *
 * Rotation. Two fingers on a phone rotate the map, and so do Shift and the
 * arrow keys. The map draws no compass to put north back at the top, and a
 * map of where people are has no reason to turn, so the two rotation
 * handlers are off. Pinch and the keys still zoom and pan.
 *
 * @module views/map/mapChrome
 */

/** MapLibre's class for the expanded compact attribution. */
export const ATTRIBUTION_SHOWN = "maplibregl-compact-show";

/**
 * Collapse the compact attribution, the way MapLibre's own toggle does.
 *
 * Returns whether there was an open strip to collapse. The strip is a
 * `<details>` and the button its `<summary>`, so the `open` attribute goes
 * with the class: that is the state MapLibre leaves after a click on the open
 * strip, and the state its next click builds on.
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

/** The two handlers of a MapLibre map that can turn it. */
export interface RotatableMap {
  touchZoomRotate: { disableRotation(): void };
  keyboard: { disableRotation(): void };
}

/** Keep north up: no rotation by touch, none by key. Zoom and pan stay. */
export function disableRotation(map: RotatableMap): void {
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
}

/**
 * Which basemap the map draws. The default is OpenFreeMap (no API key, no
 * request limits). `MAP_STYLE_LIGHT` and `MAP_STYLE_DARK` override it. The
 * server validates them, adds their origins to the CSP and reports them on
 * `GET /api/auth/status` as `map`, so the style and the CSP never drift.
 */
import { addProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { MapStyleUrls } from "../../../shared/geo";

export type { MapStyleUrls };

export const OPENFREEMAP_STYLES = {
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

export const DEFAULT_MAP_STYLES: MapStyleUrls = {
  light: OPENFREEMAP_STYLES.positron,
  dark: OPENFREEMAP_STYLES.dark,
};

/**
 * The style URL for a palette. No palette token reaches the basemap, so each
 * palette needs its own style. `statusMap` is the status payload's `map`
 * field, absent until the status answers.
 */
export function styleFor(
  mode: "light" | "dark",
  statusMap?: Partial<MapStyleUrls> | null,
): string {
  return statusMap?.[mode] || DEFAULT_MAP_STYLES[mode];
}

let pmtilesRegistered = false;

/**
 * Let a style load tiles from one `.pmtiles` archive with `pmtiles://`: the
 * offline path, with no tile server. The protocol is global to MapLibre, so
 * it registers once however many maps mount.
 */
export function registerPmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  const protocol = new Protocol();
  // pmtiles types the TileJSON data as unknown. At runtime it is an object
  // that MapLibre 6.11 accepts, so only the type is asserted.
  addProtocol("pmtiles", protocol.tilev4 as Parameters<typeof addProtocol>[1]);
  pmtilesRegistered = true;
}

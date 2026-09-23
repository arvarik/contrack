/**
 * Which basemap the map draws, and the protocols it can draw from.
 *
 * The default basemap is OpenFreeMap: public vector tiles and styles with no
 * API key, no registration and no request limits. The operator can point
 * either palette at another style with `MAP_STYLE_LIGHT` and
 * `MAP_STYLE_DARK`. The server validates those, adds their origins to the
 * CSP, and reports the result on `GET /api/auth/status` as `map`, so the
 * style the client asks for and the origin the CSP allows never drift.
 *
 * @module views/map/mapStyles
 */
import { addProtocol, type ExpressionSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { MapStyleUrls } from "../../../shared/geo";
import { hexToRgb, type Rgb } from "../../lib/color";

export type { MapStyleUrls };

/**
 * OpenFreeMap's public styles. `positron` and `dark` are the defaults, the
 * closest match to the minimal light and dark raster basemaps the map used
 * before. The other three are one-line alternatives.
 */
export const OPENFREEMAP_STYLES = {
  positron: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  liberty: "https://tiles.openfreemap.org/styles/liberty",
  bright: "https://tiles.openfreemap.org/styles/bright",
  fiord: "https://tiles.openfreemap.org/styles/fiord",
} as const;

export const DEFAULT_MAP_STYLES: MapStyleUrls = {
  light: OPENFREEMAP_STYLES.positron,
  dark: OPENFREEMAP_STYLES.dark,
};

/**
 * The style URL for a palette.
 *
 * The basemap is drawn from a style, so no palette token can reach it: a
 * light map in a dark app is a bright rectangle in the middle of the page.
 * `statusMap` is the `map` field of the status payload. It is absent until
 * the status answers, and absent on a server older than this client, and the
 * default is right in both cases.
 */
export function styleFor(
  mode: "light" | "dark",
  statusMap?: Partial<MapStyleUrls> | null,
): string {
  return statusMap?.[mode] || DEFAULT_MAP_STYLES[mode];
}

let pmtilesRegistered = false;

/**
 * Let a style load tiles from one `.pmtiles` file with `pmtiles://`.
 *
 * That is the offline path: a self-hosted style under `public/` points its
 * source at a single archive this app serves with range requests, and no
 * tile server is needed. Registering is global to MapLibre, so it happens
 * once however many maps mount.
 */
export function registerPmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tilev4);
  pmtilesRegistered = true;
}

/**
 * The heat layer's colour ramp, in the accent.
 *
 * MapLibre paints on a canvas and reads no CSS variable, so the map passes
 * the computed values of `--color-primary` and `--color-primary-container`
 * here. Density climbs from the pale container to the primary at full
 * strength, so the ramp follows a picked accent and the dark palette the
 * way every class does. It was one fixed blue in both palettes. Null when a
 * value is not a hex colour, the form every token takes: the map then draws
 * no heat rather than a colour of its own.
 */
export function heatRamp(
  primary: string,
  container: string,
): ExpressionSpecification | null {
  let ink: Rgb;
  let pale: Rgb;
  try {
    ink = hexToRgb(primary);
    pale = hexToRgb(container);
  } catch {
    return null;
  }
  const at = ({ r, g, b }: Rgb, alpha: number) =>
    `rgba(${r}, ${g}, ${b}, ${alpha})`;
  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    at(ink, 0),
    0.2,
    at(pale, 0.2),
    0.4,
    at(ink, 0.4),
    0.6,
    at(ink, 0.6),
    0.8,
    at(ink, 0.8),
    1,
    at(ink, 1),
  ];
}

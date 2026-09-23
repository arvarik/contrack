/**
 * The heat layer: where a network gathers, drawn as a density field.
 *
 * It reads its own unclustered copy of the contacts (to a heatmap a cluster
 * is one point), weighs every person, scales to the densest place, and
 * colours density with a ramp that turns with the basemap: darkest for the
 * most over a light map, brightest over a dark one. From zoom 7 it fades,
 * and the pins come back. `docs/features/map-view.md` ("Map Layers") has
 * the reasons, from MapLibre's heatmap example and the cartography on
 * colour ramps.
 *
 * @module views/map/heat
 */
import { useEffect, useState } from "react";
import type {
  ExpressionSpecification,
  HeatmapLayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { usePreferences } from "../../contexts/PreferencesContext";
import { hexToRgb, oklchToRgb, rgbToOklch, type Oklch } from "../../lib/color";

export const HEAT_SOURCE_ID = "contacts-heat";
export const HEAT_LAYER_ID = "contacts-heatmap";

/** The heat starts to fade at this zoom. */
export const HEAT_FADE_ZOOM = 7;
/** The heat is gone at this zoom, and the layer is not drawn past it. */
export const HEAT_END_ZOOM = 9;
/** The pins come back over the fading heat from this zoom. */
export const HEAT_PINS_ZOOM = 8;

/** What one person adds, by the notes logged with them. */
const WEIGHT_STOPS = [
  [0, 1],
  [3, 1.3],
  [10, 1.6],
  [25, 2],
] as const;

/** A person's weight in the heat: 1, and up to 2 for a long history. */
export function heatWeight(notes: number): number {
  const [first] = WEIGHT_STOPS;
  if (notes <= first[0]) return first[1];
  for (let i = 1; i < WEIGHT_STOPS.length; i++) {
    const [x0, y0] = WEIGHT_STOPS[i - 1];
    const [x1, y1] = WEIGHT_STOPS[i];
    if (notes <= x1) return y0 + ((notes - x0) / (x1 - x0)) * (y1 - y0);
  }
  return WEIGHT_STOPS[WEIGHT_STOPS.length - 1][1];
}

/** A point's density at its centre per unit of weight: MapLibre's kernel. */
const KERNEL_PEAK = 1 / Math.sqrt(2 * Math.PI);

/** The ramp spans this many doublings: 1/128 of the densest place to all of it. */
const DOUBLINGS = 7;

/**
 * The fewest people the densest place counts as. With nobody sharing a
 * place, one person would otherwise be the whole ramp.
 */
const MIN_DENSEST = 4;

/**
 * The intensity that puts the densest place at full density.
 *
 * The densest place is the heaviest 1 degree cell, about 110 km, which is
 * the heat's radius at a country's zoom. Past 128 people it stops growing,
 * so one person keeps a colour on the ramp's first stop, and a bigger place
 * shows as a wider core rather than a darker one.
 */
export function heatIntensity(
  contacts: readonly Pick<MapContact, "lat" | "lng" | "interactionCount">[],
): number {
  const cells = new Map<string, number>();
  let densest = 0;
  for (const contact of contacts) {
    const key = `${Math.round(contact.lat)}:${Math.round(contact.lng)}`;
    const weight =
      (cells.get(key) ?? 0) + heatWeight(contact.interactionCount ?? 0);
    cells.set(key, weight);
    densest = Math.max(densest, weight);
  }
  const scale = Math.min(Math.max(densest, MIN_DENSEST), 2 ** DOUBLINGS);
  return 1 / (KERNEL_PEAK * scale);
}

/**
 * The heat layer's paint.
 *
 * The intensity eases up with the zoom: over the world the regions add up
 * and would read heavier than the places in them.
 */
export function heatPaint(
  intensity: number,
  stops: readonly HeatStop[],
): HeatmapLayerSpecification["paint"] {
  const over = (
    input: ExpressionSpecification,
    ...pairs: (number | string)[]
  ) => ["interpolate", ["linear"], input, ...pairs] as ExpressionSpecification;
  const scaled = (factor: number) => Number((intensity * factor).toFixed(4));
  return {
    "heatmap-weight": over(["get", "weight"], ...WEIGHT_STOPS.flat()),
    "heatmap-intensity": over(
      ["zoom"],
      0,
      scaled(0.7),
      HEAT_END_ZOOM,
      scaled(1.2),
    ),
    "heatmap-radius": over(["zoom"], 0, 16, 4, 26, HEAT_END_ZOOM, 44),
    "heatmap-opacity": over(["zoom"], HEAT_FADE_ZOOM, 1, HEAT_END_ZOOM, 0),
    "heatmap-color": over(
      ["heatmap-density"],
      ...stops.flatMap((stop) => [stop.density, stop.color]),
    ),
  };
}

/** One stop of the ramp. */
export interface HeatStop {
  /** The density it sits at, 0 to 1. */
  density: number;
  /** `rgba(r, g, b, a)`. */
  color: string;
}

/** The least over a light map: BluYl's first colour, a pale yellow. */
const PALE: Oklch = { l: 0.97, c: 0.1, h: 112 };
/** The most over a dark map: viridis' last colour, a bright yellow. */
const BRIGHT: Oklch = { l: 0.92, c: 0.17, h: 105 };
/** The accent end's lightness: the most on a light map, the least on a dark one. */
const DEEP = { light: 0.45, dark: 0.4 } as const;
/** Each stop's opacity, from the least to the most. */
const ALPHAS = [0.3, 0.45, 0.6, 0.72, 0.8, 0.86, 0.9, 0.94];

/** Mix two colours in OKLCH, the short way round the hue circle. */
function mix(from: Oklch, to: Oklch, t: number): Oklch {
  let turn = to.h - from.h;
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  return {
    l: from.l + (to.l - from.l) * t,
    c: from.c + (to.c - from.c) * t,
    h: (from.h + turn * t + 360) % 360,
  };
}

/**
 * The ramp for an accent, `--color-primary` as the page computes it, in one
 * palette. Null when the value is not a hex colour, the form every token
 * takes: the map then draws no heat rather than a colour of its own.
 */
export function heatStops(
  primary: string,
  mode: "light" | "dark",
): HeatStop[] | null {
  let accent: Oklch;
  try {
    accent = rgbToOklch(hexToRgb(primary));
  } catch {
    return null;
  }
  const deep = { ...accent, l: Math.min(accent.l, DEEP[mode]) };
  const [least, most] = mode === "light" ? [PALE, deep] : [deep, BRIGHT];
  const rgba = (t: number, alpha: number) => {
    const { r, g, b } = oklchToRgb(mix(least, most, t));
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  };
  return [
    { density: 0, color: rgba(0, 0) },
    ...ALPHAS.map((alpha, i) => ({
      density: 2 ** (i - DOUBLINGS),
      color: rgba(i / DOUBLINGS, alpha),
    })),
  ];
}

/** The ramp as a CSS gradient, left to right, for the legend. */
export function heatGradient(stops: readonly HeatStop[]): string {
  const last = stops.length - 1;
  const parts = stops.map(
    (stop, i) => `${stop.color} ${Math.round((i / last) * 100)}%`,
  );
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/**
 * The ramp for the page's accent and palette, while `active`. Read again
 * when either changes, a frame late: the provider paints a new palette in
 * its own effect, after this one.
 */
export function useHeatStops(active: boolean): HeatStop[] | null {
  const { mode, preferences } = usePreferences();
  const accent = preferences.accent;
  const [stops, setStops] = useState<HeatStop[] | null>(null);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const primary = getComputedStyle(
        document.documentElement,
      ).getPropertyValue("--color-primary");
      setStops(heatStops(primary, mode));
    });
    return () => cancelAnimationFrame(frame);
  }, [active, mode, accent]);
  return active ? stops : null;
}

/**
 * True while the map is at `zoom` or closer. The state changes only when
 * the zoom crosses it, so a zoom animation does not re-render every frame.
 */
export function useZoomAtLeast(
  map: MapLibreMap | null,
  zoom: number,
  enabled: boolean,
): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!map || !enabled) return;
    const read = () => setPast(map.getZoom() >= zoom);
    read();
    map.on("zoom", read);
    return () => {
      map.off("zoom", read);
    };
  }, [map, zoom, enabled]);
  return enabled && past;
}

/**
 * The basemap's first label over its last road, border or fill: where the
 * labels start. A style can put a label lower down (the dark style names the
 * water under its roads), and the heat under that one would have the roads
 * drawn across it.
 */
export function firstLabelLayer(
  layers: readonly { id: string; type: string }[],
): string | undefined {
  let lastShape = -1;
  layers.forEach((layer, i) => {
    if (layer.type !== "symbol") lastShape = i;
  });
  return layers.slice(lastShape + 1).find((layer) => layer.type === "symbol")
    ?.id;
}

/**
 * Keep the heat under the basemap's labels, so a city's name reads over its
 * own heat. A new style (a palette change) adds the layer back on top, so
 * it moves down again whenever the style changes. The layers the app adds
 * over GeoJSON are not the basemap's and are left out.
 */
export function useHeatUnderLabels(map: MapLibreMap | null, enabled: boolean) {
  useEffect(() => {
    if (!map || !enabled) return;
    const sink = () => {
      if (!map.getLayer(HEAT_LAYER_ID)) return;
      const order = map.getLayersOrder();
      const basemap = order.flatMap((id) => {
        const layer = map.getLayer(id);
        if (!layer) return [];
        if (layer.source && map.getSource(layer.source)?.type === "geojson") {
          return [];
        }
        return [{ id, type: layer.type }];
      });
      const label = firstLabelLayer(basemap);
      if (label && order.indexOf(HEAT_LAYER_ID) > order.indexOf(label)) {
        map.moveLayer(HEAT_LAYER_ID, label);
      }
    };
    sink();
    map.on("styledata", sink);
    return () => {
      map.off("styledata", sink);
    };
  }, [map, enabled]);
}

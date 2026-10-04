/**
 * The clusters and single contacts the map is showing right now.
 *
 * MapLibre clusters the contacts source in its worker, and the result lives
 * in the source's loaded tiles. This hook reads those features back with
 * `querySourceFeatures`, so every visible cluster and pin can render as a
 * React element: a real `<button>` with a name, not an HTML string.
 *
 * It reads on `move`, `moveend` and on `sourcedata` for this source,
 * throttled to one read per animation frame. The loaded tiles cover a little
 * more than the viewport, and a feature near a tile edge is in more than one
 * tile, so the result is deduplicated by `cluster_id` for a cluster and by
 * contact id for a point. Past the cluster zoom, points at one spot are one
 * stack. State changes only when the set of features or a position changes,
 * so a pan does not re-render every marker.
 *
 * @module views/map/useClusterFeatures
 */
import { useEffect, useState } from "react";
import type { Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";

export interface ClusterFeature {
  kind: "cluster";
  key: string;
  /** MapLibre's id. A stack of points past the cluster zoom has none. */
  clusterId?: number;
  /** A stack's people. A cluster's come from MapLibre. */
  ids?: string[];
  count: number;
  longitude: number;
  latitude: number;
}

interface PointFeature {
  kind: "point";
  key: string;
  /** The contact id. */
  id: string;
  longitude: number;
  latitude: number;
}

export type VisibleFeature = ClusterFeature | PointFeature;

/** The part of a queried feature this module reads. */
interface QueriedFeature {
  geometry: { type: string; coordinates?: unknown };
  properties: Record<string, unknown> | null;
}

const EMPTY: VisibleFeature[] = [];

function pointOf(
  feature: QueriedFeature,
): { longitude: number; latitude: number } | null {
  if (feature.geometry.type !== "Point") return null;
  const coordinates = feature.geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const [longitude, latitude] = coordinates;
  if (typeof longitude !== "number" || typeof latitude !== "number") {
    return null;
  }
  return { longitude, latitude };
}

/**
 * Turn queried source features into one entry per cluster or contact.
 *
 * Pure, so the dedupe rule is tested without a map.
 */
export function toVisibleFeatures(
  features: readonly QueriedFeature[],
): VisibleFeature[] {
  const seen = new Set<string>();
  const result = new Map<string, VisibleFeature>();
  for (const feature of features) {
    const point = pointOf(feature);
    const properties = feature.properties ?? {};
    if (!point) continue;
    if (properties.cluster) {
      const clusterId = Number(properties.cluster_id);
      const key = `cluster:${clusterId}`;
      if (!Number.isFinite(clusterId) || result.has(key)) continue;
      const count = Number(properties.point_count) || 0;
      result.set(key, { kind: "cluster", key, clusterId, count, ...point });
      continue;
    }
    const id = properties.id;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    // One tile decodes one spot to one position, so equal is exact here.
    const at = `${point.longitude},${point.latitude}`;
    const spot = result.get(`at:${at}`);
    const ids = spot?.kind === "point" ? [spot.id] : (spot?.ids ?? []);
    result.set(
      `at:${at}`,
      ids.length
        ? {
            kind: "cluster",
            key: `stack:${at}`,
            ids: [...ids, id],
            count: ids.length + 1,
            ...point,
          }
        : { kind: "point", key: `point:${id}`, id, ...point },
    );
  }
  return [...result.values()];
}

/** True when both lists hold the same features at the same positions. */
export function sameFeatures(
  a: readonly VisibleFeature[],
  b: readonly VisibleFeature[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].key !== b[i].key ||
      a[i].longitude !== b[i].longitude ||
      a[i].latitude !== b[i].latitude
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The visible features of `sourceId` on `map`.
 *
 * `map` is null until the map has loaded, and the hook returns an empty list
 * until then.
 */
export function useClusterFeatures(
  map: MapLibreMap | null,
  sourceId: string,
): VisibleFeature[] {
  const [features, setFeatures] = useState<VisibleFeature[]>(EMPTY);

  useEffect(() => {
    if (!map) return;
    let frame = 0;

    const read = () => {
      frame = 0;
      const next = map.getSource(sourceId)
        ? toVisibleFeatures(map.querySourceFeatures(sourceId))
        : EMPTY;
      setFeatures((previous) =>
        sameFeatures(previous, next) ? previous : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const onSourceData = (event: MapSourceDataEvent) => {
      if (event.sourceId === sourceId) schedule();
    };

    map.on("move", schedule);
    map.on("moveend", schedule);
    map.on("sourcedata", onSourceData);
    schedule();

    return () => {
      map.off("move", schedule);
      map.off("moveend", schedule);
      map.off("sourcedata", onSourceData);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [map, sourceId]);

  return map ? features : EMPTY;
}

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
 * contact id for a point. State changes only when the set of features or a
 * position changes, so a pan does not re-render every marker.
 *
 * @module views/map/useClusterFeatures
 */
import { useEffect, useState } from "react";
import type { Map as MapLibreMap, MapSourceDataEvent } from "maplibre-gl";

export interface ClusterFeature {
  kind: "cluster";
  key: string;
  clusterId: number;
  count: number;
  atRisk: number;
  overdue: number;
  scoreSum: number;
  longitude: number;
  latitude: number;
}

export interface PointFeature {
  kind: "point";
  key: string;
  /** The contact id. */
  id: string;
  longitude: number;
  latitude: number;
}

export type VisibleFeature = ClusterFeature | PointFeature;

/** The part of a queried feature this module reads. */
export interface QueriedFeature {
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
  const result: VisibleFeature[] = [];
  for (const feature of features) {
    const point = pointOf(feature);
    const properties = feature.properties ?? {};
    if (!point) continue;
    if (properties.cluster) {
      const clusterId = Number(properties.cluster_id);
      if (!Number.isFinite(clusterId)) continue;
      const key = `cluster:${clusterId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        kind: "cluster",
        key,
        clusterId,
        count: Number(properties.point_count) || 0,
        atRisk: Number(properties.atRisk) || 0,
        overdue: Number(properties.overdue) || 0,
        scoreSum: Number(properties.scoreSum) || 0,
        ...point,
      });
    } else {
      const id = properties.id;
      if (typeof id !== "string" || !id) continue;
      const key = `point:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ kind: "point", key, id, ...point });
    }
  }
  return result;
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

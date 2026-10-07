/**
 * The clusters and single contacts the map shows now, read back from
 * MapLibre's tiles with `querySourceFeatures` so each renders as a real
 * `<button>`, not an HTML string. A feature near a tile edge is in more than
 * one tile, so results dedupe by `cluster_id` or contact id. Points at one
 * spot become one stack. State changes only when a feature or a position
 * changes, so a pan does not re-render every marker.
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
  id: string;
  longitude: number;
  latitude: number;
}

export type VisibleFeature = ClusterFeature | PointFeature;

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

/** One entry per cluster, contact or stack. Pure, so tests need no map. */
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

/** The visible features of `sourceId`, read once a frame at most. */
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

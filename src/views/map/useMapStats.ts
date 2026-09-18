/**
 * useMapStats — Viewport statistics hook with 150ms moveend debouncing.
 *
 * Computes viewport aggregates over visible placed contacts. Recomputes
 * 150ms after the map finishes panning or zooming (moveend), or when
 * contacts change.
 *
 * @module views/map/useMapStats
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { computeMapStats, getInViewContacts, type MapStats } from "./mapStats";

export const MOVEEND_DEBOUNCE_MS = 150;

export interface UseMapStatsOptions {
  contacts: readonly MapContact[];
  map: MapLibreMap | null;
  totalCount?: number;
}

export interface UseMapStatsResult {
  stats: MapStats;
  inViewContacts: MapContact[];
}

export function useMapStats({
  contacts,
  map,
  totalCount,
}: UseMapStatsOptions): UseMapStatsResult {
  const [stats, setStats] = useState<MapStats>(() =>
    computeMapStats(
      contacts,
      map ? map.getBounds() : null,
      new Date(),
      totalCount,
    ),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const updateStats = () => {
      const bounds = map ? map.getBounds() : null;
      setStats(computeMapStats(contacts, bounds, new Date(), totalCount));
    };

    if (!map) {
      updateStats();
      return;
    }

    // Compute stats on map ready or contacts change
    updateStats();

    const handleMoveEnd = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        updateStats();
      }, MOVEEND_DEBOUNCE_MS);
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      map.off("moveend", handleMoveEnd);
    };
  }, [map, contacts, totalCount]);

  const inViewContacts = useMemo(() => {
    if (!stats) return [];
    const bounds = map ? map.getBounds() : null;
    return getInViewContacts(contacts, bounds);
  }, [contacts, map, stats]);

  return { stats, inViewContacts };
}

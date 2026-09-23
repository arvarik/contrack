/**
 * useMapStats — Viewport statistics hook with 150ms moveend debouncing.
 *
 * Computes viewport aggregates over visible placed contacts. Recomputes
 * 150ms after the map finishes panning or zooming (moveend), or when
 * contacts change.
 *
 * @module views/map/useMapStats
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { computeMapStats, getInViewContacts, type MapStats } from "./mapStats";
import { clearBounds } from "./insets";

export const MOVEEND_DEBOUNCE_MS = 150;

export interface UseMapStatsOptions {
  contacts: readonly MapContact[];
  map: MapLibreMap | null;
  /** A contact is open over the map's right side. */
  contactOpen?: boolean;
  /**
   * Changes whenever a cover opens or closes (the insights panel, a
   * contact). Opening one does not always move the map, and the count reads
   * the part of the map it leaves clear.
   */
  covers?: string;
}

export interface UseMapStatsResult {
  stats: MapStats;
  inViewContacts: MapContact[];
}

export function useMapStats({
  contacts,
  map,
  contactOpen = false,
  covers = "",
}: UseMapStatsOptions): UseMapStatsResult {
  /** The part of the map a person can see: what no panel covers. */
  const visible = useCallback(
    () => (map ? clearBounds(map, { contactOpen }) : null),
    [map, contactOpen],
  );
  // One reading of the view gives both the numbers and the people.
  const read = useCallback((): UseMapStatsResult => {
    const bounds = visible();
    return {
      stats: computeMapStats(contacts, bounds),
      inViewContacts: getInViewContacts(contacts, bounds),
    };
  }, [contacts, visible]);
  const [result, setResult] = useState<UseMapStatsResult>(read);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const update = () => setResult(read());

    // On map ready, when the contacts change and when a cover opens or
    // closes.
    update();
    if (!map) return;

    const handleMoveEnd = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(update, MOVEEND_DEBOUNCE_MS);
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      map.off("moveend", handleMoveEnd);
    };
  }, [map, read, covers]);

  return result;
}

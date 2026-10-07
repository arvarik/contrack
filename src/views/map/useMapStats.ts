/** Statistics for the uncovered viewport, read again after each move. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { computeMapStats, getInViewContacts, type MapStats } from "./mapStats";
import { clearBounds } from "./insets";

const MOVEEND_DEBOUNCE_MS = 150;

interface UseMapStatsOptions {
  contacts: readonly MapContact[];
  map: MapLibreMap | null;
  /** A contact is open over the map's right side. */
  contactOpen?: boolean;
  /** Changes when a cover opens or closes, which may not move the map. */
  covers?: string;
}

interface UseMapStatsResult {
  stats: MapStats;
  inViewContacts: MapContact[];
}

export function useMapStats({
  contacts,
  map,
  contactOpen = false,
  covers = "",
}: UseMapStatsOptions): UseMapStatsResult {
  const visible = useCallback(
    () => (map ? clearBounds(map, { contactOpen }) : null),
    [map, contactOpen],
  );
  const read = useCallback((): UseMapStatsResult => {
    const bounds = visible();
    return {
      stats: computeMapStats(contacts, bounds),
      inViewContacts: getInViewContacts(contacts, bounds),
    };
  }, [contacts, visible]);
  const [result, setResult] = useState<UseMapStatsResult>(read);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the shown result was read with, so the effect after the first
  // render does not read the same view again: each read walks every contact.
  const readWith = useRef({ read, covers });

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const update = () => setResult(read());

    // On map ready, and when the contacts or a cover change.
    if (readWith.current.read !== read || readWith.current.covers !== covers) {
      readWith.current = { read, covers };
      update();
    }
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

/**
 * Multi-selection on the map: box, lasso and all in view. It tests contact
 * rows, not rendered tiles, so people inside clusters count. A selection
 * survives filter changes, and the announcement counts the hidden ones.
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { isValidLatLng } from "../../../shared/geo";
import { boundsContain, pointInPolygon, type Point } from "./mapMath";

interface UseMapSelectionOptions {
  contacts?: MapContact[];
  filteredContacts?: MapContact[];
}

export function useMapSelection({
  contacts = [],
  filteredContacts,
}: UseMapSelectionOptions = {}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeContacts = filteredContacts ?? contacts;

  const addMany = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectInView = useCallback(
    (map: MapLibreMap | null, candidates?: MapContact[]) => {
      if (!map) return;
      const list = candidates ?? activeContacts;
      const bounds = map.getBounds();
      const insideIds: string[] = [];

      for (const c of list) {
        if (!isValidLatLng(c.lat, c.lng)) continue;
        if (boundsContain(bounds, { lat: c.lat, lng: c.lng })) {
          insideIds.push(c.id);
        }
      }

      addMany(insideIds);
    },
    [activeContacts, addMany],
  );

  const selectBox = useCallback(
    (
      bounds: [west: number, south: number, east: number, north: number],
      candidates?: MapContact[],
    ) => {
      const list = candidates ?? activeContacts;
      const insideIds: string[] = [];

      for (const c of list) {
        if (!isValidLatLng(c.lat, c.lng)) continue;
        if (boundsContain(bounds, { lat: c.lat, lng: c.lng })) {
          insideIds.push(c.id);
        }
      }

      addMany(insideIds);
    },
    [activeContacts, addMany],
  );

  const selectLasso = useCallback(
    (ring: Point[], candidates?: MapContact[]) => {
      if (ring.length < 3) return;
      const list = candidates ?? activeContacts;
      const insideIds: string[] = [];

      for (const c of list) {
        if (!isValidLatLng(c.lat, c.lng)) continue;
        if (pointInPolygon({ lat: c.lat, lng: c.lng }, ring)) {
          insideIds.push(c.id);
        }
      }

      addMany(insideIds);
    },
    [activeContacts, addMany],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && selectedIds.size > 0) {
        // An open dialog or menu takes Escape first.
        if (document.querySelector('[role="dialog"], [role="menu"]')) return;
        e.preventDefault();
        clear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, clear]);

  const selectedCount = selectedIds.size;

  const visibleSelectedCount = useMemo(() => {
    let count = 0;
    for (const c of activeContacts) {
      if (selectedIds.has(c.id)) count++;
    }
    return count;
  }, [activeContacts, selectedIds]);

  const hiddenCount = Math.max(0, selectedCount - visibleSelectedCount);

  const announcement = useMemo(() => {
    if (selectedCount === 0) return "";
    const people = selectedCount === 1 ? "person" : "people";
    const base = `${selectedCount} ${people} selected`;
    if (hiddenCount > 0) {
      return `${base} (${hiddenCount} hidden by filter)`;
    }
    return base;
  }, [selectedCount, hiddenCount]);

  return {
    selectedIds,
    selectedCount,
    visibleSelectedCount,
    hiddenCount,
    announcement,
    addMany,
    clear,
    selectInView,
    selectBox,
    selectLasso,
  };
}

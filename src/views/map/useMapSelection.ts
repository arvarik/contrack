/**
 * useMapSelection — manages geospatial multi-selection on the map.
 *
 * Provides:
 * - A Set of selected contact IDs
 * - Selection via Box (Shift+drag), Lasso (freehand polygon), Cluster, and All in view
 * - Selection tests actual MapContact rows, not rendered tiles, so contacts
 *   inside clusters are included
 * - Preserves selection across filter changes and reports hidden count
 * - Escape key to clear selection
 * - Accessibility announcements: "N people selected" and "(M hidden by filter)"
 *
 * @module views/map/useMapSelection
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { isValidLatLng } from "../../../shared/geo";
import { boundsContain, pointInPolygon, type Point } from "./mapMath";
import { CONTACTS_SOURCE_ID } from "./ContactMap";

export interface UseMapSelectionOptions {
  contacts?: MapContact[];
  filteredContacts?: MapContact[];
}

export function useMapSelection({
  contacts = [],
  filteredContacts,
}: UseMapSelectionOptions = {}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeContacts = filteredContacts ?? contacts;

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

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

  const selectCluster = useCallback(
    async (clusterId: number, map: MapLibreMap | null) => {
      if (!map) return;
      const source = map.getSource<GeoJSONSource>(CONTACTS_SOURCE_ID);
      if (!source) return;

      try {
        const leaves = await source.getClusterLeaves(clusterId, Infinity, 0);
        const leafIds = leaves
          .map((leaf) => leaf.properties?.id)
          .filter((id): id is string => typeof id === "string");

        addMany(leafIds);
      } catch {
        // Source may have unmounted or zoomed
      }
    },
    [addMany],
  );

  // Clear selection on Escape when no modal or menu is open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedIds.size > 0) {
        // If a modal or menu is open, let the modal handle Escape first
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
    toggle,
    addMany,
    clear,
    selectInView,
    selectBox,
    selectLasso,
    selectCluster,
  };
}

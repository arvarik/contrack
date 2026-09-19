/**
 * MapView — the map page, at `/map` and `/map/contact/:id`.
 *
 * Draws every placed contact on a MapLibre map. A pin opens the contact
 * over the map at `/map/contact/:id`, and a click on the map itself closes
 * it again. The map is born correct: `ContactMap` measures its container
 * before the map exists, so the zoom, the minimum zoom and the bounds are
 * creation props and nothing moves the view at mount. See the header of
 * `ContactMap.tsx` for the bug that rule prevents.
 *
 * The page map is the one map that is kept between visits (`reuse`) and the
 * one that remembers where it was left (`rememberView`). Both are what make
 * a return to this page instant.
 *
 * @module views/map/MapView
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate, useSearchParams } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { BarChart3, CalendarPlus, ZoomIn, X } from "lucide-react";
import { toast } from "sonner";
import { useMapContacts, useBulkAddToList } from "../../api";
import {
  useMapViews,
  useCreateMapView,
  useUpdateMapView,
  useDeleteMapView,
  type MapLayer,
  type MapView as MapViewType,
  type MapBounds,
} from "../../api/mapViews";
import { usePageTitle } from "../../hooks/usePageTitle";
import { NAMES } from "../../lib/names";
import { ContactMap } from "./ContactMap";
import { flyToContact, prefersReducedMotion, settlePadding } from "./flyTo";
import { measureInsets, paddingFor, type Insets } from "./insets";
import { useMapFilter } from "./useMapFilter";
import { MapToolbar } from "./MapToolbar";
import { StatsStrip } from "./StatsStrip";
import { MapInsightsPane } from "./MapInsightsPane";
import { HealthLegend } from "./HealthLegend";
import { SaveViewModal } from "./SaveViewModal";
import { RenameViewModal } from "./RenameViewModal";
import { useMapStats } from "./useMapStats";
import { isTypingTarget } from "../../lib/keyboard";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { usePreferences } from "../../contexts/PreferencesContext";
import { isValidLatLng, type MapContact } from "../../../shared/geo";
import { useMapSelection } from "./useMapSelection";
import { useBulkActions } from "../../components/bulk/useBulkActions";
import { BulkActionToolbar } from "../contact-list/BulkActionToolbar";
import { BulkModals } from "../../components/bulk/BulkModals";
import { FollowUpModal } from "./FollowUpModal";
import { SelectionOverlay } from "./SelectionOverlay";
import { QuickInteractionModal } from "../../components/QuickInteractionModal";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { boundsOf } from "./mapMath";

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences, setPreference } = usePreferences();

  const urlViewId = searchParams.get("view");
  const urlLayer = searchParams.get("layer") as MapLayer | null;
  const initialLayer: MapLayer =
    urlLayer && ["pins", "heat", "health"].includes(urlLayer)
      ? urlLayer
      : (preferences.mapLayer ?? "pins");

  const [layer, setLayerState] = useState<MapLayer>(initialLayer);

  useEffect(() => {
    if (!urlLayer && preferences.mapLayer) {
      setLayerState(preferences.mapLayer);
    }
  }, [preferences.mapLayer, urlLayer]);
  const [activeViewId, setActiveViewId] = useState<string | null>(urlViewId);

  const filter = useMapFilter(contacts, {
    activeViewId,
    onClearActiveView: () => setActiveViewId(null),
  });
  const navigate = useNavigate();
  const openMatch = useMatch("/map/contact/:id");
  const openId = openMatch?.params.id ?? null;
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const singleKeyShortcuts = useSingleKeyShortcuts();
  const isWide = useMediaQuery(WIDE_QUERY);
  const [mobilePaneOpen, setMobilePaneOpen] = useState(false);
  const isDesktopPaneOpen = preferences.mapPaneOpen ?? true;
  const isPaneOpen = isWide ? isDesktopPaneOpen : mobilePaneOpen;

  const { data: mapViews = [] } = useMapViews();
  const createMapView = useCreateMapView();
  const updateMapView = useUpdateMapView();
  const deleteMapView = useDeleteMapView();

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [renameTargetView, setRenameTargetView] = useState<MapViewType | null>(
    null,
  );

  const handleLayerChange = useCallback(
    (nextLayer: MapLayer) => {
      setLayerState(nextLayer);
      setActiveViewId(null);
      setPreference("mapLayer", nextLayer);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("view");
          if (nextLayer !== "pins") next.set("layer", nextLayer);
          else next.delete("layer");
          return next;
        },
        { replace: true },
      );
    },
    [setPreference, setSearchParams],
  );

  const handleSelectView = useCallback(
    (view: MapViewType) => {
      setActiveViewId(view.id);
      filter.setRawInput(view.query, { syncUrl: false });
      setLayerState(view.layer);
      setPreference("mapLayer", view.layer);

      setSearchParams({ view: view.id }, { replace: true });

      if (map) {
        const [west, south, east, north] = view.bounds;
        const padding = paddingFor(
          measureInsets(map.getContainer(), { contactOpen: openId !== null }),
        );
        const reduced = prefersReducedMotion();
        if (west === east && south === north) {
          if (reduced) {
            map.jumpTo({ center: [west, south], zoom: 10, padding });
          } else {
            map.flyTo({ center: [west, south], zoom: 10, padding });
          }
        } else {
          map.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding, maxZoom: 14, duration: reduced ? 0 : 800 },
          );
        }
      }
    },
    [filter, map, openId, setPreference, setSearchParams],
  );

  // Initial load ?view= resolution:
  const hasAppliedInitialView = useRef(false);
  useEffect(() => {
    if (
      !urlViewId ||
      hasAppliedInitialView.current ||
      mapViews.length === 0 ||
      !map
    )
      return;
    const matching = mapViews.find((v) => v.id === urlViewId);
    if (matching) {
      hasAppliedInitialView.current = true;
      setActiveViewId(matching.id);
      filter.setRawInput(matching.query, { syncUrl: false });
      setLayerState(matching.layer);
      setPreference("mapLayer", matching.layer);

      const [west, south, east, north] = matching.bounds;
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: openId !== null }),
      );
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding, duration: 0, maxZoom: 14 },
      );
    }
  }, [urlViewId, mapViews, map, filter, openId, setPreference]);

  const handleSaveView = useCallback(
    async (name: string) => {
      if (!map) throw new Error("Map not ready");
      const b = map.getBounds();
      const rawWest = b.getWest();
      const rawEast = b.getEast();
      const rawSouth = b.getSouth();
      const rawNorth = b.getNorth();

      let west = Math.max(-180, Math.min(180, rawWest));
      let east = Math.max(-180, Math.min(180, rawEast));
      let south = Math.max(-85, Math.min(85, rawSouth));
      const north = Math.max(-85, Math.min(85, rawNorth));

      if (rawWest <= -180 && rawEast >= 180) {
        west = -180;
        east = 180;
      }
      if (south >= north) {
        south = Math.max(-85, north - 0.01);
      }

      const bounds: MapBounds = [
        Number(west.toFixed(6)),
        Number(south.toFixed(6)),
        Number(east.toFixed(6)),
        Number(north.toFixed(6)),
      ];
      const created = await createMapView.mutateAsync({
        name,
        query: filter.rawInput.trim(),
        layer,
        bounds,
      });
      toast.success(`View "${created.name}" saved`);
      setActiveViewId(created.id);
      setSearchParams({ view: created.id }, { replace: true });
    },
    [map, createMapView, filter.rawInput, layer, setSearchParams],
  );

  const handleRenameView = useCallback(
    async (id: string, newName: string) => {
      const updated = await updateMapView.mutateAsync({
        id,
        data: { name: newName },
      });
      toast.success(`View renamed to "${updated.name}"`);
    },
    [updateMapView],
  );

  const handleDeleteView = useCallback(
    async (view: MapViewType) => {
      await deleteMapView.mutateAsync(view.id);
      toast.success(`View "${view.name}" deleted`);
      if (activeViewId === view.id) {
        setActiveViewId(null);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("view");
            if (filter.rawInput.trim()) next.set("q", filter.rawInput.trim());
            if (layer !== "pins") next.set("layer", layer);
            return next;
          },
          { replace: true },
        );
      }
    },
    [deleteMapView, activeViewId, setSearchParams, filter.rawInput, layer],
  );

  const { stats, inViewContacts } = useMapStats({
    contacts: filter.filteredContacts,
    map,
    totalCount: contacts.length,
  });

  const selection = useMapSelection({
    contacts,
    filteredContacts: filter.filteredContacts,
  });

  const bulkActions = useBulkActions({
    selectedIds: selection.selectedIds,
    contacts,
    onComplete: () => {
      selection.clear();
    },
  });

  const [isLassoMode, setIsLassoMode] = useState(false);
  const [quickNoteContactId, setQuickNoteContactId] = useState<string | null>(
    null,
  );
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [singleFollowUpContactId, setSingleFollowUpContactId] = useState<
    string | null
  >(null);
  const [singleListContactId, setSingleListContactId] = useState<string | null>(
    null,
  );
  const [isSingleAddToListOpen, setIsSingleAddToListOpen] = useState(false);

  const bulkAddToList = useBulkAddToList();

  const handleAddToListSubmit = useCallback(
    (listId: string) => {
      if (isSingleAddToListOpen && singleListContactId) {
        bulkAddToList.mutate(
          { listId, contactIds: [singleListContactId] },
          {
            onSuccess: ({ count }) => {
              toast.success(
                `Added ${count} contact${count !== 1 ? "s" : ""} to list`,
              );
              setIsSingleAddToListOpen(false);
              setSingleListContactId(null);
            },
            onError: (err) => {
              toast.error(
                `Failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            },
          },
        );
      } else {
        bulkActions.handleBulkAddToList(listId);
      }
    },
    [isSingleAddToListOpen, singleListContactId, bulkAddToList, bulkActions],
  );

  const followUpIds = useMemo(() => {
    if (singleFollowUpContactId) return [singleFollowUpContactId];
    return Array.from(selection.selectedIds);
  }, [singleFollowUpContactId, selection.selectedIds]);

  const handleZoomToSelection = useCallback(() => {
    if (!map || selection.selectedIds.size === 0) return;
    const selectedContacts = contacts.filter((c) =>
      selection.selectedIds.has(c.id),
    );
    const points = selectedContacts
      .filter((c) => isValidLatLng(c.lat, c.lng))
      .map((c) => ({ lat: c.lat as number, lng: c.lng as number }));
    const bounds = boundsOf(points);
    if (!bounds) return;
    const [west, south, east, north] = bounds;
    const padding = paddingFor(
      measureInsets(map.getContainer(), { contactOpen: openId !== null }),
    );
    const reduced = prefersReducedMotion();
    if (west === east && south === north) {
      if (reduced) {
        map.jumpTo({ center: [west, south], zoom: 12, padding });
      } else {
        map.flyTo({ center: [west, south], zoom: 12, padding });
      }
    } else {
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding, maxZoom: 14, duration: reduced ? 0 : 800 },
      );
    }
  }, [map, selection.selectedIds, contacts, openId]);

  usePageTitle(NAMES.map.title);

  const toggleInsightsPane = useCallback(
    (open?: boolean) => {
      if (isWide) {
        const next = open !== undefined ? open : !isDesktopPaneOpen;
        setPreference("mapPaneOpen", next);
      } else {
        setMobilePaneOpen((prev) => (open !== undefined ? open : !prev));
      }
    },
    [isWide, isDesktopPaneOpen, setPreference],
  );

  const handleApplyFacet = useCallback(
    (facetQuery: string) => {
      const trimmed = facetQuery.trim();
      const current = filter.rawInput.trim();
      if (!current.includes(trimmed)) {
        filter.setRawInput(current ? `${current} ${trimmed} ` : `${trimmed} `);
      }
    },
    [filter],
  );

  const handleFitAll = useCallback(() => {
    if (!map || filter.filteredContacts.length === 0) return;
    const valid = filter.filteredContacts.filter((c) =>
      isValidLatLng(c.lat, c.lng),
    );
    if (valid.length === 0) return;
    let west = 180;
    let south = 90;
    let east = -180;
    let north = -90;
    for (const c of valid) {
      const lat = c.lat as number;
      const lng = c.lng as number;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    const padding = paddingFor(
      measureInsets(map.getContainer(), { contactOpen: openId !== null }),
    );
    const reduced = prefersReducedMotion();
    if (west === east && south === north) {
      if (reduced) {
        map.jumpTo({ center: [west, south], zoom: 10, padding });
      } else {
        map.flyTo({ center: [west, south], zoom: 10, padding });
      }
    } else {
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding, maxZoom: 14, duration: reduced ? 0 : 1000 },
      );
    }
  }, [map, filter.filteredContacts, openId]);

  const handleSelectContactFromPane = useCallback(
    (contact: MapContact) => {
      if (!map || !isValidLatLng(contact.lat, contact.lng)) return;
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: false }),
      );
      flyToContact(
        map,
        { longitude: contact.lng as number, latitude: contact.lat as number },
        { padding },
      );
    },
    [map],
  );

  /**
   * What covers the map at mount, measured before the map exists.
   */
  const initialInsets = useMemo<Insets>(() => {
    const right = isWide && isDesktopPaneOpen ? 320 : 0;
    return { right, bottom: 0 };
  }, [isWide, isDesktopPaneOpen]);

  const open = contacts.find((contact) => contact.id === openId) ?? null;
  const openLat = open?.lat ?? null;
  const openLng = open?.lng ?? null;
  useEffect(() => {
    if (!map) return;
    const padding = paddingFor(
      measureInsets(map.getContainer(), { contactOpen: openId !== null }),
    );
    if (openLat !== null && openLng !== null) {
      flyToContact(map, { longitude: openLng, latitude: openLat }, { padding });
    } else {
      settlePadding(map, padding);
    }
  }, [map, openId, openLat, openLng, isPaneOpen]);

  useEffect(() => {
    if (!map) return;
    const onResize = () =>
      map.setPadding(
        paddingFor(
          measureInsets(map.getContainer(), { contactOpen: openId !== null }),
        ),
      );
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [map, openId, isPaneOpen]);

  const openContact = useCallback(
    (id: string) => navigate(`/map/contact/${id}`),
    [navigate],
  );
  const closeContact = useCallback(() => {
    if (openId) navigate("/map");
  }, [navigate, openId]);

  /**
   * Escape closes the contact.
   */
  useEffect(() => {
    if (!openId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      navigate("/map");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, openId]);

  /**
   * Single-key shortcuts: "/", "F", "I".
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event)) return;

      if (event.key === "/") {
        if (!singleKeyShortcuts) return;
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (event.key.toLowerCase() === "f") {
        if (!singleKeyShortcuts) return;
        event.preventDefault();
        handleFitAll();
        return;
      }

      if (event.key.toLowerCase() === "i") {
        if (!singleKeyShortcuts) return;
        event.preventDefault();
        toggleInsightsPane();
        return;
      }

      if (event.key.toLowerCase() === "l") {
        if (!singleKeyShortcuts) return;
        event.preventDefault();
        setIsLassoMode((prev) => !prev);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [singleKeyShortcuts, handleFitAll, toggleInsightsPane]);

  return (
    <div
      ref={pageRef}
      className="map-page w-full h-full relative bg-surface-container-lowest z-0 overflow-hidden"
    >
      <h1 className="sr-only">{NAMES.map.label}</h1>
      <LiveStatus label="Map selection" message={selection.announcement} />
      <SelectionOverlay
        map={map}
        containerRef={pageRef}
        onSelectBox={(bounds) =>
          selection.selectBox(bounds, filter.filteredContacts)
        }
        onSelectLasso={(ring) =>
          selection.selectLasso(ring, filter.filteredContacts)
        }
        isLassoMode={isLassoMode}
        onExitLassoMode={() => setIsLassoMode(false)}
      />
      <MapToolbar
        contacts={contacts}
        map={map}
        rawInput={filter.rawInput}
        setRawInput={filter.setRawInput}
        tokenizer={filter.tokenizer}
        effectiveFilters={filter.effectiveFilters}
        filteredContacts={filter.filteredContacts}
        totalCount={filter.totalCount}
        matchCount={filter.matchCount}
        hasActiveFilter={filter.hasActiveFilter}
        resolveNearFilters={filter.resolveNearFilters}
        clearFilters={filter.clearFilters}
        layer={layer}
        onLayerChange={handleLayerChange}
        views={mapViews}
        activeViewId={activeViewId}
        onSelectView={handleSelectView}
        onOpenSaveModal={() => setIsSaveModalOpen(true)}
        onStartRename={(v) => setRenameTargetView(v)}
        onDeleteView={handleDeleteView}
        inputRef={inputRef}
        onFitAll={handleFitAll}
        onToggleInsights={() => toggleInsightsPane(true)}
        onSelectInView={() =>
          selection.selectInView(map, filter.filteredContacts)
        }
        onStartLasso={() => setIsLassoMode(true)}
        isLassoActive={isLassoMode}
      />
      <StatsStrip
        stats={stats}
        onApplyFacet={handleApplyFacet}
        onFitAll={handleFitAll}
      />
      <MapInsightsPane
        isOpen={isPaneOpen}
        onToggle={toggleInsightsPane}
        stats={stats}
        inViewContacts={inViewContacts}
        onApplyFacet={handleApplyFacet}
        onSelectContact={handleSelectContactFromPane}
      />
      {/* Desktop floating button to reopen insights pane when closed */}
      {!isPaneOpen && (
        <button
          type="button"
          onClick={() => toggleInsightsPane(true)}
          aria-label="Map insights"
          aria-expanded={false}
          className="hidden lg:flex items-center gap-2 absolute top-4 right-4 z-10 glass-panel shadow-lg rounded-2xl px-3 py-2 text-sm font-medium text-on-surface hover:text-primary transition-colors cursor-pointer border border-outline-variant/30 hit-area"
        >
          <BarChart3 className="w-4 h-4 text-primary" />
          <span>Insights</span>
        </button>
      )}
      <ContactMap
        contacts={filter.filteredContacts}
        loading={isLoading}
        selectedId={openId}
        selectedIds={selection.selectedIds}
        onSelect={openContact}
        onMapClick={closeContact}
        onMapReady={setMap}
        initialPadding={initialInsets ? paddingFor(initialInsets) : undefined}
        rememberView={!urlViewId}
        reuse
        layer={layer}
        onLogNote={(id) => setQuickNoteContactId(id)}
        onAddToList={(id) => {
          setSingleListContactId(id);
          setIsSingleAddToListOpen(true);
        }}
        onFollowUp={(id) => {
          setSingleFollowUpContactId(id);
          setIsFollowUpOpen(true);
        }}
      />
      {layer === "health" && <HealthLegend />}

      {/* Map selection floating toolbars */}
      {selection.selectedCount > 0 && (
        <>
          <div
            role="toolbar"
            aria-label="Map selection actions"
            className="absolute bottom-44 md:bottom-22 left-1/2 -translate-x-1/2 z-40 bg-surface-container-lowest/98 backdrop-blur-xl ring-1 ring-outline-variant/40 rounded-2xl shadow-2xl px-3 py-1.5 flex items-center gap-2 max-w-[calc(100%-2rem)] overflow-x-auto scrollbar-hide"
          >
            <span className="font-bold text-xs text-on-surface whitespace-nowrap pl-1">
              {selection.selectedCount} selected
              {selection.hiddenCount > 0 && (
                <span className="text-[11px] text-on-surface-variant font-normal ml-1">
                  ({selection.hiddenCount} hidden by filter)
                </span>
              )}
            </span>
            <div className="w-px h-4 bg-outline-variant/40 shrink-0" />
            <button
              type="button"
              onClick={() => {
                setSingleFollowUpContactId(null);
                setIsFollowUpOpen(true);
              }}
              className="hit-area flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-primary hover:bg-primary/10 transition-colors cursor-pointer shrink-0"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              <span>Add follow-up</span>
            </button>
            <button
              type="button"
              onClick={handleZoomToSelection}
              className="hit-area flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer shrink-0"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              <span>Zoom to selection</span>
            </button>
            <div className="w-px h-4 bg-outline-variant/40 shrink-0" />
            <button
              type="button"
              onClick={selection.clear}
              aria-label="Clear selection"
              title="Clear selection (Escape)"
              className="hit-area p-1 text-on-surface-variant hover:text-on-surface rounded-lg cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <BulkActionToolbar
            isPending={bulkActions.isPending}
            onArchive={bulkActions.handleBulkArchive}
            onAddToList={bulkActions.openAddToList}
            onEditField={bulkActions.openBulkEdit}
            onColorChange={bulkActions.handleBulkColorChange}
            onExportCSV={bulkActions.handleExportCSV}
            onDelete={bulkActions.handleBulkDelete}
          />
        </>
      )}

      {/* Bulk & single modals */}
      <BulkModals
        selectedCount={isSingleAddToListOpen ? 1 : selection.selectedCount}
        isAddToListOpen={isSingleAddToListOpen || bulkActions.isAddToListOpen}
        onCloseAddToList={() => {
          setIsSingleAddToListOpen(false);
          setSingleListContactId(null);
          bulkActions.closeAddToList();
        }}
        onBulkAddToList={handleAddToListSubmit}
        isBulkAddToListPending={bulkActions.isBulkAddToListPending}
        isBulkEditOpen={bulkActions.isBulkEditOpen}
        onCloseBulkEdit={bulkActions.closeBulkEdit}
        onBulkEditApply={bulkActions.handleBulkEditApply}
        isBulkEditPending={bulkActions.isBulkEditPending}
      />

      <FollowUpModal
        isOpen={isFollowUpOpen}
        onClose={() => {
          setIsFollowUpOpen(false);
          setSingleFollowUpContactId(null);
        }}
        contactIds={followUpIds}
      />

      <QuickInteractionModal
        isOpen={quickNoteContactId !== null}
        onClose={() => setQuickNoteContactId(null)}
        initialContactId={quickNoteContactId ?? undefined}
      />

      <SaveViewModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveView}
        currentQuery={filter.rawInput}
        currentLayer={layer}
      />

      <RenameViewModal
        view={renameTargetView}
        isOpen={renameTargetView !== null}
        onClose={() => setRenameTargetView(null)}
        onRename={handleRenameView}
      />
    </div>
  );
};

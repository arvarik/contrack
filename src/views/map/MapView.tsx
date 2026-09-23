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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMatch, useNavigate, useSearchParams } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { cubicBezier } from "motion/react";
import { CalendarPlus, ZoomIn, X } from "lucide-react";
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
import {
  SIDE_PANEL_CLOSE_MS,
  SIDE_PANEL_OPEN_MS,
  SIDE_PANEL_WIDTH,
} from "../../components/layout/SidePanel";
import { EASE } from "../../lib/motion";
import { ContactMap } from "./ContactMap";
import { flyToContact, prefersReducedMotion, settlePadding } from "./flyTo";
import {
  HEAT_END_ZOOM,
  HEAT_FADE_ZOOM,
  useHeatStops,
  useZoomAtLeast,
} from "./heat";
import {
  MIN_OPEN_PX,
  measureInsets,
  measureOpenWidth,
  paddingFor,
  type Insets,
} from "./insets";
import { useMapFilter } from "./useMapFilter";
import { MapToolbar } from "./MapToolbar";
import { StatsStrip } from "./StatsStrip";
import { MapInsightsPane } from "./MapInsightsPane";
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
import { boundsOf, degreesAcross, densestSpan } from "./mapMath";
import { cn } from "../../lib/utils";

/**
 * The insights panel's own curve, so the map's pan and the panel's slide
 * start, run and land together.
 */
const PANEL_EASING = cubicBezier(...EASE);

/** The box around the placed contacts among `people`, or null for none. */
const placedBounds = (people: readonly MapContact[]) =>
  boundsOf(
    people
      .filter((c) => isValidLatLng(c.lat, c.lng))
      .map((c) => ({ lat: c.lat, lng: c.lng })),
  );

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
  const [searchParams, setSearchParams] = useSearchParams();
  const { preferences, setPreference } = usePreferences();

  const urlViewId = searchParams.get("view");
  // Health was a layer until v2, and an old link to it opens on Pins.
  const layerParam = searchParams.get("layer");
  const urlLayer: MapLayer | null =
    layerParam === "heat"
      ? "heat"
      : layerParam === "pins" || layerParam === "health"
        ? "pins"
        : null;
  const initialLayer: MapLayer = urlLayer ?? preferences.mapLayer ?? "pins";

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

  /**
   * Fit the map to a box clear of what covers it, or fly to it when the box
   * is one point. Reduced motion jumps.
   */
  const fitTo = useCallback(
    (bounds: MapBounds, pointZoom: number) => {
      if (!map) return;
      const [west, south, east, north] = bounds;
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: openId !== null }),
      );
      const reduced = prefersReducedMotion();
      if (west === east && south === north) {
        const point = { center: [west, south] as [number, number], padding };
        if (reduced) map.jumpTo({ ...point, zoom: pointZoom });
        else map.flyTo({ ...point, zoom: pointZoom });
        return;
      }
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding, maxZoom: 14, duration: reduced ? 0 : 800 },
      );
    },
    [map, openId],
  );

  const handleSelectView = useCallback(
    (view: MapViewType) => {
      // A view is a query and a layer, and the overdue filter is neither.
      // Cleared first: it clears the active view, which is set next.
      filter.setOverdueOnly(false);
      setActiveViewId(view.id);
      filter.setRawInput(view.query, { syncUrl: false });
      setLayerState(view.layer);
      setPreference("mapLayer", view.layer);

      setSearchParams({ view: view.id }, { replace: true });
      fitTo(view.bounds, 10);
    },
    [filter, fitTo, setPreference, setSearchParams],
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

  // "In view" is what a person can see: the map less the open insights
  // panel and the open contact.
  const { stats, inViewContacts } = useMapStats({
    contacts: filter.filteredContacts,
    map,
    contactOpen: openId !== null,
    covers: `${isPaneOpen}:${openId ?? ""}`,
  });

  // The heat's legend reads the ramp the map paints, and gives way to a
  // button back out once the map is zoomed in past the heat.
  const heatStops = useHeatStops(layer === "heat");
  const pastHeat = useZoomAtLeast(map, HEAT_END_ZOOM, layer === "heat");
  const zoomToHeat = useCallback(() => {
    map?.easeTo({
      zoom: HEAT_FADE_ZOOM - 0.5,
      duration: prefersReducedMotion() ? 0 : 800,
    });
  }, [map]);

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

  /**
   * The bulk bar's room: its height and its offset from the map's bottom.
   * The selection bar sits 8 px above it. On a phone the bulk bar wraps to
   * two rows, and at a fixed offset it covered the selection bar and its
   * Clear button. Measured, as in ContactList.
   */
  const [bulkRoom, setBulkRoom] = useState(0);
  const measureBulkBar = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return;
    const measure = () =>
      setBulkRoom(
        bar.offsetHeight + (parseFloat(getComputedStyle(bar).bottom) || 0),
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  /**
   * The bottom line's height. On a phone MapLibre's zoom buttons and credit
   * sit over it, lifted by this much (index.css), and a line that wraps
   * would otherwise run under them. While the line steps aside they keep
   * its last height, so they do not drop under the bulk bar.
   */
  const [lineHeight, setLineHeight] = useState(0);
  const measureLine = useCallback((corner: HTMLDivElement | null) => {
    if (!corner) return;
    const measure = () => setLineHeight(corner.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(corner);
    return () => observer.disconnect();
  }, []);

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
    const bounds = placedBounds(
      contacts.filter((c) => selection.selectedIds.has(c.id)),
    );
    if (bounds) fitTo(bounds, 12);
  }, [fitTo, selection.selectedIds, contacts]);

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
    const placed = filter.filteredContacts
      .filter((c) => isValidLatLng(c.lat, c.lng))
      .map((c) => ({ lat: c.lat, lng: c.lng }));
    const bounds = boundsOf(placed);
    if (!bounds || !map) return;
    // At the lowest zoom the map shows so many degrees of the part nothing
    // covers. A network wider than that cannot fit, and the middle of it
    // can be an ocean: show the stretch that holds the most people.
    const container = map.getContainer();
    const { right } = measureInsets(container, {
      contactOpen: openId !== null,
    });
    const across = degreesAcross(
      container.clientWidth - right,
      map.getMinZoom(),
    );
    const [west, , east] = bounds;
    fitTo(
      east - west > across
        ? (densestSpan(placed, across * 0.9) ?? bounds)
        : bounds,
      10,
    );
  }, [fitTo, filter.filteredContacts, map, openId]);

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
    const right = isWide && isDesktopPaneOpen ? SIDE_PANEL_WIDTH : 0;
    return { right, bottom: 0 };
  }, [isWide, isDesktopPaneOpen]);

  const open = contacts.find((contact) => contact.id === openId) ?? null;
  const openLat = open?.lat ?? null;
  const openLng = open?.lng ?? null;
  // The pane's last state, so a move that only the pane asked for takes the
  // pane's timing: 300 ms in and 200 out, on its curve.
  const paneWasOpen = useRef(isPaneOpen);
  useEffect(() => {
    if (!map) return;
    const paneMoved = paneWasOpen.current !== isPaneOpen;
    paneWasOpen.current = isPaneOpen;
    const padding = paddingFor(
      measureInsets(map.getContainer(), { contactOpen: openId !== null }),
    );
    if (openLat !== null && openLng !== null) {
      flyToContact(map, { longitude: openLng, latitude: openLat }, { padding });
    } else if (paneMoved) {
      settlePadding(map, padding, {
        duration: isPaneOpen ? SIDE_PANEL_OPEN_MS : SIDE_PANEL_CLOSE_MS,
        easing: PANEL_EASING,
      });
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

  /**
   * How much map the open contact leaves on the left, or null while no
   * contact is open. The toolbar, the legend and the stats strip fit in it:
   * at 1440 px the contact starts at x 580, over the end of the toolbar.
   * Under `MIN_OPEN_PX` they step aside: at 1024 px the contact leaves a
   * strip of 100 px, and they were cut off mid-word.
   */
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!openId || !page) {
      setRoom(null);
      return;
    }
    const measure = () => setRoom(measureOpenWidth(page));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [openId]);
  const cramped = room !== null && room < MIN_OPEN_PX;

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
    // The map, edge to edge. From `lg` the insights button sits in its
    // top-right corner and the panel slides over its right edge.
    //
    // On a phone the bottom line spans the map above the tab bar, where
    // MapLibre's zoom buttons, and the credit on top of them, also start.
    // `--map-line`, its height, lifts those over it, so they are never under
    // it and the credit opens above it. With a contact open, `--map-open`
    // and `data-cramped` keep the credit and the zoom buttons in the map the
    // contact leaves (index.css).
    <div
      className="map-page flex w-full h-full relative bg-surface-container-lowest z-0 overflow-hidden"
      data-cramped={cramped || undefined}
      style={
        {
          "--map-line": `${lineHeight}px`,
          "--map-open": room !== null ? `${room}px` : undefined,
        } as CSSProperties
      }
    >
      <div
        ref={pageRef}
        className="relative flex-1 min-w-0 h-full overflow-hidden"
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
          map={map}
          rawInput={filter.rawInput}
          setRawInput={filter.setRawInput}
          tokenizer={filter.tokenizer}
          effectiveFilters={filter.effectiveFilters}
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
          room={room}
          onFitAll={handleFitAll}
          onToggleInsights={() => toggleInsightsPane(true)}
          onSelectInView={() =>
            selection.selectInView(map, filter.filteredContacts)
          }
          onStartLasso={() => setIsLassoMode(true)}
          isLassoActive={isLassoMode}
        />
        {/*
          The bottom-left corner: the bottom line, 12 px over the tab bar on
          a phone. `z-[3]` puts it over every pin, the selected one (z 2)
          too. The pin cards are z 3 as well and come later in the page, so
          a card still draws over the corner. MapLibre's credit and zoom
          buttons stay in the opposite corner, the credit on top of the zoom
          buttons (index.css), so the two corners never meet. It keeps clear
          of the open insights panel. With a contact open the corner keeps
          to the map it leaves, or steps aside. It steps aside while
          contacts are selected too: the bulk bar spans the map's bottom
          edge.
        */}
        {!cramped && selection.selectedCount === 0 && (
          <div
            ref={measureLine}
            className={cn(
              "absolute left-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:bottom-4 z-[3] flex items-start max-w-[calc(100%-2rem)] pointer-events-none",
              isPaneOpen && "lg:max-w-[calc(100%-22rem)]",
            )}
            style={room !== null ? { maxWidth: room - 32 } : undefined}
          >
            <StatsStrip
              className="pointer-events-auto"
              stats={stats}
              overdueOnly={filter.overdueOnly}
              onOverdueOnlyChange={filter.setOverdueOnly}
              onFitAll={handleFitAll}
              heat={heatStops}
              heatFaded={pastHeat}
              onZoomToHeat={zoomToHeat}
            />
          </div>
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

        {/* Map selection floating toolbars */}
        {selection.selectedCount > 0 && (
          <>
            <div
              role="toolbar"
              aria-label="Map selection actions"
              className="absolute left-1/2 -translate-x-1/2 z-40 bg-surface-container-lowest/98 backdrop-blur-xl ring-1 ring-outline-variant/40 rounded-2xl shadow-2xl px-3 py-1.5 flex items-center gap-2 max-w-[calc(100%-2rem)] overflow-x-auto scrollbar-hide"
              style={{ bottom: bulkRoom + 8 }}
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
                className="hit-area state-layer flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-primary cursor-pointer shrink-0"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                <span>Add follow-up</span>
              </button>
              <button
                type="button"
                onClick={handleZoomToSelection}
                className="hit-area state-layer flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-on-surface cursor-pointer shrink-0"
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
                className="hit-area state-layer p-1 text-on-surface-variant hover:text-on-surface rounded-lg cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <BulkActionToolbar
              ref={measureBulkBar}
              isPending={bulkActions.isPending}
              onTrack={bulkActions.handleBulkTrack}
              selectionTracked={bulkActions.selectionTracked}
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
      <MapInsightsPane
        isOpen={isPaneOpen}
        onToggle={toggleInsightsPane}
        stats={stats}
        inViewContacts={inViewContacts}
        onApplyFacet={handleApplyFacet}
        onSelectContact={handleSelectContactFromPane}
      />
    </div>
  );
};

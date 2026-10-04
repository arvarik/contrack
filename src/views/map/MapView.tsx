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
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  useLocation,
  useMatch,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { cubicBezier } from "motion/react";
import { CalendarPlus, ZoomIn, X } from "lucide-react";
import { toast } from "sonner";
import { useMapContacts, useBulkAddToList } from "../../api";
import {
  useMapViews,
  useCreateMapView,
  useUpdateMapView,
  useMoveMapView,
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
import type { CardAction } from "./MapHoverCard";
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
import { NotOnMap } from "./NotOnMap";
import type { MiniMapContact } from "./LocationMiniMap";
import { MapInsightsPane } from "./MapInsightsPane";
import { SaveViewModal } from "./SaveViewModal";
import { RenameViewModal } from "./RenameViewModal";
import { useMapStats } from "./useMapStats";
import { isTypingTarget } from "../../lib/keyboard";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { usePreferences } from "../../contexts/PreferencesContext";
import { isValidLatLng, type MapContact } from "../../../shared/geo";
import { parseFacetQuery } from "../../../shared/facetQuery";
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

// The dialog's chunk loads the first time a card asks for it.
const AdjustPinModal = lazy(() =>
  import("./AdjustPinModal").then((m) => ({ default: m.AdjustPinModal })),
);

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

/** The map's box as a view keeps it: inside the world, to six decimals. */
function currentBounds(map: MapLibreMap): MapBounds {
  const b = map.getBounds();
  const clamp = (value: number, limit: number) =>
    Math.max(-limit, Math.min(limit, value));
  const north = clamp(b.getNorth(), 85);
  const box = [
    clamp(b.getWest(), 180),
    Math.min(clamp(b.getSouth(), 85), north - 0.01),
    clamp(b.getEast(), 180),
    north,
  ];
  return box.map((edge) => Number(edge.toFixed(6))) as MapBounds;
}

export const MapView = () => {
  const {
    data: contacts = [],
    isLoading,
    isPending,
    isLoadingError,
    refetch,
  } = useMapContacts();
  // Why nobody is on the map, when nobody is.
  const empty = isPending
    ? "loading"
    : isLoadingError
      ? "failed"
      : contacts.length === 0
        ? "none"
        : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const { search } = useLocation();
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
  const filter = useMapFilter(contacts);
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

  const { data: loadedViews } = useMapViews();
  const mapViews = useMemo(() => loadedViews ?? [], [loadedViews]);
  // The view in the URL, while the map shows only it: a stale id names none.
  const activeViewId =
    (!filter.overdueOnly && mapViews.find((v) => v.id === urlViewId)?.id) ||
    null;
  const createMapView = useCreateMapView();
  const updateMapView = useUpdateMapView();
  const moveMapView = useMoveMapView();
  const deleteMapView = useDeleteMapView();
  // The view applied or saved last, which Update writes the map into.
  const [lastViewId, setLastViewId] = useState(urlViewId);
  const lastView = mapViews.find((v) => v.id === lastViewId) ?? null;

  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [renameTargetView, setRenameTargetView] = useState<MapViewType | null>(
    null,
  );

  const handleLayerChange = useCallback(
    (nextLayer: MapLayer) => {
      setLayerState(nextLayer);
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
    (bounds: MapBounds, pointZoom: number, instant = false) => {
      if (!map) return;
      const [west, south, east, north] = bounds;
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: openId !== null }),
      );
      const reduced = instant || prefersReducedMotion();
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

  // A view is a query, a layer and a box. The overdue filter is none of them.
  const { setOverdueOnly } = filter;
  const applyView = useCallback(
    (view: MapViewType, instant = false) => {
      setLastViewId(view.id);
      setOverdueOnly(false);
      setLayerState(view.layer);
      setPreference("mapLayer", view.layer);
      setSearchParams(
        view.query ? { view: view.id, q: view.query } : { view: view.id },
        { replace: true },
      );
      fitTo(view.bounds, 10, instant);
    },
    [setOverdueOnly, fitTo, setPreference, setSearchParams],
  );

  // The page opened on a `?view=` link: show that view, or drop a stale id.
  const linkedViewId = useRef(urlViewId);
  useEffect(() => {
    const id = linkedViewId.current;
    if (!id || !loadedViews || !map) return;
    linkedViewId.current = null;
    const view = loadedViews.find((v) => v.id === id);
    if (view) {
      applyView(view, true);
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("view");
          return next;
        },
        { replace: true },
      );
      toast.info("That saved view no longer exists");
    }
  }, [loadedViews, map, applyView, setSearchParams]);

  /** The URL names the view the map now shows. */
  const showView = useCallback(
    (id: string) => {
      setLastViewId(id);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("view", id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleSaveView = useCallback(
    async (name: string) => {
      if (!map) throw new Error("Map not ready");
      const created = await createMapView.mutateAsync({
        name,
        query: filter.rawInput.trim(),
        layer,
        bounds: currentBounds(map),
      });
      toast.success(`View "${created.name}" saved`);
      showView(created.id);
    },
    [map, createMapView, filter.rawInput, layer, showView],
  );

  // Update writes the filter, the layer and the box into a saved view.
  const handleUpdateView = useCallback(
    (view: MapViewType) => {
      if (!map) return;
      const data = {
        query: filter.rawInput.trim(),
        layer,
        bounds: currentBounds(map),
      };
      updateMapView.mutate(
        { id: view.id, data },
        {
          onSuccess: () => {
            toast.success(`View "${view.name}" now shows this map`);
            showView(view.id);
          },
          onError: (err) =>
            toast.error(`Could not update "${view.name}": ${err.message}`),
        },
      );
    },
    [map, filter.rawInput, layer, updateMapView, showView],
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

  // The hook's toast holds the Undo. The page stays as the view left it,
  // with its layer in the URL.
  const handleDeleteView = useCallback(
    (view: MapViewType) =>
      deleteMapView.mutate(view, {
        onSuccess: () => {
          if (urlViewId === view.id) handleLayerChange(layer);
        },
      }),
    [deleteMapView, urlViewId, handleLayerChange, layer],
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
  // The contact itself, so one with no pin can open the dialog too.
  const [adjusting, setAdjusting] = useState<MiniMapContact | null>(null);

  const handleCardAction = useCallback(
    (action: Exclude<CardAction, "open">, id: string) => {
      if (action === "log") setQuickNoteContactId(id);
      else if (action === "adjust")
        setAdjusting(contacts.find((c) => c.id === id) ?? null);
      else if (action === "list") {
        setSingleListContactId(id);
        setIsSingleAddToListOpen(true);
      } else {
        setSingleFollowUpContactId(id);
        setIsFollowUpOpen(true);
      }
    },
    [contacts],
  );

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
      const [facet] = parseFacetQuery(facetQuery).filters;
      if (facet) filter.addFacet(facet);
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

  // A link that names who to show, such as Ask's "Show on map", lands on them.
  const fitOnArrival = useRef(
    !urlViewId && (searchParams.has("people") || searchParams.has("q")),
  );
  const resolving = filter.effectiveFilters.some((f) => f.resolving);
  useEffect(() => {
    if (!fitOnArrival.current || !map || isPending || resolving) return;
    fitOnArrival.current = false;
    handleFitAll();
  }, [map, isPending, resolving, handleFitAll]);

  // A People row points at its pin, and a press shows the pin's card.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [cardRequest, setCardRequest] = useState<{ id: string } | null>(null);

  const handleSelectContactFromPane = useCallback(
    (contact: MapContact) => {
      if (!map || !isValidLatLng(contact.lat, contact.lng)) return;
      // On a phone the sheet covers the map, so it closes before the flight.
      if (!isWide) setMobilePaneOpen(false);
      const padding = paddingFor(
        measureInsets(map.getContainer(), { contactOpen: false }),
      );
      flyToContact(
        map,
        { longitude: contact.lng as number, latitude: contact.lat as number },
        { padding },
      );
      setCardRequest({ id: contact.id });
    },
    [map, isWide],
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

  // The filter, the layer and the view stay in the URL while a contact is open.
  const openContact = useCallback(
    (id: string) => navigate({ pathname: `/map/contact/${id}`, search }),
    [navigate, search],
  );
  const closeContact = useCallback(() => {
    if (openId) navigate({ pathname: "/map", search });
  }, [navigate, openId, search]);

  /**
   * Escape closes the contact.
   */
  useEffect(() => {
    if (!openId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      closeContact();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeContact, openId]);

  /**
   * Single-key shortcuts: "/", "F", "I", "L". An open menu keeps the keys,
   * its letters jump to its items, and so does a dialog with the focus.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event)) return;
      if (
        document.querySelector('[role="menu"]') ||
        document.activeElement?.closest('[role="dialog"]')
      )
        return;

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
          filter={filter}
          layer={layer}
          onLayerChange={handleLayerChange}
          views={mapViews}
          activeViewId={activeViewId}
          onSelectView={applyView}
          onOpenSaveModal={() => setIsSaveModalOpen(true)}
          onStartRename={(v) => setRenameTargetView(v)}
          onDeleteView={handleDeleteView}
          viewEdits={{
            lastView,
            onUpdateView: handleUpdateView,
            onMoveView: (view, to) => moveMapView.mutate({ view, to }),
          }}
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
            data-map-chrome="bottom"
            className={cn(
              "absolute left-4 bottom-[calc(env(safe-area-inset-bottom)+5rem)] md:bottom-4 z-[3] flex items-start max-w-[calc(100%-2rem)] pointer-events-none",
              isPaneOpen && "lg:max-w-[calc(100%-22rem)]",
            )}
            style={room !== null ? { maxWidth: room - 32 } : undefined}
          >
            <StatsStrip
              className="pointer-events-auto"
              stats={stats}
              empty={empty}
              overdueOnly={filter.overdueOnly}
              onOverdueOnlyChange={filter.setOverdueOnly}
              onFitAll={handleFitAll}
              heat={heatStops}
              heatFaded={pastHeat}
              onZoomToHeat={zoomToHeat}
            />
            <NotOnMap
              className="pointer-events-auto ml-2 shrink-0"
              onSetLocation={setAdjusting}
            />
          </div>
        )}
        <ContactMap
          contacts={filter.filteredContacts}
          loading={isLoading}
          selectedId={openId}
          selectedIds={selection.selectedIds}
          highlightedId={isPaneOpen ? highlightedId : null}
          cardRequest={cardRequest}
          onSelect={openContact}
          onMapClick={closeContact}
          onMapReady={setMap}
          initialPadding={initialInsets ? paddingFor(initialInsets) : undefined}
          rememberView={!urlViewId}
          reuse
          layer={layer}
          onCardAction={handleCardAction}
        />
        {/* The contacts did not load: say so over the map, clear of the
            open insights panel, with a way to ask again. */}
        {empty === "failed" && (
          <div
            className={cn(
              "absolute inset-0 z-[5] flex items-center justify-center p-4 pointer-events-none",
              isPaneOpen && "lg:pr-80",
            )}
          >
            <div className="pointer-events-auto glass-panel shadow-xl rounded-2xl border border-outline-variant/20 flex items-center gap-3 py-2 pl-4 pr-2">
              <p role="alert" className="text-sm font-semibold text-on-surface">
                Could not load contacts
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="btn-secondary btn-sm"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Map selection floating toolbars */}
        {selection.selectedCount > 0 && (
          <>
            <div
              role="toolbar"
              aria-label="Map selection actions"
              data-map-chrome="bottom"
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
          overdueOnly={filter.overdueOnly}
          fromAsk={!!filter.people}
        />

        {adjusting && (
          <Suspense fallback={null}>
            <AdjustPinModal
              contact={adjusting}
              isOpen
              onClose={() => setAdjusting(null)}
            />
          </Suspense>
        )}

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
        empty={empty}
        inViewContacts={inViewContacts}
        activeFilters={filter.parsed.filters}
        onApplyFacet={handleApplyFacet}
        onRemoveFacet={filter.removeFacet}
        onSelectContact={handleSelectContactFromPane}
        onHighlightContact={setHighlightedId}
      />
    </div>
  );
};

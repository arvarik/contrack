/**
 * ContactMap — contacts on a MapLibre map, clustered, as named buttons.
 *
 * Reusable: the map page renders it full size, and a smaller map can render
 * it with `interactive={false}`. It owns the MapLibre map, the clustered
 * GeoJSON source, the pins, the hover card and the zoom buttons.
 *
 * BORN CORRECT. The world must fill the container, so the minimum zoom is a
 * function of the container's size (see `mapMath.ts`). That size is measured
 * before the map exists, and the zoom, the minimum zoom and the bounds are
 * passed as props at creation. Nothing mutates or animates the view at mount.
 * The Leaflet map this replaces once set its zoom in an effect after mount,
 * and the animation it started put every pin in the ocean on a fresh load.
 * The only later change is the resize path, and it uses `jumpTo`, never an
 * animation. Two things keep the rule rather than break it: the page map
 * opens on the view it was left at, read from storage before the map exists
 * (see `lastView.ts`), and it is born with padding for what covers it (see
 * `insets.ts`). The page map can also keep its map alive between visits with
 * `reuse`, and a kept map is not born at all: it comes back as it was.
 *
 * @module views/map/ContactMap
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Layer,
  Map as MapGL,
  NavigationControl,
  Source,
  type ErrorEvent,
  type LayerProps,
  type MapLayerMouseEvent,
  type ViewStateChangeEvent,
} from "react-map-gl/maplibre";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  PaddingOptions,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { toFeatureCollection, type MapContact } from "../../../shared/geo";
import { useAuth } from "../../components/auth/AuthGate";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { usePreferences } from "../../contexts/PreferencesContext";
import { cn } from "../../lib/utils";
import { ClusterMarker } from "./ClusterMarker";
import { ContactMarker } from "./ContactMarker";
import { MapHoverCard } from "./MapHoverCard";
import { STACK_LIMIT, StackPopup, type ContactStack } from "./ContactPopup";
import { prefersReducedMotion } from "./flyTo";
import { readLastView, writeLastView } from "./lastView";
import { collapseAttribution, disableRotation } from "./mapChrome";
import { WORLD_BOUNDS, minZoomFor } from "./mapMath";
import { registerPmtilesProtocol, styleFor } from "./mapStyles";
import { MAPLIBRE_WORKER_URL } from "./maplibreWorker";
import { useClusterFeatures, type ClusterFeature } from "./useClusterFeatures";

registerPmtilesProtocol();

export const CONTACTS_SOURCE_ID = "contacts";

/** Clusters split into single pins past this zoom. */
export const CLUSTER_MAX_ZOOM = 14;

/** Pins closer than this many pixels join one cluster. */
export const CLUSTER_RADIUS = 50;

/**
 * An invisible layer on the contacts source.
 *
 * MapLibre loads tiles only for a source that a visible layer uses, and
 * `querySourceFeatures` reads loaded tiles. With no layer the source holds
 * the contacts and returns none of them. The pins themselves are React
 * markers, so this layer draws nothing.
 */
const PRESENCE_LAYER: LayerProps = {
  id: "contacts-presence",
  type: "circle",
  paint: {
    "circle-radius": 1,
    "circle-opacity": 0,
    "circle-stroke-opacity": 0,
  },
};

/**
 * What the map draws when the basemap style fails to load. A map with no
 * style cannot hold a source, so without this a failed style would also
 * remove every pin.
 */
const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

/**
 * Opens over the Americas rather than the Atlantic. Longitude 0 puts the
 * prime meridian mid-screen and pushes the Americas to the left edge.
 *
 * Zoom 1 is the whole world, because a vector tile is 512 px: every zoom is
 * one step closer than the same number on the 256 px raster tiles the map
 * used before. Zoom 2 here would open on half the planet and hide everybody
 * in Asia until the first drag. The measured minimum zoom raises this when
 * the window is larger than the world at zoom 1.
 */
const DEFAULT_VIEW = { longitude: -95, latitude: 20, zoom: 1 };

/** Where a pin reports its hover when the map draws no card. */
const noPreview = () => {};

export interface ContactMapProps {
  contacts: MapContact[];
  /** The contact whose detail is open, drawn above the others. */
  selectedId?: string | null;
  /** IDs of multi-selected contacts. */
  selectedIds?: Set<string>;
  onSelect: (id: string) => void;
  /** A click on the map itself, not on a pin or a card, and where it landed. */
  onMapClick?: (at: { longitude: number; latitude: number }) => void;
  /** False draws a still map: no pan, no zoom, no zoom buttons. */
  interactive?: boolean;
  initialView?: { longitude: number; latitude: number; zoom?: number };
  /**
   * Padding the map is born with, for what covers it at mount. The map page
   * measures its covers before the map exists (see `insets.ts`).
   */
  initialPadding?: PaddingOptions;
  /**
   * Open on the view this browser was left at, and remember every move. An
   * `initialView` still wins when both are given. The page map alone.
   */
  rememberView?: boolean;
  /**
   * Keep the map alive when this component unmounts and take it back on the
   * next mount, style, tiles and worker included, so a return to the page
   * shows the map at once. One map is kept, so one caller sets this: the
   * page map. A map born with other options must not take it.
   */
  reuse?: boolean;
  /** Keep the minimum zoom where the world covers the container. */
  minZoomFromViewport?: boolean;
  /**
   * False draws pins with no hover card. A small map has no room to open one,
   * and the page around it already names the person.
   */
  hoverCard?: boolean;
  /**
   * Names the region, so two maps on one page are two landmarks a reader can
   * tell apart. The page map keeps the default.
   */
  label?: string;
  /** The map, once it has loaded. The caller uses it to move the view. */
  onMapReady?: (map: MapLibreMap) => void;
  /** The contacts are still loading. */
  loading?: boolean;
  className?: string;
  onLogNote?: (id: string) => void;
  onAddToList?: (id: string) => void;
  onFollowUp?: (id: string) => void;
  /**
   * Rendered inside the map, after the pins. A caller that needs one marker
   * of its own, such as the pin a person drags into place, puts it here.
   */
  children?: ReactNode;
}

export const ContactMap = ({
  contacts,
  selectedId = null,
  selectedIds,
  onSelect,
  onMapClick,
  interactive = true,
  initialView,
  initialPadding,
  rememberView = false,
  reuse = false,
  minZoomFromViewport = true,
  hoverCard = true,
  label = "Contact map",
  onMapReady,
  loading = false,
  className,
  onLogNote,
  onAddToList,
  onFollowUp,
  children,
}: ContactMapProps) => {
  const { mode } = usePreferences();
  const { mapStyles } = useAuth();
  const styleUrl = styleFor(mode, mapStyles);

  // Read once, before the map exists, so the remembered view is a creation
  // prop like every other part of the first frame.
  const [remembered] = useState(() =>
    rememberView && !initialView ? readLastView() : null,
  );
  const startView = initialView ?? remembered ?? DEFAULT_VIEW;
  const remember = useCallback(
    (event: ViewStateChangeEvent) => writeLastView(event.viewState),
    [],
  );

  // Measure before the map exists. useLayoutEffect runs after layout and
  // before paint, so the map still appears on the first painted frame, with
  // the right zoom instead of animating into it.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [initialMinZoom, setInitialMinZoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setInitialMinZoom(
      minZoomFromViewport ? minZoomFor(el.clientWidth, el.clientHeight) : 0,
    );
    // Once, by design. The resize path below owns every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [map, setMap] = useState<MapLibreMap | null>(null);
  useKeepWorldCovering(map, wrapperRef, minZoomFromViewport);

  // The style that failed, not a flag: a theme switch asks for the other
  // style, which deserves its own attempt.
  const [failedStyle, setFailedStyle] = useState<string | null>(null);
  const [basemapError, setBasemapError] = useState<string | null>(null);
  const styleBroken = failedStyle === styleUrl;
  const showBasemapError = styleBroken || basemapError === styleUrl;

  const collection = useMemo(() => toFeatureCollection(contacts), [contacts]);
  const byId = useMemo(() => {
    const index = new Map<string, MapContact>();
    for (const contact of contacts) index.set(contact.id, contact);
    return index;
  }, [contacts]);

  const features = useClusterFeatures(map, CONTACTS_SOURCE_ID);

  // Hover & pin card state
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePreview = useCallback((id: string | null) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (!id) {
      setHoveredId(null);
      return;
    }
    const delay =
      typeof process !== "undefined" && process.env?.NODE_ENV === "test"
        ? 0
        : 150;
    if (delay === 0) {
      setHoveredId(id);
    } else {
      hoverTimerRef.current = setTimeout(() => {
        setHoveredId(id);
      }, delay);
    }
  }, []);

  const handlePinCard = useCallback(
    (id: string) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (pinnedId === id) {
        onSelect(id);
      } else {
        setPinnedId(id);
      }
    },
    [pinnedId, onSelect],
  );

  const handleCloseCard = useCallback(() => {
    setPinnedId(null);
    setHoveredId(null);
  }, []);

  const activeCardId = pinnedId ?? (hoverCard ? hoveredId : null);
  const activeCardContact = activeCardId
    ? (byId.get(activeCardId) ?? null)
    : null;
  const [stack, setStack] = useState<ContactStack | null>(null);

  // Per-cluster leaves cache for displaying "X of Y selected"
  const clusterLeavesCache = useRef<Map<number, string[]>>(new Map());
  const [clusterLeaves, setClusterLeaves] = useState<Map<number, string[]>>(
    new Map(),
  );

  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>(CONTACTS_SOURCE_ID);
    if (!map || !source) return;

    let isMounted = true;
    const clusters = features.filter(
      (f): f is ClusterFeature => f.kind === "cluster",
    );
    const missing = clusters.filter(
      (c) => !clusterLeavesCache.current.has(c.clusterId),
    );

    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (c) => {
        try {
          const leaves = await source.getClusterLeaves(
            c.clusterId,
            Infinity,
            0,
          );
          const ids = leaves
            .map((l) => l.properties?.id)
            .filter((id): id is string => typeof id === "string");
          clusterLeavesCache.current.set(c.clusterId, ids);
          return [c.clusterId, ids] as const;
        } catch {
          return null;
        }
      }),
    ).then(() => {
      if (!isMounted) return;
      setClusterLeaves(new Map(clusterLeavesCache.current));
    });

    return () => {
      isMounted = false;
    };
  }, [map, features]);

  // A stack lists who was in the cluster when it opened. New data, or a
  // zoom that dissolves the cluster, makes that list stale.
  useEffect(() => setStack(null), [contacts]);
  useEffect(() => {
    if (
      stack &&
      !features.some((f) => f.key === `cluster:${stack.clusterId}`)
    ) {
      setStack(null);
    }
  }, [features, stack]);

  const handleError = useCallback(
    (event: ErrorEvent) => {
      const { error } = event;
      const sourceId = (event as ErrorEvent & { sourceId?: string }).sourceId;
      if (sourceId === CONTACTS_SOURCE_ID) return;
      const url = (error as Error & { url?: unknown }).url;
      const styleFailed =
        !sourceId &&
        (url === undefined ? !map?.isStyleLoaded() : url === styleUrl);
      if (styleFailed) setFailedStyle(styleUrl);
      else setBasemapError(styleUrl);
    },
    [map, styleUrl],
  );

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      // MapLibre reports a click on a pin or a card as a map click too, and
      // opening a contact must not also close it.
      const target = event.originalEvent.target as Element | null;
      if (target?.closest?.(".maplibregl-marker, .maplibregl-popup")) return;
      handleCloseCard();
      onMapClick?.({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
      });
    },
    [onMapClick, handleCloseCard],
  );

  const expandCluster = useCallback(
    async (cluster: ClusterFeature) => {
      const source = map?.getSource<GeoJSONSource>(CONTACTS_SOURCE_ID);
      if (!map || !source) return;
      const zoom = await source.getClusterExpansionZoom(cluster.clusterId);
      if (zoom <= CLUSTER_MAX_ZOOM) {
        map.easeTo({
          center: [cluster.longitude, cluster.latitude],
          zoom,
          duration: prefersReducedMotion() ? 0 : 500,
        });
        return;
      }
      // Past the cluster zoom these people stay on one point. List them.
      const leaves = await source.getClusterLeaves(
        cluster.clusterId,
        STACK_LIMIT,
        0,
      );
      const listed = leaves
        .map((leaf) => byId.get(String(leaf.properties?.id)))
        .filter((c): c is MapContact => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStack({
        clusterId: cluster.clusterId,
        longitude: cluster.longitude,
        latitude: cluster.latitude,
        contacts: listed,
        total: cluster.count,
      });
    },
    [map, byId],
  );

  return (
    <div
      ref={wrapperRef}
      role="region"
      aria-label={label}
      className={cn(
        "contact-map relative w-full h-full overflow-hidden bg-surface-container-low",
        className,
      )}
    >
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/50 backdrop-blur-sm">
          <span className="text-primary font-bold animate-pulse">
            Scanning geospatial data...
          </span>
        </div>
      )}
      {showBasemapError && (
        <p
          role="status"
          className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-medium text-on-surface shadow-md"
        >
          The basemap did not load. Pins still work.
        </p>
      )}
      {hoverCard && (
        <LiveStatus
          label="Map card"
          message={
            activeCardContact
              ? [
                  activeCardContact.name,
                  activeCardContact.company,
                  activeCardContact.location,
                ]
                  .filter(Boolean)
                  .join(". ")
              : ""
          }
        />
      )}
      {/* Rendered only once the wrapper is measured. One frame without a
          map is invisible, and pins in the ocean were not. */}
      {initialMinZoom !== null && (
        <MapGL
          mapStyle={styleBroken ? BLANK_STYLE : styleUrl}
          workerUrl={MAPLIBRE_WORKER_URL}
          boxZoom={false}
          initialViewState={{
            longitude: startView.longitude,
            latitude: startView.latitude,
            zoom: Math.max(startView.zoom ?? DEFAULT_VIEW.zoom, initialMinZoom),
            padding: initialPadding,
          }}
          reuseMaps={reuse}
          minZoom={initialMinZoom}
          maxBounds={WORLD_BOUNDS}
          renderWorldCopies={false}
          attributionControl={{ compact: true }}
          interactive={interactive}
          dragRotate={false}
          touchPitch={false}
          pitchWithRotate={false}
          onLoad={(event) => {
            const loaded = event.target;
            collapseAttribution(loaded.getContainer());
            if (interactive) disableRotation(loaded);
            setMap(loaded);
            onMapReady?.(loaded);
          }}
          onMoveEnd={rememberView ? remember : undefined}
          onError={handleError}
          onClick={handleClick}
          style={{ width: "100%", height: "100%" }}
        >
          <Source
            id={CONTACTS_SOURCE_ID}
            type="geojson"
            data={collection}
            cluster
            clusterRadius={CLUSTER_RADIUS}
            clusterMaxZoom={CLUSTER_MAX_ZOOM}
            clusterProperties={{
              atRisk: ["+", ["get", "atRisk"]],
              overdue: ["+", ["get", "overdue"]],
              scoreSum: ["+", ["get", "score"]],
            }}
          >
            <Layer {...PRESENCE_LAYER} />
          </Source>
          {interactive && (
            <NavigationControl position="bottom-right" showCompass={false} />
          )}
          {features.map((feature) => {
            if (feature.kind === "cluster") {
              const leaves = clusterLeaves.get(feature.clusterId) || [];
              const selectedInCluster = selectedIds
                ? leaves.filter((id) => selectedIds.has(id)).length
                : 0;

              return (
                <ClusterMarker
                  key={feature.key}
                  cluster={feature}
                  selectedCount={selectedInCluster}
                  onExpand={expandCluster}
                />
              );
            }
            const contact = byId.get(feature.id);
            if (!contact) return null;
            return (
              <ContactMarker
                key={feature.key}
                contact={contact}
                selected={contact.id === selectedId}
                multiSelected={
                  selectedIds ? selectedIds.has(contact.id) : false
                }
                onSelect={onSelect}
                onPreview={hoverCard ? handlePreview : noPreview}
                onPinCard={handlePinCard}
                hasActiveCard={activeCardId === contact.id}
              />
            );
          })}
          {activeCardContact && !stack && (
            <MapHoverCard
              contact={activeCardContact}
              pinned={pinnedId !== null}
              onClose={handleCloseCard}
              onOpen={onSelect}
              onLogNote={onLogNote}
              onAddToList={onAddToList}
              onFollowUp={onFollowUp}
            />
          )}
          {stack && (
            <StackPopup
              stack={stack}
              onSelect={onSelect}
              onClose={() => setStack(null)}
            />
          )}
          {children}
        </MapGL>
      )}
    </div>
  );
};

/**
 * Keep the world covering the container as the container changes size.
 *
 * Initial sizing happens before the map is created. This is the resize path
 * only, and every call in it is idempotent and not animated, so the first
 * ResizeObserver callback, which fires on observe, changes nothing.
 */
function useKeepWorldCovering(
  map: MapLibreMap | null,
  wrapperRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const el = wrapperRef.current;
    if (!map || !el || !enabled) return;
    const apply = () => {
      const { clientWidth: width, clientHeight: height } = el;
      if (!width || !height) return;
      const minZoom = minZoomFor(width, height);
      if (map.getMinZoom() !== minZoom) map.setMinZoom(minZoom);
      if (map.getZoom() < minZoom) map.jumpTo({ zoom: minZoom });
    };
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [map, wrapperRef, enabled]);
}

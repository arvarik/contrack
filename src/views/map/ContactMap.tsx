/**
 * Contacts on a MapLibre map, clustered, as named buttons. The map page
 * renders it full size, and a smaller map renders it with
 * `interactive={false}`.
 *
 * Born correct: the minimum zoom depends on the container's size (see
 * `mapMath.ts`), so the size is measured before the map exists, and the zoom,
 * minimum zoom, bounds, last view (`lastView.ts`) and padding (`insets.ts`)
 * are creation props. Nothing animates the view at mount, because a zoom
 * animation after mount puts every pin in the ocean on a fresh load. Only
 * the resize path changes the view later, with `jumpTo`. A `reuse` map is
 * not born again: it comes back as it was.
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
} from "@vis.gl/react-maplibre";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  PaddingOptions,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { toFeatureCollection, type MapContact } from "../../../shared/geo";
import { isPastDay } from "../../../shared/dates";
import { useAuth } from "../../components/auth/AuthGate";
import { LiveStatus } from "../../components/ui/LiveStatus";
import { usePreferences } from "../../contexts/PreferencesContext";
import type { MapLayer } from "../../api/mapViews";
import { ClusterMarker } from "./ClusterMarker";
import { ContactMarker, type PinEvent } from "./ContactMarker";
import {
  ClusterPreview,
  MapHoverCard,
  MapPeekSheet,
  type CardAction,
} from "./MapHoverCard";
import { STACK_LIMIT, StackPopup, type ContactStack } from "./StackPopup";
import { prefersReducedMotion } from "../../lib/motion";
import { cardPadding } from "./insets";
import { useHoverCard } from "./useHoverCard";
import { readLastView, writeLastView } from "./lastView";
import { collapseAttribution, disableRotation } from "./mapChrome";
import {
  HEAT_END_ZOOM,
  HEAT_LAYER_ID,
  HEAT_PINS_ZOOM,
  HEAT_SOURCE_ID,
  heatIntensity,
  heatPaint,
  useHeatReadout,
  useHeatStops,
  useHeatUnderLabels,
  useZoomAtLeast,
} from "./heat";
import { WORLD_BOUNDS, minZoomFor } from "./mapMath";
import { registerPmtilesProtocol, styleFor } from "./mapStyles";
import { MAPLIBRE_WORKER_URL } from "./maplibreWorker";
import { useClusterFeatures, type ClusterFeature } from "./useClusterFeatures";
import { touchFirst } from "../../lib/platform";

registerPmtilesProtocol();

export const CONTACTS_SOURCE_ID = "contacts";

/** Pins closer than this many pixels join one cluster. */
const CLUSTER_RADIUS = 50;

/**
 * An invisible layer on the contacts source. MapLibre loads tiles only for a
 * source that a visible layer uses, and `querySourceFeatures` reads loaded
 * tiles, so with no layer the source returns no contacts.
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

/** Drawn when the style fails, since a map with no style holds no pins. */
const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

/**
 * Opens over the Americas rather than the Atlantic. With 512 px vector tiles,
 * zoom 1 is the whole world, and zoom 2 hides Asia until the first drag. The
 * measured minimum zoom raises this in a large window.
 */
const DEFAULT_VIEW = { longitude: -95, latitude: 20, zoom: 1 };

/** A pin's card (a tooltip, a hover card, pinned, or a phone's sheet), or a cluster's preview. */
type Card =
  | {
      kind: "contact";
      id: string;
      mode: "focus" | "hover" | "pinned" | "sheet";
      padding?: PaddingOptions;
      /** A requested card's asker, which Escape gives focus back to. */
      from?: HTMLElement | null;
    }
  | { kind: "cluster"; cluster: ClusterFeature; padding?: PaddingOptions };

/** A cluster's people, and whether no zoom splits it, so a click lists them. */
interface ClusterPeople {
  ids: string[];
  stack: boolean;
}

/** A pinned card and a sheet stay until closed on purpose. */
const stays = (card: Card | null) =>
  card?.kind === "contact" && (card.mode === "pinned" || card.mode === "sheet");

interface ContactMapProps {
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
  /** Padding the map is born with, for what covers it (see `insets.ts`). */
  initialPadding?: PaddingOptions;
  /** Open on, and save, this browser's last view. `initialView` wins. */
  rememberView?: boolean;
  /**
   * Keep the map (style, tiles, worker) alive across unmounts, so a return
   * shows it at once. One map is kept, so only the page map sets this.
   */
  reuse?: boolean;
  /** Keep the minimum zoom where the world covers the container. */
  minZoomFromViewport?: boolean;
  /** False draws pins with no hover card, for a small map. */
  hoverCard?: boolean;
  /** Names the region, so two maps on one page are distinct landmarks. */
  label?: string;
  /** The map, once it has loaded. The caller uses it to move the view. */
  onMapReady?: (map: MapLibreMap) => void;
  loading?: boolean;
  /** A card's button other than Open, which opens the contact. */
  onCardAction?: (action: Exclude<CardAction, "open">, id: string) => void;
  /** The contact a list row points at, whose pin stands out. */
  highlightedId?: string | null;
  /** Show this contact's card, pinned. Each new object asks again. */
  cardRequest?: { id: string } | null;
  layer?: MapLayer;
  /** Rendered inside the map after the pins, such as a draggable pin. */
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
  onCardAction,
  highlightedId = null,
  cardRequest = null,
  layer = "pins",
  children,
}: ContactMapProps) => {
  const { mode } = usePreferences();
  const { mapStyles } = useAuth();
  const styleUrl = styleFor(mode, mapStyles);

  // Read once, before the map exists, so it is a creation prop.
  const [remembered] = useState(() =>
    rememberView && !initialView ? readLastView() : null,
  );
  const startView = initialView ?? remembered ?? DEFAULT_VIEW;
  const remember = useCallback((event: ViewStateChangeEvent) => {
    writeLastView(event.viewState);
  }, []);

  // useLayoutEffect measures before paint, so the first painted frame already
  // has the right zoom.
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

  // The heat is scaled to the contacts shown, and pins come back as it fades.
  const heatOn = layer === "heat";
  const heatStops = useHeatStops(heatOn);
  const heatScale = useMemo(
    () => (heatOn ? heatIntensity(contacts) : 0),
    [heatOn, contacts],
  );
  const heat = useMemo(
    () => heatStops && heatPaint(heatScale, heatStops),
    [heatStops, heatScale],
  );
  useHeatUnderLabels(map, heat !== null);
  const pinsOverHeat = useZoomAtLeast(map, HEAT_PINS_ZOOM, heatOn);
  const drawPins = !heatOn || pinsOverHeat;

  /**
   * CSS hides MapLibre's chrome until load. The attribution control is born
   * expanded, and a class cannot tell that from a reader's open strip, so
   * without this the full strip flashes over every new map. After load the
   * required credit sits behind the "i" button.
   */
  const [ready, setReady] = useState(false);

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

  /**
   * The map once its style arrives, before load. `load` waits for every
   * basemap tile and font, which takes seconds on a slow link, and the pins
   * need only the contacts source.
   */
  const [styledMap, setStyledMap] = useState<MapLibreMap | null>(null);
  const features = useClusterFeatures(map ?? styledMap, CONTACTS_SOURCE_ID);

  const {
    card,
    current: openCard,
    set: setCard,
    show: showCard,
    hide: hideCard,
    keep: keepCard,
  } = useHoverCard<Card>();
  // The pin Escape gives focus back to, which must not open its tooltip again.
  const refocused = useRef<string | null>(null);
  const room = useCallback(
    () => (wrapperRef.current ? cardPadding(wrapperRef.current) : undefined),
    [],
  );
  const handleCloseCard = useCallback(() => setCard(null), [setCard]);

  const select = useCallback(
    (id: string) => {
      setCard(null);
      onSelect(id);
    },
    [onSelect, setCard],
  );

  // A card that stays ignores the mouse, and a leave closes only its own card.
  const onPin = useCallback(
    (id: string, event: PinEvent) => {
      const open = openCard.current;
      const mine = open?.kind === "contact" && open.id === id ? open : null;
      if (!hoverCard) {
        if (event === "tap") onSelect(id);
      } else if (event === "tap") {
        if (mine?.mode === "sheet") select(id);
        else setCard({ kind: "contact", id, mode: "sheet" });
      } else if (event === "space") {
        if (mine?.mode === "pinned") select(id);
        else setCard({ kind: "contact", id, mode: "pinned", padding: room() });
      } else if (event === "focus") {
        if (refocused.current === id) refocused.current = null;
        else if (!mine)
          showCard({ kind: "contact", id, mode: "focus", padding: room() });
      } else if (stays(open)) {
        return;
      } else if (event === "enter") {
        showCard({ kind: "contact", id, mode: "hover", padding: room() });
      } else if (!open || mine) {
        hideCard();
      }
    },
    [hideCard, hoverCard, onSelect, openCard, room, select, setCard, showCard],
  );

  const onCluster = useCallback(
    (cluster: ClusterFeature, event: PinEvent) => {
      const open = openCard.current;
      if (stays(open)) return;
      if (event === "enter" || event === "focus")
        showCard({ kind: "cluster", cluster, padding: room() });
      else if (open?.kind !== "contact") hideCard();
    },
    [hideCard, openCard, room, showCard],
  );

  const onCardPointer = useCallback(
    (inside: boolean) => {
      if (inside) keepCard();
      else if (!stays(openCard.current)) hideCard();
    },
    [hideCard, keepCard, openCard],
  );

  const cardContact =
    card?.kind === "contact" ? (byId.get(card.id) ?? null) : null;
  const runAction = useCallback(
    (action: CardAction) => {
      const id = cardContact?.id;
      if (!id) return;
      if (action === "open") select(id);
      else {
        setCard(null);
        onCardAction?.(action, id);
      }
    },
    [cardContact?.id, onCardAction, select, setCard],
  );
  const [stack, setStack] = useState<ContactStack | null>(null);

  // Each cluster's people, and whether it is a stack that no zoom splits.
  const clusterLeavesCache = useRef<Map<string, ClusterPeople>>(new Map());
  const [clusterLeaves, setClusterLeaves] = useState<
    Map<string, ClusterPeople>
  >(new Map());

  useEffect(() => {
    const source = map?.getSource<GeoJSONSource>(CONTACTS_SOURCE_ID);
    if (!map || !source) return;

    let isMounted = true;
    const missing = features.filter(
      (f): f is ClusterFeature & { clusterId: number } =>
        f.kind === "cluster" &&
        f.clusterId !== undefined &&
        !clusterLeavesCache.current.has(f.key),
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
          const spots = new Set(leaves.map((l) => JSON.stringify(l.geometry)));
          clusterLeavesCache.current.set(c.key, {
            ids,
            stack: spots.size === 1,
          });
        } catch {
          // New data replaced the cluster, and the next read asks again.
        }
      }),
    ).then(() => {
      if (isMounted) setClusterLeaves(new Map(clusterLeavesCache.current));
    });

    return () => {
      isMounted = false;
    };
  }, [map, features]);

  // A stack carries its people. A cluster's arrive from MapLibre once asked.
  const peopleOf = useCallback(
    (f: ClusterFeature): ClusterPeople | undefined =>
      f.ids ? { ids: f.ids, stack: true } : clusterLeaves.get(f.key),
    [clusterLeaves],
  );
  const overdueIds = useMemo(
    () =>
      new Set(
        contacts.filter((c) => isPastDay(c.nextFollowUpAt)).map((c) => c.id),
      ),
    [contacts],
  );

  // New data makes a stack's list, a card and the cluster ids stale: MapLibre
  // can give an old id to a new group.
  useEffect(() => {
    setStack(null);
    setCard(null);
    clusterLeavesCache.current.clear();
    setClusterLeaves((prev) => (prev.size ? new Map() : prev));
  }, [contacts, setCard]);
  // A caller's card, pinned, or a sheet on a touch screen. Each request
  // object opens once, so new contacts do not open it again.
  const asked = useRef<{ id: string } | null>(null);
  useEffect(() => {
    if (!cardRequest || cardRequest === asked.current) return;
    asked.current = cardRequest;
    if (!hoverCard || !byId.has(cardRequest.id)) return;
    const from = document.activeElement;
    const touch = touchFirst();
    setCard({
      kind: "contact",
      id: cardRequest.id,
      mode: touch ? "sheet" : "pinned",
      padding: room(),
      from: from instanceof HTMLElement && from !== document.body ? from : null,
    });
  }, [byId, cardRequest, hoverCard, room, setCard]);
  // A card or a stack belongs to a pin, and the heat takes the pins away.
  useEffect(() => {
    if (drawPins) return;
    setStack(null);
    handleCloseCard();
  }, [drawPins, handleCloseCard]);
  useEffect(() => {
    if (stack && !features.some((f) => f.key === stack.key)) {
      setStack(null);
    }
  }, [features, stack]);

  /**
   * Focus a contact's pin without its tooltip, or the map canvas when no pin
   * is drawn, so the keyboard never falls to the page.
   */
  const refocus = useCallback(
    (contactId: string | null, selector?: string) => {
      const wrapper = wrapperRef.current;
      const target = wrapper?.querySelector<HTMLElement>(
        selector ?? `[data-contact-id="${CSS.escape(contactId ?? "")}"]`,
      );
      if (target && contactId) refocused.current = contactId;
      (target ?? map?.getCanvas())?.focus({ preventScroll: true });
    },
    [map],
  );

  // A closed contact panel takes the focus with it, so give it back to the pin.
  const lastSelected = useRef(selectedId);
  useEffect(() => {
    const closed = lastSelected.current;
    lastSelected.current = selectedId;
    if (!closed || selectedId) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) {
        if (!active.closest("section[data-covers-map]")) return;
      }
      refocus(closed);
    });
    return () => cancelAnimationFrame(frame);
  }, [refocus, selectedId]);

  // Escape closes the card, or else the stack, and nothing under it. Focus
  // goes back to the pin, or the stack's cluster, and the tooltip stays shut.
  useEffect(() => {
    if (!card && !stack) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      const open = openCard.current;
      if (!open) {
        if (stack)
          refocus(null, `[data-cluster-key="${CSS.escape(stack.key)}"]`);
        return setStack(null);
      }
      setCard(null);
      if (open.kind !== "contact" || open.mode === "hover") return;
      if (open.from) return open.from.focus();
      const pin = wrapperRef.current?.querySelector<HTMLElement>(
        `[data-contact-id="${CSS.escape(open.id)}"]`,
      );
      if (pin && pin !== document.activeElement) {
        refocused.current = open.id;
        pin.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [card, stack, openCard, setCard, refocus]);

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
      // MapLibre also reports a click on a pin or a card as a map click.
      const target = event.originalEvent.target as Element | null;
      if (target?.closest?.(".maplibregl-marker, .maplibregl-popup")) return;
      handleCloseCard();
      setStack(null);
      onMapClick?.({
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
      });
    },
    [onMapClick, handleCloseCard],
  );

  /** Focus the pin drawn nearest a spot, while the map holds the focus. */
  const focusNearest = useCallback(
    (spot: { longitude: number; latitude: number }) => {
      const wrapper = wrapperRef.current;
      if (!map || !wrapper || document.activeElement !== map.getCanvas())
        return;
      const box = wrapper.getBoundingClientRect();
      const at = map.project([spot.longitude, spot.latitude]);
      let nearest: HTMLElement | null = null;
      let best = Infinity;
      for (const pin of wrapper.querySelectorAll<HTMLElement>(".map-pin")) {
        const r = pin.getBoundingClientRect();
        const x = r.left + r.width / 2 - box.left;
        const y = r.top + r.height / 2 - box.top;
        const distance = Math.hypot(x - at.x, y - at.y);
        if (distance < best) [nearest, best] = [pin, distance];
      }
      nearest?.focus({ preventScroll: true });
    },
    [map],
  );

  const expandCluster = useCallback(
    async (cluster: ClusterFeature) => {
      const source = map?.getSource<GeoJSONSource>(CONTACTS_SOURCE_ID);
      if (!map || !source) return;
      setCard(null);
      const people = peopleOf(cluster);
      if (!people?.stack && cluster.clusterId !== undefined) {
        const focused = document.activeElement;
        map.easeTo({
          center: [cluster.longitude, cluster.latitude],
          zoom: await source.getClusterExpansionZoom(cluster.clusterId),
          duration: prefersReducedMotion() ? 0 : 500,
        });
        // The zoom unmounts the cluster's button. The focus waits on the map,
        // then a keyboard user's moves to the nearest pin once drawn.
        if (!(focused instanceof HTMLElement)) return;
        if (!wrapperRef.current?.contains(focused)) return;
        const keyboard = focused.matches(":focus-visible");
        map.getCanvas().focus({ preventScroll: true });
        if (keyboard)
          map.once("idle", () => setTimeout(() => focusNearest(cluster), 0));
        return;
      }
      // Everyone is on one spot, which no zoom splits. List them.
      const listed = (people?.ids ?? [])
        .map((id) => byId.get(id))
        .filter((c): c is MapContact => Boolean(c))
        .sort((a, b) => a.name.localeCompare(b.name));
      setStack({
        key: cluster.key,
        longitude: cluster.longitude,
        latitude: cluster.latitude,
        contacts: listed.slice(0, STACK_LIMIT),
        total: cluster.count,
        padding: room(),
      });
    },
    [map, byId, peopleOf, setCard, room, focusNearest],
  );

  // The cluster's people for its preview, the ones with the most history first.
  const clusterMembers = useMemo(() => {
    if (card?.kind !== "cluster") return [];
    return (peopleOf(card.cluster)?.ids ?? [])
      .map((id) => byId.get(id))
      .filter((c): c is MapContact => Boolean(c))
      .sort(
        (a, b) =>
          (b.interactionCount ?? 0) - (a.interactionCount ?? 0) ||
          a.name.localeCompare(b.name),
      );
  }, [card, peopleOf, byId]);

  // The open contact's pin wears a halo, and so do a card's and a list row's.
  // While the open contact is on the map, the other pins step back.
  const cardOwner = card?.kind === "contact" ? card.id : null;
  const dimming = selectedId !== null && byId.has(selectedId);

  return (
    <div
      ref={wrapperRef}
      role="region"
      aria-label={label}
      data-map-ready={ready ? "true" : "false"}
      className="contact-map relative w-full h-full overflow-hidden bg-surface-container-low"
    >
      {loading && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-surface-container-lowest px-4 py-2 text-sm font-semibold text-on-surface-variant shadow-md">
          Loading contacts…
        </p>
      )}
      {showBasemapError && (
        <p
          role="status"
          className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-medium text-on-surface shadow-md"
        >
          The basemap did not load. Pins still work
        </p>
      )}
      {hoverCard && (
        <LiveStatus
          label="Map card"
          message={
            card?.kind === "contact" && card.mode === "focus" && cardContact
              ? [cardContact.name, cardContact.company, cardContact.location]
                  .filter(Boolean)
                  .join(". ")
              : ""
          }
        />
      )}
      {/* Born only once the wrapper is measured, at the right zoom. */}
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
          onStyleData={(event) => {
            // This event carries the attributions that open the strip, so
            // the chrome is right before `onLoad` reveals it.
            collapseAttribution(event.target.getContainer());
            setStyledMap(event.target);
          }}
          onLoad={(event) => {
            const loaded = event.target;
            collapseAttribution(loaded.getContainer());
            if (interactive) disableRotation(loaded);
            setMap(loaded);
            setReady(true);
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
          >
            <Layer {...PRESENCE_LAYER} />
          </Source>
          {heat && (
            <Source id={HEAT_SOURCE_ID} type="geojson" data={collection}>
              <Layer
                id={HEAT_LAYER_ID}
                type="heatmap"
                maxzoom={HEAT_END_ZOOM}
                paint={heat}
              />
            </Source>
          )}
          {interactive && (
            <NavigationControl position="bottom-right" showCompass={false} />
          )}
          {/* Pins wait until the heat fades, or Heat looks like Pins. */}
          {drawPins &&
            features.map((feature) => {
              if (feature.kind === "cluster") {
                const known = peopleOf(feature);
                const leaves = known?.ids ?? [];
                const selectedInCluster = selectedIds
                  ? leaves.filter((id) => selectedIds.has(id)).length
                  : 0;
                const halo = [selectedId, cardOwner, highlightedId].some(
                  (id) => id !== null && leaves.includes(id),
                );

                return (
                  <ClusterMarker
                    key={feature.key}
                    cluster={feature}
                    selectedCount={selectedInCluster}
                    onExpand={expandCluster}
                    onCard={hoverCard ? onCluster : undefined}
                    described={
                      card?.kind === "cluster" &&
                      card.cluster.key === feature.key
                    }
                    stacked={known?.stack}
                    overdue={leaves.filter((id) => overdueIds.has(id)).length}
                    halo={halo}
                    dimmed={
                      dimming && !!known && !halo && selectedInCluster === 0
                    }
                  />
                );
              }
              const contact = byId.get(feature.id);
              if (!contact) return null;
              const multi = selectedIds?.has(contact.id) ?? false;
              const marked =
                contact.id === cardOwner || contact.id === highlightedId;
              return (
                <ContactMarker
                  key={feature.key}
                  contact={contact}
                  selected={contact.id === selectedId}
                  multiSelected={multi}
                  marked={marked}
                  dimmed={
                    dimming && contact.id !== selectedId && !marked && !multi
                  }
                  onSelect={select}
                  onCard={onPin}
                  described={
                    card?.kind === "contact" &&
                    card.mode === "focus" &&
                    card.id === contact.id
                  }
                />
              );
            })}
          {stack && (
            <StackPopup
              stack={stack}
              selectedId={selectedId}
              onSelect={onSelect}
              onClose={() => setStack(null)}
            />
          )}
          {card?.kind === "contact" && card.mode !== "sheet" && cardContact && (
            <MapHoverCard
              key={card.id}
              contact={cardContact}
              mode={card.mode}
              padding={card.padding}
              onAction={runAction}
              onPointerEnter={() => onCardPointer(true)}
              onPointerLeave={() => onCardPointer(false)}
            />
          )}
          {card?.kind === "cluster" && (
            <ClusterPreview
              key={card.cluster.key}
              cluster={card.cluster}
              members={clusterMembers}
              stacked={peopleOf(card.cluster)?.stack ?? false}
              padding={card.padding}
            />
          )}
          {children}
        </MapGL>
      )}
      {!drawPins && map && <HeatReadoutLabel map={map} contacts={contacts} />}
      {card?.kind === "contact" && card.mode === "sheet" && cardContact && (
        <MapPeekSheet
          contact={cardContact}
          onAction={runAction}
          onClose={handleCloseCard}
        />
      )}
    </div>
  );
};

/** "About N people here" by a pointer over the heat, toward the map's middle. */
function HeatReadoutLabel({
  map,
  contacts,
}: {
  map: MapLibreMap;
  contacts: MapContact[];
}) {
  const readout = useHeatReadout(map, contacts);
  if (!readout) return null;
  const { count, x, y } = readout;
  const { clientWidth, clientHeight } = map.getContainer();
  const side = (at: number, size: number) =>
    at > size / 2 ? "calc(-100% - 12px)" : "12px";
  return (
    <p
      aria-hidden="true"
      style={{
        left: x,
        top: y,
        translate: `${side(x, clientWidth)} ${side(y, clientHeight)}`,
      }}
      className="pointer-events-none absolute z-[3] whitespace-nowrap rounded-lg bg-surface-container-lowest px-2.5 py-1 text-xs font-semibold text-on-surface shadow-md"
    >
      About {count} {count === 1 ? "person" : "people"} here
    </p>
  );
}

/**
 * Keep the world covering the container on resize. Every call is idempotent
 * and not animated, so the ResizeObserver callback on observe changes nothing.
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

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
  /** A card's button other than Open, which opens the contact. */
  onCardAction?: (action: Exclude<CardAction, "open">, id: string) => void;
  /** The contact a list row points at, whose pin stands out. */
  highlightedId?: string | null;
  /** Show this contact's card, pinned. Each new object asks again. */
  cardRequest?: { id: string } | null;
  layer?: MapLayer;
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
  onCardAction,
  highlightedId = null,
  cardRequest = null,
  layer = "pins",
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
  const remember = useCallback((event: ViewStateChangeEvent) => {
    writeLastView(event.viewState);
  }, []);

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

  // The heat, in the accent as the page paints it, scaled to the contacts
  // shown (see `heat.ts`). Its pins come back as it fades.
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
   * MapLibre's own chrome is hidden until the map has loaded.
   *
   * The attribution control is born expanded: the moment the style's
   * attributions arrive, MapLibre puts the full "OpenFreeMap,
   * OpenStreetMap contributors" strip across the map and leaves it there
   * until something collapses it. This map collapses it on load, so the
   * strip used to flash over the picture on every map that opened, which
   * on the contact page meant every time a reader moved to another person.
   *
   * A class cannot tell the two states apart: the strip a reader opens
   * carries the same one MapLibre opens it with. So the chrome is hidden by
   * CSS for the one moment it is wrong, from creation until load, and the
   * collapse below decides what it looks like when it appears. The credit
   * the basemap's terms require is then where MapLibre puts it, behind the
   * "i" button, from the first frame anybody sees.
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
   * The map as soon as its style has arrived, before it has loaded.
   *
   * MapLibre's `load` waits for every basemap tile and font. On a first
   * visit over a slow link that took seconds, and the pins waited for all of
   * it. The pins need only the contacts source, which the map holds once the
   * style is in, so they are read from this map and appear while the
   * basemap is still painting in.
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
  // A caller's card, pinned as Space pins it, or a sheet on a touch screen.
  // Each request asks once, so new contacts do not open it again.
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
   * Give the focus to a pin by its contact, quietly (no tooltip), or to the
   * map when no pin of theirs is drawn. The map keeps the arrow keys, so a
   * keyboard is never left on the page.
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

  // A contact that closes takes the focus away with its panel: Escape, its
  // close button or Back. The focus comes back to that contact's pin.
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
      // MapLibre reports a click on a pin or a card as a map click too, and
      // opening a contact must not also close it.
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
        // The cluster's button goes with the zoom. The focus waits on the
        // map, and a keyboard's moves on to the pin nearest the spot once
        // the split is drawn.
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
          onStyleData={(event) => {
            // The style's attributions are what opens the strip, and this
            // is the event that carries them. Collapsing here means the
            // chrome is already right when `onLoad` reveals it.
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
          {/* Over the heat the pins wait until it fades: drawn over the heat
              they stood for, Heat looked like Pins. */}
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

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
import { useMatch, useNavigate } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { BarChart3 } from "lucide-react";
import { useMapContacts } from "../../api";
import { usePageTitle } from "../../hooks/usePageTitle";
import { NAMES } from "../../lib/names";
import { ContactMap } from "./ContactMap";
import { flyToContact, prefersReducedMotion, settlePadding } from "./flyTo";
import { measureInsets, paddingFor, type Insets } from "./insets";
import { useMapFilter } from "./useMapFilter";
import { MapToolbar } from "./MapToolbar";
import { StatsStrip } from "./StatsStrip";
import { MapInsightsPane } from "./MapInsightsPane";
import { useMapStats } from "./useMapStats";
import { isTypingTarget } from "../../lib/keyboard";
import { useMediaQuery, WIDE_QUERY } from "../../hooks/useMediaQuery";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";
import { usePreferences } from "../../contexts/PreferencesContext";
import { isValidLatLng, type MapContact } from "../../../shared/geo";

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
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
  const { preferences, setPreference } = usePreferences();
  const isDesktopPaneOpen = preferences.mapPaneOpen ?? true;
  const isPaneOpen = isWide ? isDesktopPaneOpen : mobilePaneOpen;

  const { stats, inViewContacts } = useMapStats({
    contacts: filter.filteredContacts,
    map,
    totalCount: contacts.length,
  });

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
        inputRef={inputRef}
        onFitAll={handleFitAll}
        onToggleInsights={() => toggleInsightsPane(true)}
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
        onSelect={openContact}
        onMapClick={closeContact}
        onMapReady={setMap}
        initialPadding={initialInsets ? paddingFor(initialInsets) : undefined}
        rememberView
        reuse
      />
    </div>
  );
};

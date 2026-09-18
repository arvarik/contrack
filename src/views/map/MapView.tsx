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
  useRef,
  useState,
} from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMapContacts } from "../../api";
import { usePageTitle } from "../../hooks/usePageTitle";
import { NAMES } from "../../lib/names";
import { ContactMap } from "./ContactMap";
import { flyToContact, settlePadding } from "./flyTo";
import { measureInsets, paddingFor, type Insets } from "./insets";
import { useMapFilter } from "./useMapFilter";
import { MapToolbar } from "./MapToolbar";
import { isTypingTarget } from "../../lib/keyboard";
import { useSingleKeyShortcuts } from "../../hooks/useSingleKeyShortcuts";

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

  usePageTitle(NAMES.map.title);

  /**
   * What covers the map at mount, measured before the map exists.
   *
   * A layout effect runs after the page is in the document and before it is
   * painted, and a child's runs before its parent's. `ContactMap` measures
   * its size in one and renders the map only after, so the padding measured
   * here reaches the map as a creation prop, and the map's first frame is
   * centred in the open part of the page. On a phone that part ends at the
   * tab bar.
   */
  const [initialInsets, setInitialInsets] = useState<Insets | null>(null);
  useLayoutEffect(() => {
    if (pageRef.current) {
      setInitialInsets(
        measureInsets(pageRef.current, { contactOpen: openId !== null }),
      );
    }
    // Once, by design. The effects below own every later change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Fly to the contact the URL names, into the part of the map nothing
   * covers.
   *
   * After the map's load event, never at mount: the view a map is born with
   * is a creation prop (see `ContactMap.tsx`), and an animation started
   * before the map has a style leaves the pins in the ocean. The effect
   * therefore waits for the map, which arrives through `onMapReady`.
   *
   * The open contact covers the right of the map on a wide screen, and a pin
   * centred in the whole map would sit under it. So the covers are measured
   * each time and go with the move as padding, and the pin lands in the open
   * part. With no contact open the same effect eases the padding back, so a
   * closing contact hands its pin to the centre of the whole map.
   */
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
  }, [map, openId, openLat, openLng]);

  /**
   * The covers change with the window: the contact is narrower at the
   * tablet width than on a desktop, and a turned phone has another bar. A
   * resize measures again and sets the padding without an animation, the
   * way the map already answers a resize.
   */
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
  }, [map, openId]);

  const openContact = useCallback(
    (id: string) => navigate(`/map/contact/${id}`),
    [navigate],
  );
  const closeContact = useCallback(() => {
    if (openId) navigate("/map");
  }, [navigate, openId]);

  /**
   * Escape closes the contact, like every other layer in the app.
   *
   * On the window, because the contact over the map is a region and not a
   * dialog, so nothing else is listening for it. Anything inside the contact
   * that answers Escape first stops the event or marks it handled, and a
   * dialog or a menu on top of the contact owns the key while it is open.
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
   * "/" focuses the filter input on this page.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        if (isTypingTarget(event)) return;
        if (!singleKeyShortcuts) return;
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [singleKeyShortcuts]);

  return (
    <div
      ref={pageRef}
      className="map-page w-full h-full relative bg-surface-container-lowest z-0"
    >
      {/* The page has no visible title, since the map is the page, but a
          screen reader user navigating by heading still needs to land here. */}
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
      />
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

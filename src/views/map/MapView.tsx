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
 * @module views/map/MapView
 */
import { useCallback, useEffect, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMapContacts } from "../../api";
import { usePageTitle } from "../../hooks/usePageTitle";
import { NAMES } from "../../lib/names";
import { ContactMap } from "./ContactMap";
import { flyToContact } from "./flyTo";

export const MapView = () => {
  const { data: contacts = [], isLoading } = useMapContacts();
  const navigate = useNavigate();
  const openMatch = useMatch("/map/contact/:id");
  const openId = openMatch?.params.id ?? null;
  const [map, setMap] = useState<MapLibreMap | null>(null);

  usePageTitle(NAMES.map.title);

  /**
   * Fly to the contact the URL names.
   *
   * After the map's load event, never at mount: the view a map is born with
   * is a creation prop (see `ContactMap.tsx`), and an animation started
   * before the map has a style leaves the pins in the ocean. The effect
   * therefore waits for the map, which arrives through `onMapReady`.
   *
   * A pin opened by a click is already on screen, and this puts the rest of
   * that person's city around it. A `/map/contact/:id` opened cold, from a
   * link or from the contact page, is the case that needs it: the world view
   * would otherwise show a pin somewhere the reader has to find.
   */
  const open = contacts.find((contact) => contact.id === openId) ?? null;
  const openLat = open?.lat ?? null;
  const openLng = open?.lng ?? null;
  useEffect(() => {
    if (!map || openLat === null || openLng === null) return;
    flyToContact(map, { longitude: openLng, latitude: openLat });
  }, [map, openId, openLat, openLng]);

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

  return (
    <div className="map-page w-full h-full relative bg-surface-container-lowest z-0">
      {/* The page has no visible title, since the map is the page, but a
          screen reader user navigating by heading still needs to land here. */}
      <h1 className="sr-only">{NAMES.map.label}</h1>
      <ContactMap
        contacts={contacts}
        loading={isLoading}
        selectedId={openId}
        onSelect={openContact}
        onMapClick={closeContact}
        onMapReady={setMap}
      />
    </div>
  );
};

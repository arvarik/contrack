/**
 * Where "Open in map" and "Show on map" go for one contact.
 *
 * Where the map and the contact fit side by side, the contact opens beside
 * the map. Below that, on a phone or a tablet, the contact would cover the
 * map, so the link opens the map with `state: { pin }`: the map flies to the
 * pin and opens its card.
 *
 * @module views/map/mapLink
 */
import { useMemo } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { SIDE_BY_SIDE_QUERY } from "./insets";

/** A route and the state the map reads from it. */
export interface MapLink {
  to: string;
  state?: { pin: string };
}

/** The map link for one contact on this screen. */
export function useMapLink(contactId: string): MapLink {
  const sideBySide = useMediaQuery(SIDE_BY_SIDE_QUERY);
  return useMemo(
    () =>
      sideBySide
        ? { to: `/map/contact/${contactId}` }
        : { to: "/map", state: { pin: contactId } },
    [sideBySide, contactId],
  );
}

/**
 * Where "Open in map" and "Show on map" go for one contact. Where the map and
 * the contact fit side by side, the contact opens beside the map. On a
 * narrower screen the contact would cover the map, so the link passes
 * `state: { pin }` and the map flies to the pin and opens its card.
 */
import { useMemo } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { SIDE_BY_SIDE_QUERY } from "./insets";

export interface MapLink {
  to: string;
  state?: { pin: string };
}

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

/**
 * LocationMiniMap — where one contact sits, on the contact page.
 *
 * A 160 px still map under the address list, with that person's pin on it,
 * and a caption row that leads to the map page or opens the pin for
 * adjustment. It answers a question the address text cannot: is this pin in
 * the right place? And when the answer is no, "Adjust pin" is the fix.
 *
 * The map costs about a megabyte, so it arrives only when there is a pin to
 * draw. {@link ContactMap} is loaded lazily, from the same chunk the map page
 * uses, and a contact with an address the geocoder has not placed yet gets
 * the caption alone and loads nothing. The dialog that moves the pin is
 * loaded the same way, the first time it opens.
 *
 * @module views/map/LocationMiniMap
 */
import { Suspense, lazy, useCallback, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router-dom";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Hand } from "lucide-react";
import {
  isValidLatLng,
  type GeoSource,
  type MapContact,
} from "../../../shared/geo";
import { Badge } from "../../components/ui/Badge";
import { InfoTip } from "../../components/ui/InfoTip";
import { CONTACT_ZOOM } from "./mapMath";

const ContactMap = lazy(() =>
  import("./ContactMap").then((m) => ({ default: m.ContactMap })),
);
const AdjustPinModal = lazy(() =>
  import("./AdjustPinModal").then((m) => ({ default: m.AdjustPinModal })),
);

/** What the mini map needs of a contact. The detail page has all of it. */
export interface MiniMapContact {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  geoSource?: GeoSource;
}

export interface LocationMiniMapProps {
  contact: MiniMapContact;
  /** True when the contact has at least one address, placed or not. */
  hasAddress: boolean;
}

/** One line of caption text and its actions. */
const CAPTION_ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs";

/**
 * A caption action is a 44 px tap box on a phone, and the text stays where
 * it is on a pointer.
 */
const CAPTION_ACTION =
  "inline-flex items-center min-h-[44px] sm:min-h-0 font-bold text-primary underline hover:text-on-surface transition-colors";

const MapSkeleton = () => (
  <div
    aria-hidden="true"
    className="w-full h-full bg-surface-container-low animate-pulse"
  />
);

export const LocationMiniMap = ({
  contact,
  hasAddress,
}: LocationMiniMapProps) => {
  const navigate = useNavigate();
  const placed = isValidLatLng(contact.lat, contact.lng);
  const mapHref = `/map/contact/${contact.id}`;
  const openInMap = useCallback(() => navigate(mapHref), [navigate, mapHref]);
  const [adjusting, setAdjusting] = useState(false);
  const openAdjust = useCallback(() => setAdjusting(true), []);
  const closeAdjust = useCallback(() => setAdjusting(false), []);

  /**
   * Close the attribution strip.
   *
   * MapLibre's compact attribution control opens itself when the map is
   * created. On a map this small the open strip covers the picture and the
   * pin. Closing it leaves the "i" button that opens it again, which is
   * what the compact control was built to do, and the credit OpenFreeMap
   * and OpenStreetMap ask for stays one tap away.
   */
  const collapseAttribution = useCallback((map: MapLibreMap) => {
    map
      .getContainer()
      .querySelector(".maplibregl-ctrl-attrib")
      ?.classList.remove("maplibregl-compact-show");
  }, []);
  // This same contact, open over the map page. The map behind the panel
  // already holds the pin, at a size a reader can use, so a second map of
  // the same place is a second WebGL canvas and a second pin with the same
  // name. The picture stands down there, and so does "Open in map". The
  // actions stay: a wrong pin is most visible from the map, and that is
  // where "Adjust pin" has to be one click away.
  const overTheMap = useMatch("/map/contact/:id") !== null;

  // Nothing to show and nothing to explain: no address, no pin, no block.
  if (!placed && !hasAddress) return null;

  // The dialog is mounted only once asked for, so its chunk loads then and
  // a closed dialog costs nothing on every contact page.
  const dialog = adjusting && (
    <Suspense fallback={null}>
      <AdjustPinModal contact={contact} isOpen onClose={closeAdjust} />
    </Suspense>
  );

  if (!placed) {
    return (
      <div className={CAPTION_ROW}>
        <span className="text-on-surface-variant font-medium italic">
          Not on the map yet
        </span>
        <button type="button" onClick={openAdjust} className={CAPTION_ACTION}>
          Set location
        </button>
        {dialog}
      </div>
    );
  }

  const pin: MapContact = {
    id: contact.id,
    name: contact.name,
    company: contact.company,
    avatarUrl: contact.avatarUrl,
    location: contact.location,
    lat: contact.lat as number,
    lng: contact.lng as number,
  };

  return (
    <div className="flex flex-col gap-2">
      {!overTheMap && (
        <div className="h-40 w-full overflow-hidden rounded-2xl border border-surface-container-highest">
          <Suspense fallback={<MapSkeleton />}>
            <ContactMap
              contacts={[pin]}
              onSelect={openInMap}
              label="Location map"
              onMapReady={collapseAttribution}
              interactive={false}
              hoverCard={false}
              minZoomFromViewport={false}
              initialView={{
                longitude: pin.lng,
                latitude: pin.lat,
                zoom: CONTACT_ZOOM,
              }}
            />
          </Suspense>
        </div>
      )}
      <div className={CAPTION_ROW}>
        {!overTheMap && (
          <Link to={mapHref} className={CAPTION_ACTION}>
            Open in map
          </Link>
        )}
        <button type="button" onClick={openAdjust} className={CAPTION_ACTION}>
          Adjust pin
        </button>
        {contact.geoSource === "manual" && (
          <span className="inline-flex items-center gap-1">
            <Badge icon={<Hand className="w-3 h-3" aria-hidden="true" />}>
              Placed by hand
            </Badge>
            <InfoTip label="About Placed by hand">
              A person put this pin here, so the geocoder will not move it. It
              reads the address again only when the address changes, or when you
              choose "Use address again" under Adjust pin.
            </InfoTip>
          </span>
        )}
        {dialog}
      </div>
    </div>
  );
};

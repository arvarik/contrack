/**
 * A 160 px still map of one contact's pin on the contact page, with "Open in
 * map" and "Adjust pin" under it.
 *
 * The map costs about a megabyte, so {@link ContactMap} and the adjust dialog
 * load lazily, and a contact with no placed pin loads neither.
 *
 * 1. **It waits.** Each map is a new WebGL canvas, style and tile set, so it
 *    is built only once the same pin holds for {@link SETTLE_MS}. Arrowing
 *    through the list builds none.
 * 2. **It arrives once.** The placeholder holds until the map loads, then
 *    the map fades up through it.
 */
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
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
import { cn } from "../../lib/utils";
import { CONTACT_ZOOM } from "./mapMath";
import { useMapLink } from "./mapLink";

const ContactMap = lazy(() =>
  import("./ContactMap").then((m) => ({ default: m.ContactMap })),
);
const AdjustPinModal = lazy(() =>
  import("./AdjustPinModal").then((m) => ({ default: m.AdjustPinModal })),
);

/** What the mini map needs of a contact. */
export interface MiniMapContact {
  id: string;
  name: string;
  company: string | null;
  avatarUrl: string | null;
  location: string | null;
  /** Carried so the one pin reads the same as the pin on the whole map. */
  isTracked: boolean;
  lat: number | null;
  lng: number | null;
  geoSource?: GeoSource;
}

interface LocationMiniMapProps {
  contact: MiniMapContact;
  /** True when the contact has at least one address, placed or not. */
  hasAddress: boolean;
}

const CAPTION_ROW = "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs";

/** A 44 px tap box on a phone, plain text with a fine pointer. */
const CAPTION_ACTION =
  "inline-flex items-center min-h-[44px] sm:pointer-fine:min-h-0 font-bold text-primary underline hover:text-on-surface transition-colors";

/**
 * How long one pin must hold still before its map is built, in ms: long
 * enough that arrowing down the list builds nothing, short enough to go
 * unnoticed.
 */
export const SETTLE_MS = 250;

/** The frame under the map. It does not pulse, to keep list stepping calm. */
const MapSkeleton = () => (
  <div aria-hidden="true" className="w-full h-full bg-surface-container-low" />
);

export const LocationMiniMap = ({
  contact,
  hasAddress,
}: LocationMiniMapProps) => {
  const navigate = useNavigate();
  const placed = isValidLatLng(contact.lat, contact.lng);
  // Beside the map where both fit, else the pin and its card on the map.
  const mapLink = useMapLink(contact.id);
  const openInMap = useCallback(
    () => navigate(mapLink.to, { state: mapLink.state }),
    [navigate, mapLink],
  );
  const [adjusting, setAdjusting] = useState(false);
  const openAdjust = useCallback(() => setAdjusting(true), []);
  const closeAdjust = useCallback(() => setAdjusting(false), []);

  // The place keys the wait: a new person or a moved pin restarts it.
  const place = placed ? `${contact.lat},${contact.lng}` : null;
  const [settled, setSettled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!place) return;
    setSettled(false);
    setLoaded(false);
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [place]);

  const onMapReady = useCallback((_map: MapLibreMap) => setLoaded(true), []);
  // Over the map page, the map behind already shows the pin, so the mini map
  // and "Open in map" hide. "Adjust pin" stays, since a wrong pin shows there.
  const overTheMap = useMatch("/map/contact/:id") !== null;

  if (!placed && !hasAddress) return null;

  // Mounted only when open, so its chunk loads on first use.
  const dialog = adjusting && (
    <Suspense fallback={null}>
      <AdjustPinModal
        contact={contact}
        hasAddress={hasAddress}
        isOpen
        onClose={closeAdjust}
      />
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
    isTracked: contact.isTracked,
    lat: contact.lat as number,
    lng: contact.lng as number,
  };

  return (
    <div className="flex flex-col gap-2">
      {!overTheMap && (
        <div className="relative h-40 w-full overflow-hidden rounded-2xl border border-surface-container-highest">
          {/* The map fades up over this, so the frame never blinks. */}
          <MapSkeleton />
          {settled && (
            <div
              className={cn(
                "absolute inset-0 transition-opacity duration-(--dur-slow) motion-reduce:transition-none",
                loaded ? "opacity-100" : "opacity-0",
              )}
            >
              <Suspense fallback={null}>
                <ContactMap
                  contacts={[pin]}
                  onSelect={openInMap}
                  label="Location map"
                  onMapReady={onMapReady}
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
        </div>
      )}
      <div className={CAPTION_ROW}>
        {!overTheMap && (
          <Link
            to={mapLink.to}
            state={mapLink.state}
            className={CAPTION_ACTION}
          >
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
              choose "Use address again" under Adjust pin
            </InfoTip>
          </span>
        )}
        {dialog}
      </div>
    </div>
  );
};

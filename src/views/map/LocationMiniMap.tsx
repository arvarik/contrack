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
 * Two rules keep it calm while a reader moves down the list.
 *
 * 1. **It waits.** A contact page is built fresh for each person, so a map
 *    here is a new WebGL canvas, a new style to parse and a new set of tiles
 *    to fetch, every time. Somebody stepping through the list with the arrow
 *    keys was paying all of that for each person they passed, and throwing
 *    it away a keystroke later. So the map is created only once the same pin
 *    has been on screen for {@link SETTLE_MS}. Pass through a person and no
 *    map is ever built.
 * 2. **It arrives once.** The placeholder holds until the map reports that
 *    it has loaded, and then the map fades up through it. Nothing in between
 *    is shown: not the empty canvas, not the tiles painting in.
 *
 * @module views/map/LocationMiniMap
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
  /** Carried so the one pin reads the same as the pin on the whole map. */
  isTracked: boolean;
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

/**
 * How long one pin must hold still before its map is built, in ms.
 *
 * Long enough that arrowing down the list builds nothing, short enough that
 * a reader who stops on somebody does not notice the wait. The placeholder
 * is on screen throughout either way.
 */
export const SETTLE_MS = 250;

/**
 * What fills the frame until the map has loaded, and under it after that.
 *
 * It does not pulse. A pulse says "this is coming", which is true for about
 * a second and then says it again on the next contact, and the eye follows
 * every one. A still panel says the same thing once.
 */
const MapSkeleton = () => (
  <div aria-hidden="true" className="w-full h-full bg-surface-container-low" />
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

  // Whether the pin has held still long enough to be worth a map, and
  // whether that map has finished loading. The place is the key: a reader
  // who steps to the next person restarts the wait, and one who edits this
  // contact's address moves the pin and starts it again.
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
    isTracked: contact.isTracked,
    lat: contact.lat as number,
    lng: contact.lng as number,
  };

  return (
    <div className="flex flex-col gap-2">
      {!overTheMap && (
        <div className="relative h-40 w-full overflow-hidden rounded-2xl border border-surface-container-highest">
          {/*
            The placeholder is the floor of this box, not a stand-in that is
            swapped out. The map is laid over it and fades up once it has
            loaded, so the frame holds one steady colour from the first
            frame to the last and never blinks between two of them.
          */}
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

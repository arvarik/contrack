/**
 * Moves a contact's pin by hand when the geocoder placed it wrong: drag it,
 * click a spot, nudge it with the arrow keys, or find a place by name. The
 * server marks the row `geoSource = 'manual'`, and the geocoder then leaves
 * it alone. "Use address again" hands the pin back.
 *
 * The map is {@link ContactMap} with no contacts, and the pin is this
 * dialog's own draggable marker, because clustered pins cannot be dragged.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Marker, type MarkerDragEvent } from "@vis.gl/react-maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isValidLatLng } from "../../../shared/geo";
import { useContact, useSetContactLocation } from "../../api";
import { searchPlace } from "../../api/geo";
import { Modal } from "../../components/ui/Modal";
import { FORM_INPUT } from "../../lib/styles";
import { cn, errorText } from "../../lib/utils";
import { ContactMap } from "./ContactMap";
import { contactPinLabel, pinAvatarSrc } from "./ContactMarker";
import { flyToContact } from "./flyTo";
import type { MiniMapContact } from "./LocationMiniMap";
import { CONTACT_ZOOM } from "./mapMath";
import { NO_AUTOCORRECT } from "../../components/ui/SearchField";

interface PinPosition {
  latitude: number;
  longitude: number;
}

/** Pixels one arrow key moves the pin, and with Shift. */
const NUDGE_PX = 10;
const NUDGE_SHIFT_PX = 50;

function formatPin(pin: PinPosition): string {
  return `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`;
}

/** The pixel offset an arrow key asks for, or null for any other key. */
function nudgeFor(
  key: string,
  shift: boolean,
): { dx: number; dy: number } | null {
  const step = shift ? NUDGE_SHIFT_PX : NUDGE_PX;
  switch (key) {
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    default:
      return null;
  }
}

const noSelect = () => {};

interface AdjustPinModalProps {
  contact: MiniMapContact;
  /** True when the contact has address text. Left out, the dialog reads it. */
  hasAddress?: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export const AdjustPinModal = ({
  contact,
  hasAddress: known,
  isOpen,
  onClose,
}: AdjustPinModalProps) => {
  // The map's rows carry no address rows, so the contact itself is read.
  const { data: detail } = useContact(
    known === undefined ? contact.id : undefined,
  );
  const hasAddress =
    known ??
    [detail?.location, ...(detail?.addresses ?? []).map((a) => a.address)].some(
      (text) => text?.trim(),
    );
  const placed = isValidLatLng(contact.lat, contact.lng);
  const start: PinPosition | null = placed
    ? { latitude: contact.lat as number, longitude: contact.lng as number }
    : null;

  // The pin being placed. Nothing is written until Save.
  const [pin, setPin] = useState<PinPosition | null>(start);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const hintId = useId();
  const save = useSetContactLocation();
  // With no pin, the search starts from the address the geocoder could not place.
  const [place, setPlace] = useState(placed ? "" : (contact.location ?? ""));
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);

  // A reopened dialog starts from the saved pin, not a canceled drag.
  useEffect(() => {
    if (isOpen) setPin(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contact.lat, contact.lng]);

  const moved =
    pin !== null &&
    (start === null ||
      pin.latitude !== start.latitude ||
      pin.longitude !== start.longitude);

  const moveTo = useCallback((at: PinPosition) => setPin(at), []);

  const onDragEnd = useCallback(
    (event: MarkerDragEvent) =>
      setPin({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }),
    [],
  );

  /**
   * A nudge is in screen pixels, so it is the same size at every zoom. The
   * key stops here, or the map's keyboard handler pans the map too.
   */
  const onPinKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!map || !pin) return;
      const nudge = nudgeFor(event.key, event.shiftKey);
      if (!nudge) return;
      event.preventDefault();
      event.stopPropagation();
      const point = map.project([pin.longitude, pin.latitude]);
      const next = map.unproject([point.x + nudge.dx, point.y + nudge.dy]);
      setPin({ latitude: next.lat, longitude: next.lng });
    },
    [map, pin],
  );

  const busy = save.isPending;

  // `mutate`: a failed save is the mutation's toast, not a rejection.
  const onSave = () => {
    if (!pin || !moved || busy) return;
    save.mutate(
      { id: contact.id, data: { lat: pin.latitude, lng: pin.longitude } },
      {
        onSuccess: () => {
          toast.success("Pin saved");
          onClose();
        },
      },
    );
  };

  const onRegeocode = () => {
    if (busy) return;
    save.mutate(
      { id: contact.id, data: { regeocode: true } },
      {
        onSuccess: () => {
          toast.success("The geocoder will place the pin from the address");
          onClose();
        },
      },
    );
  };

  /** Move the pin and the map to a place found by name. Save still writes it. */
  const onFind = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (finding || place.trim().length < 2) return;
    setFinding(true);
    setFindError(null);
    try {
      const found = await searchPlace(place);
      setPin({ latitude: found.lat, longitude: found.lng });
      if (map) flyToContact(map, { longitude: found.lng, latitude: found.lat });
    } catch (error) {
      setFindError(errorText(error));
    } finally {
      setFinding(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={placed ? "Adjust pin" : "Set location"}
      size="lg"
    >
      <div className="space-y-4">
        <p id={hintId} className="text-sm text-on-surface-variant text-pretty">
          {pin
            ? "Move the pin, or choose a spot on the map"
            : "Choose a spot on the map to place the pin"}
          {pin && (
            <span className="hidden pointer-fine:inline">
              . The arrow keys move it too
            </span>
          )}
        </p>
        <form
          role="search"
          aria-label="Place search"
          onSubmit={onFind}
          className="flex gap-2"
        >
          <input
            type="search"
            value={place}
            onChange={(event) => {
              setPlace(event.target.value);
              setFindError(null);
            }}
            placeholder="Find a place, for example Lisbon"
            aria-label="Find a place"
            {...NO_AUTOCORRECT}
            maxLength={120}
            className={cn(FORM_INPUT, "min-w-0")}
          />
          <button
            type="submit"
            disabled={finding || place.trim().length < 2}
            className="btn-secondary shrink-0"
          >
            {finding && <Loader2 className="w-4 h-4 animate-spin" />}
            Find
          </button>
        </form>
        {findError && (
          <p role="alert" className="text-sm text-error">
            {findError}
          </p>
        )}
        <div className="h-[480px] max-h-[50dvh] w-full overflow-hidden rounded-2xl border border-surface-container-highest">
          <ContactMap
            contacts={[]}
            onSelect={noSelect}
            onMapClick={moveTo}
            onMapReady={setMap}
            label="Pin map"
            hoverCard={false}
            initialView={
              start
                ? {
                    longitude: start.longitude,
                    latitude: start.latitude,
                    zoom: CONTACT_ZOOM,
                  }
                : undefined
            }
          >
            {pin && (
              <Marker
                longitude={pin.longitude}
                latitude={pin.latitude}
                anchor="center"
                draggable
                onDragEnd={onDragEnd}
              >
                <button
                  type="button"
                  aria-label={contactPinLabel(contact)}
                  aria-describedby={hintId}
                  onKeyDown={onPinKeyDown}
                  // MapLibre prevents the press default for the drag, so the
                  // button takes focus here, ready for the arrow keys.
                  onPointerDown={(event) =>
                    event.currentTarget.focus({ preventScroll: true })
                  }
                  className="block w-12 h-12 rounded-full overflow-hidden cursor-grab active:cursor-grabbing bg-surface-container-lowest shadow-md ring-[3px] ring-primary"
                >
                  <img
                    src={pinAvatarSrc(contact)}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover"
                  />
                </button>
              </Marker>
            )}
          </ContactMap>
        </div>
        {/* An <output> is a live region, so each move is read aloud. */}
        <output
          aria-label="Pin coordinates"
          className="block text-xs font-mono text-on-surface-variant"
        >
          {pin ? formatPin(pin) : "No pin on the map yet"}
        </output>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          {placed && hasAddress && (
            <button
              type="button"
              onClick={onRegeocode}
              disabled={busy}
              className="btn-secondary sm:mr-auto"
            >
              Use address again
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !moved}
            className="btn-primary"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
};

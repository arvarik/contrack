/**
 * AdjustPinModal — put a contact's pin where it belongs, by hand.
 *
 * The geocoder reads an address and places a pin, and sometimes it reads
 * wrong: the other Springfield, the office instead of the house, a street
 * that two cities share. This dialog is the zero-API fix. A person drags the
 * pin, or clicks the map, or nudges the pin with the arrow keys, and saves.
 * The server marks the row `geoSource = 'manual'` and the geocoder leaves it
 * alone from then on. "Use address again" hands the pin back.
 *
 * The map inside is {@link ContactMap} with no contacts: the one pin here is
 * a draggable marker of this dialog's own, because a pin the map clusters
 * and a pin a person drags are two different things.
 *
 * @module views/map/AdjustPinModal
 */
import { useCallback, useEffect, useId, useState } from "react";
import { Marker, type MarkerDragEvent } from "react-map-gl/maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isValidLatLng } from "../../../shared/geo";
import { useSetContactLocation } from "../../api";
import { Modal } from "../../components/ui/Modal";
import { ContactMap } from "./ContactMap";
import { contactPinLabel, pinAvatarSrc } from "./ContactMarker";
import type { MiniMapContact } from "./LocationMiniMap";
import { CONTACT_ZOOM } from "./mapMath";

/** Where a pin is, or is about to be. */
export interface PinPosition {
  latitude: number;
  longitude: number;
}

/** One arrow key moves the pin this many pixels. Shift makes it five times. */
export const NUDGE_PX = 10;
export const NUDGE_SHIFT_PX = 50;

/** The pin, as text a person can read back or paste elsewhere. */
export function formatPin(pin: PinPosition): string {
  return `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`;
}

/** The pixel offset an arrow key asks for, or null for any other key. */
export function nudgeFor(
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

export interface AdjustPinModalProps {
  contact: MiniMapContact;
  isOpen: boolean;
  onClose: () => void;
}

export const AdjustPinModal = ({
  contact,
  isOpen,
  onClose,
}: AdjustPinModalProps) => {
  const placed = isValidLatLng(contact.lat, contact.lng);
  const start: PinPosition | null = placed
    ? { latitude: contact.lat as number, longitude: contact.lng as number }
    : null;

  // The pin being placed. Nothing is written until Save.
  const [pin, setPin] = useState<PinPosition | null>(start);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const hintId = useId();
  const save = useSetContactLocation();

  // A reopened dialog starts from the pin as it is now, not from the last
  // drag that was cancelled.
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
   * Arrow keys move the pin by pixels on the screen, so a nudge is the same
   * size at every zoom. The key is stopped here, because the map's own
   * keyboard handler sits above the marker and would pan the map as well.
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

  const onSave = async () => {
    if (!pin || !moved || busy) return;
    await save.mutateAsync({
      id: contact.id,
      data: { lat: pin.latitude, lng: pin.longitude },
    });
    toast.success("Pin saved");
    onClose();
  };

  const onRegeocode = async () => {
    if (busy) return;
    await save.mutateAsync({ id: contact.id, data: { regeocode: true } });
    toast.success("The geocoder will place the pin from the address");
    onClose();
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
            ? "Drag the pin, tap or click the map, or move the pin with the arrow keys."
            : "Tap or click the map to place the pin."}
        </p>
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
                  // MapLibre claims the pointer press for the drag and stops
                  // its default, which is where a button would have taken
                  // focus. Taken here instead, so a dragged pin can be
                  // fine-tuned with the arrow keys straight after.
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
        {/* An <output> is a live region by default, so a nudge or a drag reads
            its new coordinates back without a second element for the job. */}
        <output
          aria-label="Pin coordinates"
          className="block text-xs font-mono text-on-surface-variant"
        >
          {pin ? formatPin(pin) : "No pin on the map yet"}
        </output>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          {placed && (
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

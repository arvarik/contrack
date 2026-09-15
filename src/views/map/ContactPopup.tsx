/**
 * The cards that open over the map.
 *
 * `ContactPopup` is the hover card over a pin: name, company and the location
 * that placed it. A contact with several addresses is pinned by one of them,
 * and the card says which before anyone navigates. It opens on hover and
 * focus of a pin and closes on leave and blur.
 *
 * `StackPopup` lists the people in a cluster that zooming cannot split. The
 * geocoder gives everyone with the same city the same point, so past the
 * cluster zoom their pins would sit on top of each other and only the top one
 * could be clicked. The list gives each of them a button.
 *
 * Both use the app's type and colour tokens. MapLibre's popup frame takes its
 * colours from `src/index.css`.
 *
 * @module views/map/ContactPopup
 */
import { useEffect } from "react";
import { Popup } from "react-map-gl/maplibre";
import { MapPin } from "lucide-react";
import type { MapContact } from "../../../shared/geo";
import { contactPinLabel } from "./ContactMarker";

/** Half the 48 px pin plus a gap, so the card clears the ring. */
const PIN_CLEARANCE = 30;

export const ContactPopup = ({ contact }: { contact: MapContact }) => (
  <Popup
    longitude={contact.lng}
    latitude={contact.lat}
    anchor="bottom"
    offset={PIN_CLEARANCE}
    closeButton={false}
    closeOnClick={false}
    focusAfterOpen={false}
    maxWidth="260px"
    className="contact-popup"
  >
    <div className="font-body px-1 py-0.5">
      <p className="text-sm font-extrabold text-on-surface">{contact.name}</p>
      {contact.company && (
        <p className="text-xs text-on-surface-variant">{contact.company}</p>
      )}
      {contact.location && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-primary">
          <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
          {contact.location}
        </p>
      )}
    </div>
  </Popup>
);

export interface ContactStack {
  clusterId: number;
  longitude: number;
  latitude: number;
  /** Everyone in the cluster, up to {@link STACK_LIMIT}. */
  contacts: MapContact[];
  /** The cluster's full size, which can be more than the list holds. */
  total: number;
}

/** The most people one stack lists. The rest are counted, not listed. */
export const STACK_LIMIT = 50;

interface StackPopupProps {
  stack: ContactStack;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const StackPopup = ({ stack, onSelect, onClose }: StackPopupProps) => {
  const hidden = stack.total - stack.contacts.length;

  // Escape closes the list, wherever the focus is. On the window rather than
  // on the list, because the list is only what the pointer opened: the key
  // has to work before anything inside it has focus.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <Popup
      longitude={stack.longitude}
      latitude={stack.latitude}
      anchor="bottom"
      offset={PIN_CLEARANCE}
      closeButton={false}
      closeOnClick
      onClose={onClose}
      maxWidth="280px"
      className="contact-popup"
    >
      <div className="font-body">
        <p className="px-2 pt-1 pb-1 text-xs font-semibold text-on-surface-variant">
          {stack.total} people here
        </p>
        <ul
          className="max-h-64 overflow-y-auto"
          aria-label="People at this place"
        >
          {stack.contacts.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                onClick={() => onSelect(contact.id)}
                className="w-full min-h-[44px] px-2 rounded-lg text-left text-sm font-semibold text-on-surface hover:bg-surface-container-high"
              >
                {contactPinLabel(contact)}
              </button>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <p className="px-2 pt-1 text-xs text-on-surface-variant">
            Showing {stack.contacts.length} of {stack.total}.
          </p>
        )}
      </div>
    </Popup>
  );
};

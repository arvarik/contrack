/**
 * One contact on the map: a round avatar button.
 *
 * The pin is a React element inside a MapLibre `Marker`, not an HTML string,
 * so the avatar URL never passes through `innerHTML` and there is no inline
 * event handler attribute. It is a real `<button>`: focusable, named
 * "<name>, <company>", and opened with Enter like any other button.
 *
 * The hover card opens for a pointer that can hover, and for focus. A finger
 * cannot hover: a tap fires the same enter event a mouse does and never the
 * leave, so on a phone the card would open under the contact the tap opens
 * and still be there when the contact closes. A touch is told apart by its
 * pointer type and opens no card, and the focus some browsers give a tapped
 * button is not a request for one either: only focus that arrived without a
 * touch, from a keyboard, opens the card.
 *
 * @module views/map/ContactMarker
 */
import { memo, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { MapContact } from "../../../shared/geo";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { cn } from "../../lib/utils";

/** The pin's accessible name: the contact, and where they work when known. */
export function contactPinLabel(
  contact: Pick<MapContact, "name" | "company">,
): string {
  return contact.company ? `${contact.name}, ${contact.company}` : contact.name;
}

/**
 * Only http(s) URLs and same-origin paths are drawn as avatars. Anything
 * else (`javascript:`, `data:` and the like) gets the generated avatar.
 */
export function pinAvatarSrc(
  contact: Pick<MapContact, "name" | "avatarUrl">,
): string {
  const url = contact.avatarUrl;
  if (url) {
    if (url.startsWith("/") && !url.startsWith("//")) return url;
    try {
      const protocol = new URL(url).protocol;
      if (protocol === "http:" || protocol === "https:") return url;
    } catch {
      // Not a URL. The generated avatar stands in.
    }
  }
  return fallbackAvatarUrl(contact.name);
}

interface ContactMarkerProps {
  contact: MapContact;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Called with the contact id on hover and focus, and null on leave and blur. */
  onPreview: (id: string | null) => void;
}

export const ContactMarker = memo(function ContactMarker({
  contact,
  selected,
  onSelect,
  onPreview,
}: ContactMarkerProps) {
  const [broken, setBroken] = useState(false);
  const src = broken ? fallbackAvatarUrl(contact.name) : pinAvatarSrc(contact);
  // True between a touch on the pin and the focus that touch may bring.
  const touched = useRef(false);

  return (
    <Marker
      longitude={contact.lng}
      latitude={contact.lat}
      anchor="center"
      style={{ zIndex: selected ? 2 : 1 }}
    >
      <button
        type="button"
        aria-label={contactPinLabel(contact)}
        data-contact-id={contact.id}
        onClick={() => onSelect(contact.id)}
        onPointerDown={(event) => {
          touched.current = event.pointerType === "touch";
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onPreview(contact.id);
        }}
        onPointerLeave={() => onPreview(null)}
        onFocus={() => {
          if (!touched.current) onPreview(contact.id);
          touched.current = false;
        }}
        onBlur={() => onPreview(null)}
        className={cn(
          "block w-12 h-12 rounded-full overflow-hidden cursor-pointer",
          "bg-surface-container-lowest shadow-md ring-[3px] ring-primary",
          "transition-transform duration-200 hover:-translate-y-1",
          selected && "ring-4 -translate-y-1",
        )}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="w-full h-full object-cover"
        />
      </button>
    </Marker>
  );
});

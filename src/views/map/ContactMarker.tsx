/**
 * One contact on the map: a round avatar button.
 *
 * The pin is a React element inside a MapLibre `Marker`, not an HTML string,
 * so the avatar URL never passes through `innerHTML` and there is no inline
 * event handler attribute. It is a real `<button>`: focusable, named
 * "<name>, <company>", and opened with Enter like any other button.
 *
 * @module views/map/ContactMarker
 */
import { memo, useState } from "react";
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
        onMouseEnter={() => onPreview(contact.id)}
        onMouseLeave={() => onPreview(null)}
        onFocus={() => onPreview(contact.id)}
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

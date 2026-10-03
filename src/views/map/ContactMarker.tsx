/**
 * One contact on the map: a round avatar button.
 *
 * The pin is a React element inside a MapLibre `Marker`, not an HTML string,
 * so the avatar URL never passes through `innerHTML` and there is no inline
 * event handler attribute. It is a real `<button>`: focusable, named
 * "<name>, <company>", and opened with Enter like any other button.
 *
 * A mouse and the keyboard open its card here. A finger cannot hover, so its
 * first tap shows the card and the second opens the contact.
 *
 * @module views/map/ContactMarker
 */
import { memo, useRef, useState } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import type { MapContact } from "../../../shared/geo";
import { fallbackAvatarUrl } from "../../lib/avatar";
import { cn } from "../../lib/utils";
import { cardId } from "./MapHoverCard";

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

/** What a pin reports to the map's card. */
export type PinEvent = "enter" | "leave" | "focus" | "blur" | "space" | "tap";

interface ContactMarkerProps {
  contact: MapContact;
  selected: boolean;
  multiSelected?: boolean;
  onSelect: (id: string) => void;
  onCard: (id: string, event: PinEvent) => void;
  /** The pin's card is open as a tooltip, which then describes the pin. */
  described?: boolean;
}

export const ContactMarker = memo(function ContactMarker({
  contact,
  selected,
  multiSelected = false,
  onSelect,
  onCard,
  described = false,
}: ContactMarkerProps) {
  const [broken, setBroken] = useState(false);
  const src = broken ? fallbackAvatarUrl(contact.name) : pinAvatarSrc(contact);
  // The last press. A tap's focus and click are not a mouse's.
  const press = useRef<{ type: string; x: number; y: number } | null>(null);
  const { id } = contact;

  const isHighlighted = selected || multiSelected;

  return (
    <Marker
      longitude={contact.lng}
      latitude={contact.lat}
      anchor="center"
      style={{ zIndex: isHighlighted ? 2 : 1 }}
    >
      <button
        type="button"
        aria-label={contactPinLabel(contact)}
        aria-describedby={described ? cardId(id) : undefined}
        data-contact-id={id}
        onClick={() => {
          if (press.current?.type !== "touch") onSelect(id);
        }}
        onKeyDown={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            onCard(id, "space");
          } else if (event.key === "Enter") {
            event.preventDefault();
            onSelect(id);
          }
        }}
        onPointerDown={(event) => {
          press.current = {
            type: event.pointerType,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        // A tap, not a drag. Read here: MapLibre takes a quick second tap's
        // click for its double-tap zoom.
        onPointerUp={(event) => {
          const start = press.current;
          if (
            start?.type === "touch" &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10
          )
            onCard(id, "tap");
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onCard(id, "enter");
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch") onCard(id, "leave");
        }}
        onFocus={() => {
          if (press.current?.type !== "touch") onCard(id, "focus");
        }}
        onBlur={() => {
          press.current = null;
          onCard(id, "blur");
        }}
        className={cn(
          "block w-12 h-12 rounded-full overflow-hidden cursor-pointer",
          "bg-surface-container-lowest shadow-md",
          isHighlighted
            ? "ring-4 ring-primary -translate-y-1 shadow-lg"
            : "ring-[3px] ring-primary",
          // The lift on hover and on selection runs at the base duration.
          "transition-transform hover:-translate-y-1",
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

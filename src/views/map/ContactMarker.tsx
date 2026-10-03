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
import { memo, useId, useRef, useState } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import { isPastDay } from "../../../shared/dates";
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
  /** The open contact's pin, which wears the halo. */
  selected: boolean;
  multiSelected?: boolean;
  /** Its card is open, or a list row points at it: the halo too. */
  marked?: boolean;
  /** Another contact is open, so this pin steps back. */
  dimmed?: boolean;
  onSelect: (id: string) => void;
  onCard: (id: string, event: PinEvent) => void;
  /** The pin's card is open as a tooltip, which then describes the pin. */
  described?: boolean;
}

export const ContactMarker = memo(function ContactMarker({
  contact,
  selected,
  multiSelected = false,
  marked = false,
  dimmed = false,
  onSelect,
  onCard,
  described = false,
}: ContactMarkerProps) {
  const [broken, setBroken] = useState(false);
  const src = broken ? fallbackAvatarUrl(contact.name) : pinAvatarSrc(contact);
  // The last press. A tap's focus and click are not a mouse's.
  const press = useRef<{ type: string; x: number; y: number } | null>(null);
  const { id } = contact;
  // Overdue by the bottom line's rule: a red dot, and the pin's description.
  const overdue = isPastDay(contact.nextFollowUpAt);
  const overdueId = useId();

  const halo = selected || marked;
  const raised = halo || multiSelected;

  return (
    <Marker
      longitude={contact.lng}
      latitude={contact.lat}
      anchor="center"
      style={{ zIndex: raised ? 2 : 1 }}
    >
      <button
        type="button"
        aria-label={contactPinLabel(contact)}
        aria-describedby={
          [overdue && overdueId, described && cardId(id)]
            .filter(Boolean)
            .join(" ") || undefined
        }
        data-contact-id={id}
        data-halo={halo || undefined}
        data-dimmed={dimmed || undefined}
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
          "map-pin relative block w-12 h-12 rounded-full cursor-pointer",
          "bg-surface-container-lowest shadow-md",
          raised
            ? "ring-4 ring-primary -translate-y-1 shadow-lg"
            : "ring-[3px] ring-primary",
          // The lift and the dimming run at the base duration.
          "transition-[translate,opacity] hover:-translate-y-1",
        )}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          className="w-full h-full rounded-full object-cover"
        />
        {overdue && (
          <span
            id={overdueId}
            className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-error ring-2 ring-surface-container-lowest"
          >
            <span className="sr-only">Follow-up overdue</span>
          </span>
        )}
      </button>
    </Marker>
  );
});

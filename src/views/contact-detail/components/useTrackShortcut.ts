/**
 * useTrackShortcut: `t` tracks or untracks the open contact.
 *
 * The same flip as the header's Track button, toast and Undo included. It
 * listens only on the contact's own page (`/contact/:id`, and the contact
 * over the map), never inside the floating card on the Archived page. It
 * steps aside when focus is in a field, when a dialog is open, when the
 * single-key shortcuts are off, and for a ghost, which cannot be tracked.
 *
 * Registered in `src/lib/shortcuts.ts` under Contact.
 */
import { useEffect } from "react";
import { useMatch } from "react-router-dom";
import { isTypingTarget } from "../../../lib/keyboard";
import { useSingleKeyShortcuts } from "../../../hooks/useSingleKeyShortcuts";
import {
  useTrackToggle,
  type TrackableContact,
} from "../../../hooks/useTrackToggle";

export function useTrackShortcut(
  contact: (TrackableContact & { isGhost: boolean }) | undefined,
): void {
  const singleKeys = useSingleKeyShortcuts();
  const { toggle } = useTrackToggle();
  const onContactPage = useMatch("/contact/:id");
  const onMapContact = useMatch("/map/contact/:id");
  const onPage = Boolean(onContactPage || onMapContact);

  useEffect(() => {
    if (!contact || contact.isGhost || !onPage || !singleKeys) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.defaultPrevented || isTypingTarget(e)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      toggle(contact);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contact, onPage, singleKeys, toggle]);
}

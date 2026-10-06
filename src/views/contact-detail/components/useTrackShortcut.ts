/**
 * `t` tracks or untracks the open contact, like the header's Track button.
 * Only on the contact's own page (not the Archived page's floating card). It
 * steps aside for a field, an open dialog or menu, single-key shortcuts off,
 * and a ghost. Registered in `src/lib/shortcuts.ts` under Contact.
 */
import { useEffect } from "react";
import { useMatch } from "react-router-dom";
import { isPageKeyTaken } from "../../../lib/keyboard";
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
      if (e.key.toLowerCase() !== "t" || isPageKeyTaken(e)) return;
      e.preventDefault();
      toggle(contact);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contact, onPage, singleKeys, toggle]);
}

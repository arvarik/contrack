/**
 * useContactListKeyboard — Keyboard navigation for the contact list view.
 *
 * Handles `j/k/↑/↓` for contact navigation, `/` for search focus,
 * `n` for new contact modal, `v` for smart paste, `Enter` for composer focus,
 * and `Escape` to exit select mode.
 *
 * NOTE: This hook attaches a window-level keydown listener. It checks
 * `isTypingTarget()` to avoid capturing events while the user is typing
 * in an input, textarea, or contentEditable element.
 *
 * @param params.filteredContacts - Currently visible contacts for index-based nav.
 * @param params.currentId - The active contact ID from route params.
 * @param params.isSelectMode - Whether multi-select is active (for Escape handling).
 * @param params.exitSelectMode - Callback to leave multi-select.
 * @param params.navigate - React Router navigate function.
 * @param params.locationSearch - Current URL search string (preserved during nav).
 * @param params.onNewContact - Callback to open the create contact modal.
 * @param params.onSmartPaste - Callback to open the smart paste modal.
 */
import { useEffect } from "react";
import { isTypingTarget } from "../../../lib/keyboard";
import type { Contact } from "../../../types";

interface UseContactListKeyboardParams {
  filteredContacts: Contact[];
  currentId: string | undefined;
  isSelectMode: boolean;
  exitSelectMode: () => void;
  navigate: (path: string) => void;
  locationSearch: string;
  onNewContact: () => void;
  onSmartPaste: () => void;
}

export function useContactListKeyboard({
  filteredContacts,
  currentId,
  isSelectMode,
  exitSelectMode,
  navigate,
  locationSearch,
  onNewContact,
  onSmartPaste,
}: UseContactListKeyboardParams) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;

      if (e.key === "Escape" && isSelectMode) { exitSelectMode(); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) editor.focus();
        return;
      }
      if (e.key === "/") { e.preventDefault(); document.getElementById("search-input")?.focus(); return; }
      if (e.key === "n") { e.preventDefault(); onNewContact(); return; }
      if (e.key === "v") { e.preventDefault(); onSmartPaste(); return; }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(c => c.id === currentId);
        const nextIndex = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, filteredContacts.length - 1);
        navigate(`/contact/${filteredContacts[nextIndex].id}${locationSearch}`);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(c => c.id === currentId);
        const prevIndex = currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
        navigate(`/contact/${filteredContacts[prevIndex].id}${locationSearch}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentId, filteredContacts, navigate, isSelectMode, exitSelectMode, locationSearch, onNewContact, onSmartPaste]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (currentId) {
      const el = document.getElementById(`contact-row-${currentId}`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentId]);
}

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
 * The listener is attached once and reads the latest values from a ref
 * that is written in the same commit as the page. It used to be attached
 * again after every change, in an effect, which runs after the browser has
 * painted. A second ArrowDown pressed between the paint and that effect ran
 * the listener from before: it still had no open contact, so it opened the
 * first row, the one already open, and the step was lost.
 * `tests/e2e/keyboard.spec.ts` presses the arrows as fast as the page shows
 * the current row.
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
import { useEffect, useLayoutEffect, useRef } from "react";
import { isActivationTarget, isTypingTarget } from "../../../lib/keyboard";
import { useSingleKeyShortcuts } from "../../../hooks/useSingleKeyShortcuts";
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
  const singleKeys = useSingleKeyShortcuts();

  // The values the listener reads, written before the browser paints the
  // commit that changed them, so a key pressed as soon as the page shows a
  // change sees it.
  const latest = useRef({
    filteredContacts,
    currentId,
    isSelectMode,
    exitSelectMode,
    navigate,
    locationSearch,
    onNewContact,
    onSmartPaste,
    singleKeys,
  });
  useLayoutEffect(() => {
    latest.current = {
      filteredContacts,
      currentId,
      isSelectMode,
      exitSelectMode,
      navigate,
      locationSearch,
      onNewContact,
      onSmartPaste,
      singleKeys,
    };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        filteredContacts,
        currentId,
        isSelectMode,
        exitSelectMode,
        navigate,
        locationSearch,
        onNewContact,
        onSmartPaste,
        singleKeys,
      } = latest.current;
      if (isTypingTarget(e)) return;
      // A row or the letter rail already answered this key: the arrows
      // move focus inside the list, and a letter is type-ahead there.
      if (e.defaultPrevented) return;

      if (
        !singleKeys &&
        (e.key === "/" ||
          e.key === "n" ||
          e.key === "v" ||
          e.key === "j" ||
          e.key === "k")
      ) {
        return;
      }

      if (e.key === "Escape" && isSelectMode) {
        exitSelectMode();
        return;
      }
      if (e.key === "Enter") {
        // Enter on a focused link or button is that control's own press.
        // Only an Enter that would otherwise do nothing jumps to the
        // composer, which is what the shortcut was for.
        if (isActivationTarget()) return;
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) editor.focus();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        onNewContact();
        return;
      }
      if (e.key === "v") {
        e.preventDefault();
        onSmartPaste();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(
          (c) => c.id === currentId,
        );
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(currentIndex + 1, filteredContacts.length - 1);
        navigate(`/contact/${filteredContacts[nextIndex].id}${locationSearch}`);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        if (filteredContacts.length === 0) return;
        const currentIndex = filteredContacts.findIndex(
          (c) => c.id === currentId,
        );
        const prevIndex =
          currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
        navigate(`/contact/${filteredContacts[prevIndex].id}${locationSearch}`);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-scroll active item into view
  useEffect(() => {
    if (currentId) {
      const el = document.getElementById(`contact-row-${currentId}`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentId]);
}

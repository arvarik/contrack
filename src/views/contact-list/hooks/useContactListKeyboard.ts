/**
 * Page keys for the contact list: `j/k/↑/↓` step through contacts, `/` focuses
 * search, `n` opens New contact, `v` opens Add from text, `Enter` focuses the
 * composer and `Escape` leaves select mode. `isPageKeyTaken()` skips keys in a
 * field, with a modifier, or under a dialog or menu.
 *
 * The window listener is attached once and reads a ref written in a layout
 * effect. A listener re-attached in a plain effect lags a paint behind, so a
 * fast second ArrowDown repeats the first step (`tests/e2e/keyboard.spec.ts`).
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import {
  isActivationTarget,
  isPageKeyTaken,
  isScroller,
} from "../../../lib/keyboard";
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

  // Written before paint, so a key pressed as soon as a change shows sees it.
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
      // Also skips a key a row or the letter rail already answered.
      if (isPageKeyTaken(e)) return;
      // Caps Lock on: "J" is still j.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!singleKeys && /^[/nvjk]$/.test(key)) return;

      if (key === "Escape" && isSelectMode) {
        exitSelectMode();
        return;
      }
      if (key === "Enter") {
        // Enter on a link or button presses it. Only an idle Enter jumps to
        // the composer.
        if (isActivationTarget()) return;
        e.preventDefault();
        const editor = document.querySelector(".ProseMirror") as HTMLElement;
        if (editor) editor.focus();
        return;
      }
      if (key === "/") {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        onNewContact();
        return;
      }
      if (key === "v") {
        e.preventDefault();
        onSmartPaste();
        return;
      }

      // The arrows scroll a scroller that has focus: a click on blank space
      // in a contact focuses the page's scroller (App.tsx).
      if (key.startsWith("Arrow") && isScroller(document.activeElement)) {
        return;
      }
      if (key === "ArrowDown" || key === "j") {
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
      } else if (key === "ArrowUp" || key === "k") {
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

  useEffect(() => {
    if (currentId) {
      const el = document.getElementById(`contact-row-${currentId}`);
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentId]);
}

/**
 * useSoftKeyboard — tell the page's CSS when a phone's keyboard is up, and
 * how much of the screen it covers.
 *
 * Two things change while a person types on a phone:
 * - `data-typing` on `<html>`, while a field that opens the keyboard has
 *   focus on a touch screen and the keyboard is up. The tab bar hides then
 *   (index.css), so the field and its Save button get the room.
 * - `--keyboard-inset`, the height the keyboard covers, from the visual
 *   viewport. Android resizes the page for the keyboard (`interactive-widget`
 *   in index.html), so it stays 0 there. iOS does not, so a sheet and the
 *   composer's Save bar lift themselves by this much.
 *
 * Mounted once, in App.
 *
 * @module hooks/useSoftKeyboard
 */

import { useEffect } from "react";
import { isTouchScreen } from "../lib/platform";

/** Input types that open no keyboard. */
const NO_KEYBOARD = new Set([
  "checkbox",
  "radio",
  "range",
  "button",
  "submit",
  "reset",
  "color",
  "file",
  "image",
]);

/** True when focusing this element opens the on-screen keyboard. */
function opensKeyboard(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NO_KEYBOARD.has(el.type);
}

/** Less than this is a toolbar settling, not a keyboard. */
const KEYBOARD_MIN = 120;

export function useSoftKeyboard(): void {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    // The page's full height at each width it has had. Android shrinks the
    // page for the keyboard, so a page well short of it has the keyboard up.
    // One per width, so a phone turned back with the keyboard up still knows
    // its full height.
    const tallest = new Map<number, number>();

    const measure = () => {
      const full = Math.max(
        tallest.get(window.innerWidth) ?? 0,
        window.innerHeight,
      );
      tallest.set(window.innerWidth, full);
      // iOS keeps the page and lays the keyboard over it. A pinch zoom also
      // makes the visible part smaller and pans it, and that is no keyboard.
      const visible = viewport && viewport.scale <= 1.01 ? viewport : null;
      const covered = visible
        ? Math.max(
            0,
            Math.round(window.innerHeight - visible.height - visible.offsetTop),
          )
        : 0;
      const shrunk = full - window.innerHeight >= KEYBOARD_MIN;
      // Typing needs the keyboard up as well as a field in focus: Back on
      // Android, or the iPad's hide key, puts the keyboard away and leaves
      // the field focused, and the tab bar must come back then.
      const typing =
        isTouchScreen() &&
        opensKeyboard(document.activeElement) &&
        (covered >= KEYBOARD_MIN || shrunk);
      root.toggleAttribute("data-typing", typing);
      root.style.setProperty(
        "--keyboard-inset",
        `${typing && covered >= KEYBOARD_MIN ? covered : 0}px`,
      );
      // How far iOS has panned the visible part down the page, which a
      // sheet's height must leave out too.
      root.style.setProperty(
        "--viewport-offset",
        `${typing && visible ? Math.round(visible.offsetTop) : 0}px`,
      );
    };

    // While focus moves from one field to the next, the page has none for a
    // moment, and a field can leave the page with no focusout at all.
    // Measuring a frame later covers both.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    // Focus moves before the keyboard animates, so measure on focus and
    // again as the page or the visual viewport settles. The visual viewport
    // fires on every frame of a pan, and one measure per frame is enough.
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", later);
    document.addEventListener("pointerdown", later);
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", later);
    viewport?.addEventListener("scroll", later);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", later);
      document.removeEventListener("pointerdown", later);
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", later);
      viewport?.removeEventListener("scroll", later);
      root.removeAttribute("data-typing");
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--viewport-offset");
    };
  }, []);
}

/**
 * useSoftKeyboard — tell the page's CSS when a phone's keyboard is up, and
 * how much of the screen it covers.
 *
 * Two things change while a person types on a phone:
 * - `data-typing` on `<html>`, while a field that opens the keyboard has
 *   focus on a touch screen. The tab bar hides then (index.css), so the
 *   field and its Save button get the room.
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

export function useSoftKeyboard(): void {
  useEffect(() => {
    const root = document.documentElement;
    const coarse = window.matchMedia?.("(pointer: coarse)");
    const viewport = window.visualViewport;

    const measure = () => {
      const typing =
        Boolean(coarse?.matches) && opensKeyboard(document.activeElement);
      root.toggleAttribute("data-typing", typing);
      const covered =
        typing && viewport
          ? Math.max(
              0,
              Math.round(
                window.innerHeight - viewport.height - viewport.offsetTop,
              ),
            )
          : 0;
      root.style.setProperty("--keyboard-inset", `${covered}px`);
    };

    // While focus moves from one field to the next, the page has none for a
    // moment. Measuring a frame later keeps the tab bar from flashing back.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    // Focus moves before the keyboard animates, so measure on focus and
    // again as the visual viewport settles.
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", later);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", later);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      root.removeAttribute("data-typing");
      root.style.removeProperty("--keyboard-inset");
    };
  }, []);
}

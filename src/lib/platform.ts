/**
 * platform.ts: which keys this computer has, and the chords built on them.
 *
 * A Mac has a ⌘ key, and Windows and Linux do not. The navigation keys and
 * Quick interaction were ⌘ ⇧ and a letter, and the handlers read `metaKey`
 * alone, so on Windows and Linux they answered only to the Windows key or
 * the Super key, which the system keeps for itself. `Ctrl ⇧` is not the
 * answer there: the browser keeps `Ctrl ⇧ I` (developer tools), `Ctrl ⇧ P`
 * (a private window in Firefox) and `Ctrl ⇧ M` (the profile menu in Chrome,
 * the device view in Firefox), and a page cannot take them back.
 *
 * So Windows and Linux use `Ctrl Alt` and the letter. Chrome, Edge and
 * Firefox leave those chords to the page.
 *
 * 1. `isNavChord` accepts both forms on every platform. A handler needs no
 *    platform branch, and a test that presses ⌘ ⇧ works on a Linux runner.
 * 2. `navChordKey` reads the letter. It reads the character first, so a
 *    Dvorak layout keeps its own letters. When the character is no letter,
 *    it reads the physical key: Shift turns "," into "<" on a US keyboard,
 *    and on a European layout `Ctrl Alt` is AltGr and types "ś" or "µ". In a
 *    field only the character counts, so AltGr still types there.
 * 3. Only the labels depend on the platform. A Mac shows ⌘, and every other
 *    platform shows Ctrl.
 *
 * The platform comes from `navigator.userAgentData.platform`, then
 * `navigator.platform`, and never from `navigator.userAgent`. jsdom writes
 * the host system into its user agent, so a test would print ⌘ on a Mac and
 * Ctrl on the Linux CI runner. jsdom reports an empty platform, and an
 * unknown platform counts as a Mac, so the unit tests print ⌘ everywhere.
 *
 * @module lib/platform
 */

import { isTypingTarget } from "./keyboard";

/** The part of `navigator` this module reads. */
type PlatformSource = {
  platform?: string;
  userAgentData?: { platform?: string };
};

const APPLE = /mac|iphone|ipad|ipod/i;
const NOT_APPLE = /win|linux|x11|cros|chrome os|android/i;

/**
 * True on a Mac, an iPhone or an iPad: the platforms with a ⌘ key.
 *
 * @param nav - The navigator to read. The default is the browser's own.
 * @returns True when the platform is Apple's, or when it cannot be told.
 */
export function isApplePlatform(nav?: Navigator | PlatformSource): boolean {
  const source = (nav ??
    (typeof navigator === "undefined" ? undefined : navigator)) as
    PlatformSource | undefined;
  if (!source) return true;
  const names = [source.userAgentData?.platform, source.platform];
  for (const name of names) {
    if (!name) continue;
    if (APPLE.test(name)) return true;
    if (NOT_APPLE.test(name)) return false;
  }
  return true;
}

/** Read once: the platform does not change while the page is open. */
export const IS_APPLE = isApplePlatform();

/** The key that does ⌘'s job: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY: string = IS_APPLE ? "⌘" : "Ctrl";

/** The keys held for the navigation keys and Quick interaction. */
export const NAV_MODIFIERS: readonly string[] = IS_APPLE
  ? ["⌘", "⇧"]
  : ["Ctrl", "Alt"];

/**
 * A chord as one short string, for a tooltip or a hint: "⌘⇧H" on a Mac,
 * where the symbols read as one word, and "Ctrl+Alt+H" elsewhere, where
 * key names need a separator.
 */
export function chordLabel(keys: readonly string[]): string {
  return keys.join(IS_APPLE ? "" : "+");
}

/**
 * True when the event holds the modifiers of a navigation chord.
 *
 * ⌘ ⇧ with no Alt is the Mac form. `Ctrl Alt` with no ⌘ and no ⇧ is the
 * Windows and Linux form. Both work on every platform. `navChordKey` then
 * reads the letter.
 */
export function isNavChord(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  const mac = event.metaKey && event.shiftKey && !event.altKey;
  const other =
    event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
  return mac || other;
}

/**
 * The key of a navigation chord: a lower-case letter or ",", or "" when the
 * event is not a chord (point 2 above says how it reads the key).
 */
export function navChordKey(event: KeyboardEvent): string {
  if (!isNavChord(event)) return "";
  const char = event.key.toLowerCase();
  if (/^[a-z,]$/.test(char)) return char;
  if (!event.metaKey && isTypingTarget(event)) return "";
  if (event.code === "Comma") return ",";
  return event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : "";
}

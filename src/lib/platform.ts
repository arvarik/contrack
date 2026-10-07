/**
 * Which keys this computer has, and the chords built on them.
 *
 * The navigation chords are ⌘ ⇧ and a letter on a Mac, and `Ctrl Alt` and
 * the letter on Windows and Linux. `Ctrl ⇧` cannot work there: the browser
 * keeps `Ctrl ⇧ I`, `Ctrl ⇧ P` and `Ctrl ⇧ M` for itself.
 *
 * 1. `isNavChord` accepts both forms on every platform, so a handler needs
 *    no platform branch.
 * 2. `navChordKey` reads the character first, so a Dvorak layout keeps its
 *    letters. When the character is no letter it reads the physical key:
 *    Shift turns "," into "<", and on a European layout `Ctrl Alt` is AltGr
 *    and types "ś". In a field only the character counts, so AltGr types.
 * 3. Only the labels depend on the platform: ⌘ on a Mac, Ctrl elsewhere.
 *
 * The platform comes from `navigator.userAgentData.platform`, then
 * `navigator.platform`, never from the user agent, which jsdom fills with
 * the host system. An unknown platform counts as a Mac, so the unit tests
 * print ⌘ everywhere.
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
 * True on a Mac, an iPhone or an iPad: the platforms with a ⌘ key. Also
 * true when the platform cannot be told.
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

/**
 * A touch screen: its main pointer is a finger. CSS says `pointer-coarse:`,
 * and `useMediaQuery(TOUCH_QUERY)` follows it in a render.
 */
export const TOUCH_QUERY = "(pointer: coarse)";

/** Read once: the platform does not change while the page is open. */
export const IS_APPLE = isApplePlatform();

/** The key that does ⌘'s job: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD_KEY: string = IS_APPLE ? "⌘" : "Ctrl";

/** The keys held for the navigation keys and Log an interaction. */
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
 * True when the event holds the modifiers of a navigation chord: ⌘ ⇧ with no
 * Alt, or `Ctrl Alt` with no ⌘ and no ⇧, on every platform.
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

/**
 * True on a touch screen, where a focused field opens the on-screen keyboard
 * over the page, so a screen focuses its first field only for a mouse. False
 * where the browser cannot tell, such as a test without `matchMedia`.
 */
export function touchFirst(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.(TOUCH_QUERY).matches === true
  );
}

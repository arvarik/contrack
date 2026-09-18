/**
 * shortcuts.ts: every keyboard shortcut in the app, in one table.
 *
 * The shortcuts dialog used to keep its own private list, and the list had
 * already drifted from the app: it still said "Go to AI Search" after the
 * page was renamed. A key that is bound in one file and described in another
 * goes stale the first time somebody changes only one of them.
 *
 * So every plan that binds a key registers it here. The `?` dialog renders
 * from this table, and so will the Keyboard settings page. The unit test
 * reads it too, and it fails when two shortcuts in one group claim the same
 * keys, which is the collision a person would otherwise find by pressing a
 * key and getting the wrong action.
 *
 * Destination names come from `lib/names`, so the dialog calls a page what
 * the sidebar calls it.
 *
 * @module lib/shortcuts
 */
import { NAMES } from "./names";

export interface Shortcut {
  /** The heading the shortcut sits under. Must be in `SHORTCUT_GROUP_ORDER`. */
  group: string;
  /**
   * The keys as they are printed on the keyboard.
   *
   * With a modifier (⌘, ⇧, ⌥, ⌃, Ctrl, Alt) the keys are one combination,
   * pressed together. With no modifier they are alternatives, and any one of
   * them does the same thing: `["↓", "J"]` is the arrow or the letter.
   */
  keys: string[];
  /** What the shortcut does, in a few plain words. */
  description: string;
  /**
   * True when a printable key with no modifier fires the shortcut.
   *
   * These are the shortcuts a person can set off by typing in the wrong
   * place. The settings revamp adds a `singleKeyShortcuts` switch that turns
   * off exactly these, so every entry says which kind it is.
   */
  bareLetter: boolean;
  /**
   * When true, this shortcut stays active even when singleKeyShortcuts is off.
   * Only bare-letter shortcuts can be alwaysOn.
   */
  alwaysOn?: boolean;
  /** The route where the shortcut works. Absent means everywhere. */
  page?: string;
}

/** The modifier keys, as `keys` prints them. */
export const MODIFIER_KEYS: readonly string[] = [
  "⌘",
  "⇧",
  "⌥",
  "⌃",
  "Ctrl",
  "Alt",
];

/** True when the keys are pressed together rather than one or the other. */
export const isCombination = (keys: readonly string[]): boolean =>
  keys.some((key) => MODIFIER_KEYS.includes(key));

/** The order the groups appear in, in the dialog and on the settings page. */
export const SHORTCUT_GROUP_ORDER: readonly string[] = [
  "Navigation",
  "Global",
  NAMES.pulse.label,
  NAMES.network.label,
  NAMES.map.label,
  "Contact",
  NAMES.ask.label,
  "Notes",
  NAMES.duplicates.label,
];

export const SHORTCUTS: readonly Shortcut[] = [
  // Pulse office
  {
    group: NAMES.pulse.label,
    keys: ["J"],
    description: "Next item in Up next",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["K"],
    description: "Previous item in Up next",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["D"],
    description: "Mark item done",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["S"],
    description: "Snooze item",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["L"],
    description: "Log note for contact",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["C"],
    description: "Toggle customize layout",
    bareLetter: true,
    page: "/pulse",
  },
  {
    group: NAMES.pulse.label,
    keys: ["Enter"],
    description: "Open contact",
    bareLetter: false,
    page: "/pulse",
  },
  // Navigation. Cmd+Shift so that no letter typed into a field can reach it.
  {
    group: "Navigation",
    keys: ["⌘", "⇧", "H"],
    description: `Go to ${NAMES.network.label}`,
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "⇧", "P"],
    description: `Go to ${NAMES.pulse.label}`,
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "⇧", "M"],
    description: `Go to ${NAMES.map.label}`,
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "⇧", "S"],
    description: `Go to ${NAMES.ask.label}`,
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "⇧", ","],
    description: `Go to ${NAMES.settings.label}`,
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "["],
    description: "Back",
    bareLetter: false,
  },
  {
    group: "Navigation",
    keys: ["⌘", "]"],
    description: "Forward",
    bareLetter: false,
  },

  // Global
  {
    group: "Global",
    keys: ["?"],
    description: "Show keyboard shortcuts",
    bareLetter: true,
    alwaysOn: true,
  },
  {
    group: "Global",
    keys: ["⌘", "K"],
    description: "Open command palette",
    bareLetter: false,
  },
  {
    group: "Global",
    keys: ["⌘", "⇧", "I"],
    description: "Quick interaction",
    bareLetter: false,
  },
  // The composer, on a contact and in the quick interaction dialog. Ctrl
  // outside macOS: tiptap's Mod key and the field's own handler both follow
  // the platform.
  {
    group: "Global",
    keys: ["⌘", "Enter"],
    description: "Save the interaction you are writing",
    bareLetter: false,
  },

  // The contact list. The arrows, Home, End, the letters and Enter move
  // focus inside the list, so they work once the list has focus.
  {
    group: NAMES.network.label,
    keys: ["/"],
    description: "Focus search",
    bareLetter: true,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["N"],
    description: "New contact",
    bareLetter: true,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["V"],
    description: "Smart paste (AI parse)",
    bareLetter: true,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["Esc"],
    description: "Exit selection mode",
    bareLetter: false,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["↑", "↓"],
    description: "Move through the contact list",
    bareLetter: false,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["Home"],
    description: "First contact",
    bareLetter: false,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["End"],
    description: "Last contact",
    bareLetter: false,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["A–Z"],
    description: "Jump to the next name with that letter",
    bareLetter: true,
    alwaysOn: true,
    page: "/",
  },
  {
    group: NAMES.network.label,
    keys: ["Enter"],
    description: "Open the contact",
    bareLetter: false,
    page: "/",
  },

  // Map
  {
    group: NAMES.map.label,
    keys: ["/"],
    description: "Focus search",
    bareLetter: true,
    page: "/map",
  },
  {
    group: NAMES.map.label,
    keys: ["F"],
    description: "Fit all in view",
    bareLetter: true,
    page: "/map",
  },

  // A contact's details. Every value edits in place: it is a button at rest
  // and a field once opened. The pencil after a value is the visible sign.
  {
    group: "Contact",
    keys: ["Enter"],
    description: "Edit the value that has focus",
    bareLetter: false,
    page: "/contact/:id",
  },
  {
    group: "Contact",
    keys: ["Esc"],
    description: "Cancel the edit",
    bareLetter: false,
    page: "/contact/:id",
  },
  // An address, an email or a phone. The first one is the primary one.
  {
    group: "Contact",
    keys: ["⌥", "↑"],
    description: "Move the value up one place",
    bareLetter: false,
    page: "/contact/:id",
  },
  {
    group: "Contact",
    keys: ["⌥", "↓"],
    description: "Move the value down one place",
    bareLetter: false,
    page: "/contact/:id",
  },

  // Ask Contrack
  {
    group: NAMES.ask.label,
    keys: ["/"],
    description: "Focus search",
    bareLetter: true,
    page: "/search",
  },
  {
    group: NAMES.ask.label,
    keys: ["H"],
    description: "Toggle search history",
    bareLetter: true,
    page: "/search",
  },

  // Notes
  {
    group: "Notes",
    keys: ["/"],
    description: "Focus search",
    bareLetter: true,
    page: "/search",
  },

  // Duplicates, in the swipe view. The arrow and the letter do the same
  // thing in one handler, so an entry with a letter in it is a bare letter.
  {
    group: NAMES.duplicates.label,
    keys: ["→", "L"],
    description: "Merge into primary",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["←", "H"],
    description: "Keep separate (skip)",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["↓", "J"],
    description: "Next suggestion",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["↑", "K"],
    description: "Previous suggestion",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["⌘", "Z"],
    description: "Undo last dismiss",
    bareLetter: false,
    page: "/settings/duplicates",
  },
];

/** The shortcuts under their group headings, in `SHORTCUT_GROUP_ORDER`. */
export function groupedShortcuts(
  entries: readonly Shortcut[] = SHORTCUTS,
): { group: string; shortcuts: Shortcut[] }[] {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    shortcuts: entries.filter((entry) => entry.group === group),
  })).filter(({ shortcuts }) => shortcuts.length > 0);
}

/**
 * shortcuts.ts: every keyboard shortcut in the app, in one table.
 *
 * The shortcuts dialog used to keep its own private list, and the list had
 * already drifted from the app: it still said "Go to AI Search" after the
 * page was renamed. A key that is bound in one file and described in another
 * goes stale the first time somebody changes only one of them.
 *
 * So every plan that binds a key registers it here. The `?` dialog renders
 * from this table: the shortcuts that work everywhere on its left, and the
 * ones for the page it opened on at its right (`pageShortcutGroups`). The
 * Keyboard settings page lists the whole table. The unit test reads it too,
 * and it fails when two shortcuts in one group claim the same keys, which is
 * the collision a person would otherwise find by pressing a key and getting
 * the wrong action.
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
  NAMES.duplicates.label,
  NAMES.possibleDuplicates.label,
];

/** The groups that work on every page: the dialog's left column. */
export const COMMON_GROUPS: readonly string[] = ["Navigation", "Global"];

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
  // The arrows work from a focused row: Tab into the queue, then walk it.
  {
    group: NAMES.pulse.label,
    keys: ["↑", "↓"],
    description: "Move between items in Up next",
    bareLetter: false,
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
  // Enter belongs to the control that has focus. On a focused row it opens
  // the contact. On a button, a link or a menu item it does what that does.
  {
    group: NAMES.pulse.label,
    keys: ["Enter"],
    description: "Open the highlighted contact",
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
  {
    group: NAMES.map.label,
    keys: ["I"],
    description: "Toggle insights pane",
    bareLetter: true,
    page: "/map",
  },
  {
    group: NAMES.map.label,
    keys: ["L"],
    description: "Lasso select",
    bareLetter: true,
    page: "/map",
  },
  {
    group: NAMES.map.label,
    keys: ["Esc"],
    description: "Clear selection or close card",
    bareLetter: false,
    page: "/map",
  },
  {
    group: NAMES.map.label,
    keys: ["Enter"],
    description: "Open contact",
    bareLetter: false,
    page: "/map",
  },
  {
    group: NAMES.map.label,
    keys: ["Space"],
    description: "Pin card",
    bareLetter: false,
    page: "/map",
  },

  // Track is the one action on a contact with a key of its own. It does
  // what the header's Track button does, toast and Undo included.
  {
    group: "Contact",
    keys: ["T"],
    description: "Track or untrack this contact",
    bareLetter: true,
    page: "/contact/:id",
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

  // Ask Contrack, in both modes: People and Notes share the box and the keys.
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
  {
    group: NAMES.ask.label,
    keys: ["Esc"],
    description: "Clear the search",
    bareLetter: false,
    page: "/search",
  },

  // Duplicates, in the swipe view. The arrow and the letter do the same
  // thing in one handler, so an entry with a letter in it is a bare letter.
  {
    group: NAMES.duplicates.label,
    keys: ["→", "L"],
    description: "Merge into the primary",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["←", "H"],
    description: "Keep separate",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["↓", "J"],
    description: "Next group",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["↑", "K"],
    description: "Previous group",
    bareLetter: true,
    page: "/settings/duplicates",
  },
  {
    group: NAMES.duplicates.label,
    keys: ["⌘", "Z"],
    description: "Undo the last skip",
    bareLetter: false,
    page: "/settings/duplicates",
  },

  // The Possible duplicates queue, one pair of rows at a time.
  {
    group: NAMES.possibleDuplicates.label,
    keys: ["↓", "J"],
    description: "Next pair",
    bareLetter: true,
    page: "/pulse/duplicates",
  },
  {
    group: NAMES.possibleDuplicates.label,
    keys: ["↑", "K"],
    description: "Previous pair",
    bareLetter: true,
    page: "/pulse/duplicates",
  },
  {
    group: NAMES.possibleDuplicates.label,
    keys: ["→", "L"],
    description: "Merge the pair",
    bareLetter: true,
    page: "/pulse/duplicates",
  },
  {
    group: NAMES.possibleDuplicates.label,
    keys: ["←", "H"],
    description: "Keep them separate",
    bareLetter: true,
    page: "/pulse/duplicates",
  },
  {
    group: NAMES.possibleDuplicates.label,
    keys: ["Space"],
    description: "Select the pair",
    bareLetter: false,
    page: "/pulse/duplicates",
  },
];

/** Shortcuts under one heading. */
export interface ShortcutGroup {
  group: string;
  shortcuts: Shortcut[];
}

/** The shortcuts under their group headings, in `SHORTCUT_GROUP_ORDER`. */
export function groupedShortcuts(
  entries: readonly Shortcut[] = SHORTCUTS,
): ShortcutGroup[] {
  return SHORTCUT_GROUP_ORDER.map((group) => ({
    group,
    shortcuts: entries.filter((entry) => entry.group === group),
  })).filter(({ shortcuts }) => shortcuts.length > 0);
}

/**
 * Whether the page a shortcut belongs to is on screen at `pathname`.
 *
 * Three pages are on screen at more than their own path: the Network list
 * stays beside an open contact, a contact also opens over the map, and the
 * map keeps its keys while it does.
 *
 * @param page - A shortcut's `page`, for example `/` or `/contact/:id`.
 * @param pathname - The location's path, with no query or hash.
 * @returns True when the shortcut's keys work at that path.
 */
export function isOnPage(page: string, pathname: string): boolean {
  switch (page) {
    case "/":
      return pathname === "/" || pathname.startsWith("/contact/");
    case "/contact/:id":
      return /^\/(map\/)?contact\//.test(pathname);
    case "/map":
      return pathname === "/map" || pathname.startsWith("/map/");
    default:
      return pathname === page;
  }
}

/**
 * The shortcuts of the page at `pathname`, for the dialog's right column.
 *
 * Every group whose shortcuts work at that path, in `SHORTCUT_GROUP_ORDER`,
 * except that an open contact's group comes first: the contact is what the
 * person is looking at, and the list or the map is beside or behind it.
 *
 * @param pathname - The location's path, with no query or hash.
 * @returns The groups, empty on a page with no keys of its own.
 */
export function pageShortcutGroups(pathname: string): ShortcutGroup[] {
  const groups = groupedShortcuts(
    SHORTCUTS.filter(
      (entry) => entry.page !== undefined && isOnPage(entry.page, pathname),
    ),
  );
  const contact = groups.findIndex(({ group }) => group === "Contact");
  if (contact > 0) groups.unshift(...groups.splice(contact, 1));
  return groups;
}

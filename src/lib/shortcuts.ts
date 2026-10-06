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
import { IS_APPLE, MOD_KEY, NAV_MODIFIERS } from "./platform";

/**
 * The keys of a navigation chord on this platform: ⌘ ⇧ and the key on a Mac,
 * Ctrl Alt and the key on Windows and Linux (`lib/platform` says why).
 */
const nav = (key: string): string[] => [...NAV_MODIFIERS, key];

/**
 * Back and forward. A Mac has ⌘ [ and ⌘ ], which the app binds. Windows and
 * Linux have the browser's own Alt ← and Alt →, which already work.
 */
const BACK_KEYS = IS_APPLE ? ["⌘", "["] : ["Alt", "←"];
const FORWARD_KEYS = IS_APPLE ? ["⌘", "]"] : ["Alt", "→"];

/** The Option key on a Mac, the Alt key elsewhere. */
const ALT = IS_APPLE ? "⌥" : "Alt";

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
const MODIFIER_KEYS: readonly string[] = ["⌘", "⇧", "⌥", "⌃", "Ctrl", "Alt"];

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
  NAMES.possibleDuplicates.label,
];

/** The groups that work on every page: the dialog's left column. */
export const COMMON_GROUPS: readonly string[] = ["Navigation", "Global"];

/** A group's rows, each given the group's name and, when set, its page. */
const inGroup = (
  group: string,
  page: string | undefined,
  rows: Omit<Shortcut, "group" | "page">[],
): Shortcut[] =>
  rows.map((row) => (page ? { group, ...row, page } : { group, ...row }));

export const SHORTCUTS: readonly Shortcut[] = [
  // Pulse office
  ...inGroup(NAMES.pulse.label, "/pulse", [
    { keys: ["J"], description: "Next item in Up next", bareLetter: true },
    { keys: ["K"], description: "Previous item in Up next", bareLetter: true },
    // The arrows work from a focused row: Tab into the queue, then walk it.
    {
      keys: ["↑", "↓"],
      description: "Move between items in Up next",
      bareLetter: false,
    },
    { keys: ["D"], description: "Mark item done", bareLetter: true },
    { keys: ["S"], description: "Snooze item", bareLetter: true },
    { keys: ["L"], description: "Log note for contact", bareLetter: true },
    { keys: ["C"], description: "Toggle customize layout", bareLetter: true },
    // Enter belongs to the control that has focus. On a focused row it opens
    // the contact. On a button, a link or a menu item it does what that does.
    {
      keys: ["Enter"],
      description: "Open the highlighted contact",
      bareLetter: false,
    },
    {
      keys: ["Space"],
      description: "Mark the highlighted item done, or log a note",
      bareLetter: false,
    },
  ]),
  // Navigation. Two modifiers, so that no letter typed into a field can
  // reach it: Cmd+Shift on a Mac, Ctrl+Alt on Windows and Linux.
  ...inGroup("Navigation", undefined, [
    {
      keys: nav("H"),
      description: `Go to ${NAMES.network.label}`,
      bareLetter: false,
    },
    {
      keys: nav("P"),
      description: `Go to ${NAMES.pulse.label}`,
      bareLetter: false,
    },
    {
      keys: nav("M"),
      description: `Go to ${NAMES.map.label}`,
      bareLetter: false,
    },
    {
      keys: nav("S"),
      description: `Go to ${NAMES.ask.label}`,
      bareLetter: false,
    },
    {
      keys: nav(","),
      description: `Go to ${NAMES.settings.label}`,
      bareLetter: false,
    },
    { keys: BACK_KEYS, description: "Back", bareLetter: false },
    { keys: FORWARD_KEYS, description: "Forward", bareLetter: false },
  ]),

  // Global
  ...inGroup("Global", undefined, [
    {
      keys: ["?"],
      description: "Show keyboard shortcuts",
      bareLetter: true,
      alwaysOn: true,
    },
    {
      keys: [MOD_KEY, "K"],
      description: "Open command palette",
      bareLetter: false,
    },
    { keys: nav("I"), description: "Log an interaction", bareLetter: false },
    // Sonner's own key: it takes focus to the toasts, where Undo waits.
    {
      keys: [ALT, "T"],
      description: "Go to the notifications, for Undo",
      bareLetter: false,
    },
    // The composer, on a contact and in the quick interaction dialog. Ctrl
    // outside macOS: tiptap's Mod key and the field's own handler both follow
    // the platform.
    {
      keys: [MOD_KEY, "Enter"],
      description: "Save the interaction you are writing",
      bareLetter: false,
    },
  ]),

  // The contact list. The arrows, Home, End, the letters and Enter move
  // focus inside the list, so they work once the list has focus.
  ...inGroup(NAMES.network.label, "/", [
    { keys: ["/"], description: "Focus search", bareLetter: true },
    { keys: ["N"], description: "New contact", bareLetter: true },
    { keys: ["V"], description: "Add from text", bareLetter: true },
    { keys: ["Esc"], description: "Exit selection mode", bareLetter: false },
    {
      keys: ["↑", "↓"],
      description: "Move through the contact list",
      bareLetter: false,
    },
    // J and K answer on the page, not in the list: in the list a letter is
    // type-ahead. They open the next or the previous contact, as the arrows do
    // from outside the list (`useContactListKeyboard`), and they obey the
    // single-key switch.
    { keys: ["J"], description: "Open the next contact", bareLetter: true },
    { keys: ["K"], description: "Open the previous contact", bareLetter: true },
    { keys: ["Home"], description: "First contact", bareLetter: false },
    { keys: ["End"], description: "Last contact", bareLetter: false },
    {
      keys: ["A–Z"],
      description: "Jump to the next name with that letter",
      bareLetter: true,
      alwaysOn: true,
    },
    // Select mode: a long press, or Select in the list's header.
    {
      keys: ["Enter", "Space"],
      description: "Open the contact, or select it in select mode",
      bareLetter: false,
    },
    {
      keys: ["PgUp", "PgDn"],
      description: "Move a screen of contacts",
      bareLetter: false,
    },
    {
      keys: ["⇧", "Enter"],
      description: "Select every contact from the last one chosen",
      bareLetter: false,
    },
    {
      keys: [MOD_KEY, "A"],
      description: "Select every contact shown, in select mode",
      bareLetter: false,
    },
  ]),

  // Map. On a narrow window, or beside an open contact, / opens Filters.
  ...inGroup(NAMES.map.label, "/map", [
    { keys: ["/"], description: "Focus the filter box", bareLetter: true },
    { keys: ["F"], description: "Fit all in view", bareLetter: true },
    { keys: ["I"], description: "Toggle insights pane", bareLetter: true },
    { keys: ["L"], description: "Lasso select", bareLetter: true },
    {
      keys: ["Esc"],
      description:
        "Clear the filter box, close the contact, or clear the selection",
      bareLetter: false,
    },
    { keys: ["Enter"], description: "Open contact", bareLetter: false },
    { keys: ["Space"], description: "Card actions", bareLetter: false },
    {
      keys: [ALT, "↑"],
      description: "Move a view up, in Views",
      bareLetter: false,
    },
    {
      keys: [ALT, "↓"],
      description: "Move a view down, in Views",
      bareLetter: false,
    },
  ]),

  // Track is the one action on a contact with a key of its own. It does
  // what the header's Track button does, toast and Undo included.
  ...inGroup("Contact", "/contact/:id", [
    {
      keys: ["T"],
      description: "Track this contact, or stop tracking it",
      bareLetter: true,
    },
    // A contact's details. Every value edits in place: it is a button at rest
    // and a field once opened. The pencil after a value is the visible sign.
    // Outside a control, Enter starts a note (`useContactListKeyboard`).
    {
      keys: ["Enter"],
      description: "Edit the value that has focus, or start a note",
      bareLetter: false,
    },
    { keys: ["Esc"], description: "Cancel the edit", bareLetter: false },
    // An address, an email or a phone. The first one is the primary one.
    {
      keys: [ALT, "↑"],
      description: "Move the value up one place",
      bareLetter: false,
    },
    {
      keys: [ALT, "↓"],
      description: "Move the value down one place",
      bareLetter: false,
    },
  ]),

  // Ask Contrack, in both modes: People and Notes share the box and the keys.
  ...inGroup(NAMES.ask.label, "/search", [
    { keys: ["/"], description: "Focus search", bareLetter: true },
    { keys: ["H"], description: "Toggle search history", bareLetter: true },
    { keys: ["Esc"], description: "Clear the search", bareLetter: false },
    // The results are one Tab stop. The arrows walk them from a focused result.
    {
      keys: ["↑", "↓"],
      description: "Move between results",
      bareLetter: false,
    },
  ]),

  // Possible duplicates, one group at a time. The arrow and the letter do
  // the same thing in one handler, so an entry with a letter in it is a bare
  // letter.
  ...inGroup(NAMES.possibleDuplicates.label, "/pulse/duplicates", [
    { keys: ["↓", "J"], description: "Next group", bareLetter: true },
    { keys: ["↑", "K"], description: "Previous group", bareLetter: true },
    {
      keys: ["→", "L"],
      description:
        "Merge into the contact to keep. A Check carefully group takes two presses",
      bareLetter: true,
    },
    { keys: ["←", "H"], description: "Keep them separate", bareLetter: true },
    { keys: ["Z"], description: "Undo the last decision", bareLetter: true },
  ]),
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

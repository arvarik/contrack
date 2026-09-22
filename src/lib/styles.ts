/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTRACK DESIGN SYSTEM — Centralized Style Dictionary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file is the SINGLE SOURCE OF TRUTH for all repeated Tailwind class
 * patterns used throughout the app. Every component imports from here
 * instead of hardcoding class strings.
 *
 * RULES:
 *   1. If a pattern is used 2+ times across components, extract it here.
 *   2. Compose via `cn()` from lib/utils when overrides are needed.
 *   3. CSS-level reusable classes live in index.css (@layer components).
 *      This file handles patterns that TAILWIND expresses well but need
 *      to be DRY and overridable at the call-site.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { cn } from "./utils";

// ─── Typography ──────────────────────────────────────────────────────────────

/*
 * The type floor is 11 px. Nothing a person reads is smaller, and
 * tests/unit/styles.floor.test.ts fails on `text-[11px]` and `text-[11px]`
 * anywhere in src/. Uppercase labels keep their tracking at 0.08em, a
 * little tighter than Tailwind's widest, so the larger size does not widen
 * every chip. Every uppercase label in the app uses this one tracking.
 */

/** Micro label — field labels inside detail cards (e.g. "LOCATION", "EMAIL") */
export const LABEL =
  "text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant";

/** Primary micro label — highlighted labels (e.g. "NEXT FOLLOW UP") */
export const LABEL_PRIMARY =
  "text-[11px] font-bold uppercase tracking-[0.08em] text-primary";

/**
 * Section heading — card titles (e.g. "DETAILS", "About", "Experience").
 * One step below body text, so a card title reads as a heading by case and
 * weight and not by size.
 */
export const SECTION_HEADING =
  "text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant";

/**
 * Field label — the name above one value in a card ("Location", "Email").
 * Sentence case at 12 px, so it sits below an uppercase section heading
 * instead of competing with it.
 */
export const FIELD_LABEL = "text-xs font-medium text-on-surface-variant";

/**
 * Meta line — facts under a name, separated by a middle dot ("Sydney ·
 * 2:45 AM · 13°C"). Plain text: a fact is not a control, so it does not
 * wear a pill.
 */
export const META_LINE =
  "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-on-surface-variant";

/** Section heading with bottom spacing — preformatted for card headers */
export const SECTION_HEADING_SPACED = cn(
  SECTION_HEADING,
  "mb-3 flex items-center gap-2",
);

// ─── Page header ─────────────────────────────────────────────────────────────
//
// Every page's top is `PageHeader` (src/components/layout/PageHeader.tsx): an
// optional small line above, the title, one line under it, and the actions
// at the right. These are its parts, and the page's own padding.

/**
 * The page title: the h1, or the day on Pulse. 24 px, and 30 px once its
 * header is 28 rem wide. The size follows the header's own width, not the
 * window's (`PageHeader` is a size container), so the narrow Network pane on
 * a desktop keeps the phone size and "12 selected" and its two buttons still
 * fit on one row.
 */
export const PAGE_TITLE =
  "text-2xl @md:text-3xl leading-tight font-headline font-bold tracking-tight text-on-surface";

/**
 * The small line above a title: a back link, or the page's name over a
 * headline. The face and tracking are set here because Pulse's eyebrow is an
 * `h1`, and the base layer gives every heading the headline face: without
 * them the same line would look different on Pulse and on a back link.
 */
export const PAGE_EYEBROW =
  "font-body tracking-normal text-[13px] leading-tight font-semibold text-on-surface-variant";

/** The one line under a title. 14 px, 16 px in a wide header. */
export const PAGE_DESCRIPTION =
  "text-sm @md:text-base leading-snug text-on-surface-variant text-pretty";

/** A page's side gutters. A narrow pane (the Network list) keeps `px-4`. */
export const PAGE_X = "px-4 sm:px-6 lg:px-10";

/** The space above a page's header. The same on every page, so the titles line up. */
export const PAGE_TOP = "pt-6 lg:pt-8";

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * Card — the static white surface (`.card` in index.css). Not a control, so
 * no hover. A card that is a control is `CARD_INTERACTIVE`.
 */
export const CARD = "card";

/** Card compact — slightly tighter padding */
export const CARD_COMPACT = "card p-5";

/**
 * A card that is a control: a search result, a suggestion tile. It rises
 * 2 px on hover (`.card-interactive`). Never add a `shadow-*`, `ring-*`,
 * `scale-*` or `translate-*` hover of its own: those are the card's job.
 */
export const CARD_INTERACTIVE = "card card-interactive";

/** Section background — the mid-tone layer for headers / sidebars */
export const SECTION_BG = "bg-surface-container-low";

/** Tinted card — a card on a subtle primary wash, such as the AI usage summary. */
export const CARD_TINTED = "card bg-primary/5 relative overflow-hidden";

// ─── Hover and selection ─────────────────────────────────────────────────────
//
// Three kinds of surface, three hovers (`.agent/STYLE.md`, "Hover"):
//
//   - A flat control (a row, a ghost button, a pill, a nav item) takes
//     `state-layer`: a 6 percent ink layer on hover, 10 on press.
//   - A card that is a control takes `CARD_INTERACTIVE`: it rises 2 px.
//   - A static card has no hover.
//
// And one selected look: the primary tint. A row in a list adds a 3 px bar
// on its leading edge (`row-selected`), a pill or a nav item does not.

/** A selected pill, chip, nav item or menu option: the tint and its ink. */
export const SELECTED_TINT = "bg-primary/10 text-on-primary-wash";

/**
 * The selected row in a list: the tint and the 3 px bar (`.row-selected`).
 * Put `text-on-primary-wash` on the text that was `text-primary`.
 */
export const SELECTED_ROW = "row-selected";

/**
 * The chosen swatch in a picker of colours, icons or avatars: a 2 px ring in
 * the ink colour, 2 px off the swatch. A swatch has no room for a bar or a
 * dot, and its fill is its content, so it cannot take the tint either. The
 * ring is the ink, not the primary, so it never reads as the focus ring,
 * which is the primary with no gap on a swatch like this.
 */
export const SWATCH_SELECTED =
  "ring-2 ring-offset-2 ring-on-surface ring-offset-surface-container-lowest";

// ─── Tones ───────────────────────────────────────────────────────────────────
//
// A colour that means something, in one place. Overdue is the error red,
// today is the primary, a birthday is the warning amber, new people are the
// success green, and everything else is neutral. A group's dot, its rows'
// leading glyph and its chips read from the same tone, so the eye can follow
// a colour down a card. The AI colour is not a tone: it marks what a model
// wrote, and a category is not that.

export type Tone = "error" | "primary" | "warning" | "success" | "neutral";

/** The 6 px dot before a group's name. */
export const TONE_DOT: Record<Tone, string> = {
  error: "bg-error",
  primary: "bg-primary",
  warning: "bg-warning",
  success: "bg-success",
  neutral: "bg-outline-variant",
};

/**
 * A chip or an icon tile: the tone's 10 percent wash with the tone's own ink.
 * Each pair clears AA; `tests/unit/theme.contrast.test.ts` measures them.
 */
export const TONE_WASH: Record<Tone, string> = {
  error: "bg-error/10 text-error",
  primary: "bg-primary/10 text-on-primary-wash",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

/** The tone's ink alone, for an icon on a surface. */
export const TONE_TEXT: Record<Tone, string> = {
  error: "text-error",
  primary: "text-primary",
  warning: "text-warning",
  success: "text-success",
  neutral: "text-on-surface-variant",
};

// ─── Navigation ──────────────────────────────────────────────────────────────

/** Sidebar nav link — returns full className given active state */
export const navLink = (active: boolean, extra?: string) =>
  cn(
    "p-3 rounded-xl transition-colors",
    active
      ? SELECTED_TINT
      : "state-layer text-on-surface-variant hover:text-on-surface",
    extra,
  );

// ─── Buttons ─────────────────────────────────────────────────────────────────

/**
 * Icon button — small clickable icon (toolbar, header actions). Flat, with
 * the one hover layer. Use `.btn-primary` / `.btn-secondary` for a call to
 * action, which is the only kind of button with depth.
 *
 * About 32 px on screen with a 16 px icon, and a 44 px tap box from
 * `hit-area` (see index.css). Give neighbours 12 px of gap so the boxes do
 * not overlap.
 */
export const ICON_BTN =
  "hit-area state-layer p-2 rounded-xl text-on-surface-variant hover:text-on-surface transition-colors";

/**
 * A quiet text button beside a control: "Reset", "Show more", "Clear".
 * Small, the variant text colour, the ink on hover, and a 44 px tap box.
 * It never competes with the control it sits beside.
 */
export const BTN_QUIET =
  "hit-area state-layer inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-on-surface-variant hover:text-on-surface transition-colors whitespace-nowrap";

/**
 * The mark on a setting that is not at its default: a 6 px accent dot after
 * the title. `SettingRow` draws it with a name for a screen reader and a
 * tooltip, and puts a `BTN_QUIET` "Reset" beside the control.
 */
export const CHANGED_MARK =
  "inline-block w-1.5 h-1.5 rounded-full bg-primary shrink-0";

/** Text link style — inline clickable text */
export const TEXT_LINK = "text-primary hover:underline font-bold";

/**
 * "+ Add": the control under a field or after a row of chips.
 *
 * A real button in primary text with a 44 px tap box. It replaced three
 * looks for one act: an italic "Add another" that read as a placeholder, an
 * underlined bare input, and nothing at all for tags.
 */
export const ADD_BUTTON =
  "hit-area state-layer inline-flex items-center gap-1 w-fit rounded-lg px-1.5 -mx-1.5 py-0.5 text-sm font-bold text-primary transition-colors";

/**
 * A button in a floating selection bar: a glyph over a word, flat, with the
 * hover layer. The Network list's bulk bar and the Tracked page's bar share
 * it, and `BAR_LABEL` is the word.
 */
export const BAR_BUTTON =
  "state-layer flex flex-col items-center gap-0.5 min-w-[44px] px-2 py-1.5 rounded-xl transition-colors shrink-0";

/** The word under a bar button's glyph. */
export const BAR_LABEL = cn(LABEL, "text-inherit whitespace-nowrap");

// ─── Badges & Pills ─────────────────────────────────────────────────────────

/** Tag pill — used in contact tags, filter indicators */
export const TAG_PILL =
  "text-[11px] font-bold bg-primary/10 text-on-primary-wash px-2 py-0.5 rounded-md";

/** Micro badge — tiny inline status labels (e.g. "Current", "work", "personal") */
export const MICRO_BADGE =
  "text-[11px] uppercase tracking-[0.08em] opacity-50 bg-surface-container px-1 rounded";

/** Status badge — success variant (e.g. "Current" on experience) */
export const STATUS_BADGE_SUCCESS =
  "text-[11px] uppercase tracking-[0.08em] bg-success/10 text-success px-1.5 py-0.5 rounded font-bold";

/** Source badge */
export const SOURCE_BADGE =
  "text-[11px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-md";

// ─── Inputs ──────────────────────────────────────────────────────────────────

/**
 * Search input — the list-header search box. 44 px tall on a phone, 40 from
 * `sm`. Its focus ring is the app's one ring, drawn on its edge (index.css).
 */
export const SEARCH_INPUT =
  "w-full bg-surface-container-low rounded-xl pl-9 pr-4 py-3 sm:py-2.5 text-sm transition-colors";

/** Inline editable field input — appears on click-to-edit */
export const EDITABLE_INPUT =
  "bg-surface-container-high border-none rounded px-2 py-0.5 max-w-full text-inherit font-inherit leading-inherit";

// ─── Keyboard shortcut hints ─────────────────────────────────────────────────

/** Keyboard shortcut badge */
export const KBD =
  "bg-surface-container-high px-2 rounded-md text-xs font-mono";

/** Keyboard shortcut badge — smaller variant */
export const KBD_SM =
  "bg-surface-container-high px-1.5 rounded font-mono text-[11px] shadow-sm";

// ─── Filter Tabs ─────────────────────────────────────────────────────────────

/** Tab container — the trough behind a row of tab items */
export const TAB_CONTAINER =
  "flex gap-1 bg-surface-container-low p-1 rounded-xl";

/** Tab item — returns className based on active state */
export const tabItem = (active: boolean) =>
  cn(
    "px-4 py-2 text-sm font-bold rounded-lg transition-colors",
    active
      ? "text-primary bg-surface-container-lowest shadow-sm"
      : "text-on-surface-variant hover:text-on-surface",
  );

// ─── Filter pills ────────────────────────────────────────────────────────────

/**
 * Filter pill button — returns className based on active state. The active
 * pill is the selected tint and nothing else: the ring it used to wear read
 * as a pressed button.
 */
export const filterPill = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors",
    active
      ? SELECTED_TINT
      : "state-layer text-on-surface-variant hover:text-on-surface",
  );

// ─── List Items ──────────────────────────────────────────────────────────────

/**
 * Contact list row — returns className based on active state.
 *
 * The current row is the selected row: the tint and the 3 px bar. It was a
 * ring, first 2 px solid and then 1 px inset, and either way it read as a
 * focus ring on every visit, with two rings when the row also had focus.
 * The hover layer sits over the tint as well as over the plain row.
 */
export const listRow = (active: boolean) =>
  cn(
    "state-layer flex items-center gap-3 p-3 rounded-xl transition-colors relative",
    active && SELECTED_ROW,
  );

// ─── Timeline ────────────────────────────────────────────────────────────────

/**
 * Timeline entry card: the full-width card right of the date column. No
 * hover shadow, because the card itself is not a control. Its title button
 * and its kebab are.
 */
export const TIMELINE_CARD = "card p-4 sm:p-5";

// ─── Composer ────────────────────────────────────────────────────────────────

/**
 * Rich text composer container. No outer margin: the timeline puts its own
 * gap between the composer and the first group. A composite field, so the
 * card draws the focus ring while its editor has focus (`.focus-frame`).
 */
export const COMPOSER = "card focus-frame p-4 z-20";

// ─── Empty States ────────────────────────────────────────────────────────────

/** Empty state hero — large centered content with icon + heading */
export const EMPTY_HERO =
  "flex flex-col items-center justify-center h-full text-center max-w-md mx-auto";

// ─── Menus and dropdowns ─────────────────────────────────────────────────────
//
// One look for everything that opens under a control: `ActionMenu`, `Select`,
// `ContextMenu`, the combobox, the snooze menus, the mention list. The panel
// is `.menu-panel` (index.css): solid, a hairline ring, a soft shadow, and
// `.menu-enter` for the 120 ms entrance. The rows below are the only row
// styles a menu may use, so every menu in the app reads the same.

/**
 * The floating panel. Scrolls past about ten rows, and never runs wider
 * than the window.
 */
export const MENU_PANEL =
  "menu-panel menu-enter p-1 min-w-[13rem] max-w-[min(20rem,calc(100vw-2rem))] max-h-[min(24rem,calc(100vh-4rem))] overflow-y-auto nice-scrollbar";

/**
 * One row. 44 px tall on a phone, 36 px from `sm`. The keyboard ring is
 * drawn inside the row, because the rows touch and an outside ring would be
 * cut off by the panel's edge. The tint on `:focus` (not only
 * `:focus-visible`) is what shows where the arrow keys start after a click
 * opened the menu, since the browser draws no ring for that.
 */
export const MENU_ITEM =
  "w-full min-h-[44px] sm:min-h-[36px] flex items-center gap-2.5 px-2.5 rounded-md text-sm font-medium text-left text-on-surface transition-colors hover:bg-surface-container-high focus:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary";

/** A destructive row: the error colour, on its own tint. */
export const MENU_ITEM_DANGER =
  "text-error hover:bg-error/10 focus:bg-error/10";

/** A row that is the current choice. */
export const MENU_ITEM_SELECTED = SELECTED_TINT;

/** A heading over a group of rows ("Snooze until", a provider's name). */
export const MENU_HEADING =
  "px-2.5 pt-2 pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant";

/** The line between two groups of rows. */
export const MENU_SEPARATOR = "my-1 h-px bg-outline-variant/50";

/** A hint at the end of a row: a shortcut, a count. */
export const MENU_HINT =
  "ml-auto pl-3 shrink-0 text-[11px] font-medium text-on-surface-variant tabular-nums";

/** The glyph before a row's label. */
export const MENU_ICON = "w-4 h-4 shrink-0 text-on-surface-variant";

/**
 * Dropdown container, positioned under its control and at least as wide.
 * `Combobox` and the users' row menu use it.
 */
export const DROPDOWN_MENU = cn(
  "absolute z-50 mt-1 w-max outline-none",
  MENU_PANEL,
  "min-w-full",
);

/** Dropdown standard item: the menu row. */
export const DROPDOWN_ITEM = cn(MENU_ITEM, "cursor-pointer");

// ─── Form Inputs ─────────────────────────────────────────────────────────────

/** Standard modal form label */
export const FORM_LABEL = cn(LABEL, "block mb-1.5");

/** Standard modal form input */
/**
 * 16px on a phone, 14px from `sm`. iOS Safari zooms the whole viewport when
 * a field under 16px takes focus, which on a bottom-sheet form means the
 * submit button leaves the screen mid-entry. The auth fields already follow
 * this rule; the app's other forms now do too.
 */
export const FORM_INPUT =
  "w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm bg-surface-container text-on-surface transition-colors";

/**
 * A field a model filled in — returns additional classes when a field was
 * auto-populated. AI-derived data, so the AI colour: its wash and a 1 px
 * inset edge, still. It used to be a pulsing primary glow, which said
 * "focus" and "loading" at once and never stopped.
 */
export const formInputHighlight = (hasValue: boolean) =>
  hasValue ? "bg-ai/10 ring-1 ring-inset ring-ai/40" : "";

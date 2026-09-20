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
 * anywhere in src/. Uppercase labels keep their tracking, a little tighter
 * than `tracking-widest`, so the larger size does not widen every chip.
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

/** Page title */
export const PAGE_TITLE = "text-2xl font-headline font-bold";

// ─── Layout ──────────────────────────────────────────────────────────────────

/** Card — the primary borderless white container (see also .card in CSS) */
export const CARD = "bg-surface-container-lowest rounded-2xl p-6 shadow-sm";

/** Card compact — slightly tighter padding */
export const CARD_COMPACT =
  "bg-surface-container-lowest rounded-2xl p-5 shadow-sm";

/** Section background — the mid-tone layer for headers / sidebars */
export const SECTION_BG = "bg-surface-container-low";

/** Tinted card — subtle primary wash (e.g. AI Intel block) */
export const CARD_TINTED =
  "bg-primary/5 rounded-2xl p-6 shadow-sm relative overflow-hidden";

// ─── Navigation ──────────────────────────────────────────────────────────────

/** Sidebar nav link — returns full className given active state */
export const navLink = (active: boolean, extra?: string) =>
  cn(
    "p-3 rounded-xl transition-colors",
    active
      ? "bg-primary/15 text-on-primary-wash"
      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
    extra,
  );

// ─── Buttons ─────────────────────────────────────────────────────────────────

/**
 * Icon button — small clickable icon (toolbar, header actions).
 * Use CSS `.btn-primary` / `.btn-secondary` for full CTA buttons.
 *
 * About 32 px on screen with a 16 px icon, and a 44 px tap box from
 * `hit-area` (see index.css). Give neighbours 12 px of gap so the boxes do
 * not overlap.
 */
export const ICON_BTN =
  "hit-area p-2 rounded-xl text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors";

/** Icon button, active/selected variant */
export const ICON_BTN_ACTIVE =
  "p-2 rounded-lg bg-primary text-on-primary shadow-sm transition-all";

/** Icon button, inactive variant (for toggle groups like composer type selector) */
export const ICON_BTN_INACTIVE =
  "p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-all";

/** Toggle icon button — returns className based on active state */
export const iconToggle = (active: boolean) =>
  active ? ICON_BTN_ACTIVE : ICON_BTN_INACTIVE;

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
  "hit-area inline-flex items-center gap-1 w-fit rounded-lg px-1.5 -mx-1.5 py-0.5 text-sm font-bold text-primary hover:bg-primary/10 transition-colors";

/** Danger text button — destructive inline action */
export const DANGER_BTN =
  "w-full text-xs text-error hover:text-error hover:bg-red-500/5 rounded-xl py-3 transition-colors font-bold uppercase tracking-widest flex items-center justify-center gap-2";

// ─── Badges & Pills ─────────────────────────────────────────────────────────

/** Tag pill — used in contact tags, filter indicators */
export const TAG_PILL =
  "text-[11px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-md";

/** Micro badge — tiny inline status labels (e.g. "Current", "work", "personal") */
export const MICRO_BADGE =
  "text-[11px] uppercase tracking-[0.08em] opacity-50 bg-surface-container px-1 rounded";

/** Status badge — success variant (e.g. "Current" on experience) */
export const STATUS_BADGE_SUCCESS =
  "text-[11px] uppercase tracking-[0.08em] bg-emerald-500/10 text-success px-1.5 py-0.5 rounded font-bold";

/** Source badge */
export const SOURCE_BADGE =
  "text-[11px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-md";

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Search input — the list-header search box. 44 px tall on a phone, 40 from `sm`. */
export const SEARCH_INPUT =
  "w-full bg-surface-container-low rounded-xl pl-9 pr-4 py-3 sm:py-2.5 text-sm focus:ring-2 focus:ring-primary/40 transition-all";

/** Inline editable field input — appears on click-to-edit */
export const EDITABLE_INPUT =
  "bg-surface-container-high border-none focus:ring-2 focus:ring-primary rounded px-2 py-0.5 max-w-full text-inherit font-inherit leading-inherit";

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

/** Filter pill button — returns className based on active state */
export const filterPill = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
    active
      ? "bg-primary/15 text-on-primary-wash ring-1 ring-inset ring-primary/30"
      : "text-on-surface-variant hover:bg-surface-container-high",
  );

// ─── List Items ──────────────────────────────────────────────────────────────

/**
 * Contact list row — returns className based on active state.
 *
 * The current row is a wash and a 1 px inset ring in the primary at half
 * strength. It used to be a 2 px solid ring with a shadow, which read as a
 * focus ring on every visit, and the keyboard focus ring on top of it made
 * two rings. `z-10` keeps the ring above the next row's hover tint.
 */
export const listRow = (active: boolean) =>
  cn(
    "flex items-center gap-3 p-3 rounded-xl transition-colors relative",
    active
      ? "bg-primary/10 ring-1 ring-inset ring-primary/50 z-10"
      : "hover:bg-surface-container-low",
  );

// ─── Timeline ────────────────────────────────────────────────────────────────

/**
 * Timeline entry card: the full-width card right of the date column. No
 * hover shadow, because the card itself is not a control. Its title button
 * and its kebab are.
 */
export const TIMELINE_CARD =
  "p-4 sm:p-5 rounded-2xl bg-surface-container-lowest shadow-sm";

// ─── Composer ────────────────────────────────────────────────────────────────

/**
 * Rich text composer container. No outer margin: the timeline puts its own
 * gap between the composer and the first group.
 */
export const COMPOSER =
  "bg-surface-container-lowest rounded-2xl p-4 shadow-sm z-20 transition-all focus-within:ring-2 focus-within:ring-primary/30 focus-within:shadow-md";

/** NLP action input (follow-up detector) */
export const NLP_INPUT_ROW =
  "flex items-center mt-3 bg-surface-container-low p-2 rounded-xl";

// ─── Empty States ────────────────────────────────────────────────────────────

/** Empty state container */
export const EMPTY_STATE =
  "text-center p-8 bg-surface-container-low rounded-2xl text-on-surface-variant";

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
export const MENU_ITEM_SELECTED = "bg-primary/10 text-primary";

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
export const FORM_LABEL =
  "block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5";

/** Standard modal form input */
/**
 * 16px on a phone, 14px from `sm`. iOS Safari zooms the whole viewport when
 * a field under 16px takes focus, which on a bottom-sheet form means the
 * submit button leaves the screen mid-entry. The auth fields already follow
 * this rule; the app's other forms now do too.
 */
export const FORM_INPUT =
  "w-full rounded-xl px-3.5 py-2.5 text-base sm:text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none bg-surface-container text-on-surface transition-shadow";

/** AI pre-fill glow — returns additional classes when a field was auto-populated */
export const formInputHighlight = (hasValue: boolean) =>
  hasValue
    ? "bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,113,156,0.3)] animate-pulse"
    : "";

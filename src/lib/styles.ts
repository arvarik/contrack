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

/** Micro label — field labels inside detail cards (e.g. "LOCATION", "EMAIL") */
export const LABEL =
  "text-[10px] font-bold uppercase tracking-widest text-on-surface-variant";

/** Primary micro label — highlighted labels (e.g. "NEXT FOLLOW UP") */
export const LABEL_PRIMARY =
  "text-[10px] font-bold uppercase tracking-widest text-primary";

/** Section heading — card titles (e.g. "DETAILS", "About", "Experience") */
export const SECTION_HEADING =
  "text-xs font-bold uppercase tracking-widest text-on-surface-variant";

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
      ? "bg-primary/15 text-primary"
      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high",
    extra,
  );

// ─── Buttons ─────────────────────────────────────────────────────────────────

/**
 * Icon button — small clickable icon (toolbar, header actions).
 * Use CSS `.btn-primary` / `.btn-secondary` for full CTA buttons.
 */
export const ICON_BTN =
  "p-2 rounded-xl text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors";

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

/** Danger text button — destructive inline action */
export const DANGER_BTN =
  "w-full text-xs text-error hover:text-error hover:bg-red-500/5 rounded-xl py-3 transition-colors font-bold uppercase tracking-widest flex items-center justify-center gap-2";

// ─── Badges & Pills ─────────────────────────────────────────────────────────

/** Tag pill — used in contact tags, filter indicators */
export const TAG_PILL =
  "text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full";

/** Micro badge — tiny inline status labels (e.g. "Current", "work", "personal") */
export const MICRO_BADGE =
  "text-[9px] uppercase tracking-widest opacity-50 bg-surface-container px-1 rounded";

/** Status badge — success variant (e.g. "Current" on experience) */
export const STATUS_BADGE_SUCCESS =
  "text-[9px] uppercase tracking-widest bg-emerald-500/10 text-success px-1.5 py-0.5 rounded font-bold";

/** Source badge */
export const SOURCE_BADGE =
  "text-[10px] text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full";

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Search input — the list-header search box */
export const SEARCH_INPUT =
  "w-full bg-surface-container-low rounded-xl pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-primary/40 transition-all";

/** Inline editable field input — appears on click-to-edit */
export const EDITABLE_INPUT =
  "bg-surface-container-high border-none focus:ring-2 focus:ring-primary rounded px-2 py-0.5 max-w-full text-inherit font-inherit leading-inherit";

// ─── Keyboard shortcut hints ─────────────────────────────────────────────────

/** Keyboard shortcut badge */
export const KBD =
  "bg-surface-container-high px-2 rounded-md text-xs font-mono";

/** Keyboard shortcut badge — smaller variant */
export const KBD_SM =
  "bg-surface-container-high px-1.5 rounded font-mono text-[9px] shadow-sm";

// ─── Filter Tabs ─────────────────────────────────────────────────────────────

/** Tab container — pill-style tab bar background */
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
    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all",
    active
      ? "bg-primary/15 text-primary ring-1 ring-inset ring-primary/30"
      : "text-on-surface-variant hover:bg-surface-container-high",
  );

// ─── List Items ──────────────────────────────────────────────────────────────

/** Contact list row — returns className based on active state */
export const listRow = (active: boolean) =>
  cn(
    "flex items-center gap-3 p-3 rounded-xl transition-all relative",
    active
      ? "bg-primary/8 ring-2 ring-inset ring-primary z-10 shadow-sm"
      : "hover:bg-surface-container-low",
  );

// ─── Timeline ────────────────────────────────────────────────────────────────

/** Timeline content box — the card next to the timeline marker */
export const TIMELINE_CARD =
  "p-5 rounded-2xl bg-surface-container-lowest shadow-sm hover:shadow-md transition-shadow relative group/card";

// ─── Composer ────────────────────────────────────────────────────────────────

/** Rich text composer container */
export const COMPOSER =
  "bg-surface-container-lowest rounded-2xl p-4 shadow-sm mb-8 z-20 transition-all focus-within:ring-2 focus-within:ring-primary/30 focus-within:shadow-md";

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

// ─── Dropdowns ───────────────────────────────────────────────────────────────

/** Dropdown container — floats above other elements, scrollable, glass-panel styled */
export const DROPDOWN_MENU =
  "absolute z-50 mt-1 max-h-56 w-max min-w-full overflow-y-auto rounded-xl glass-panel py-1.5 shadow-xl outline-none nice-scrollbar";

/** Dropdown standard item */
export const DROPDOWN_ITEM =
  "cursor-pointer px-4 py-2 text-sm font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors flex items-center";

// ─── Form Inputs ─────────────────────────────────────────────────────────────

/** Standard modal form label */
export const FORM_LABEL =
  "block text-[11px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5";

/** Standard modal form input */
export const FORM_INPUT =
  "w-full rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-primary/30 focus:outline-none bg-surface-container text-on-surface transition-shadow";

/** AI pre-fill glow — returns additional classes when a field was auto-populated */
export const formInputHighlight = (hasValue: boolean) =>
  hasValue
    ? "bg-primary/10 ring-2 ring-primary/50 shadow-[0_0_15px_rgba(0,113,156,0.3)] animate-pulse"
    : "";

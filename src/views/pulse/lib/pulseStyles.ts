/**
 * The type, the tones and the grid of the morning page. The sizes are
 * decisions, so they live in one file. 13 and 15 px are not on the app's
 * scale, so they stay here and no other page picks them up.
 */
import type { PulseColumn } from "../../../api/preferences";
import type { Tone } from "../../../lib/styles";
import type { UpNextGroup, UpNextItem } from "./upNext";

export const PULSE_TYPE = {
  cardTitle: "text-[15px] font-bold text-on-surface tracking-tight",
  /** The muted count after a card title. */
  cardCount: "text-[15px] font-semibold text-on-surface-variant tabular-nums",
  name: "text-sm font-semibold text-on-surface",
  /** The task or the fact in a row. */
  rowTitle: "text-sm text-on-surface",
  /** Meta text: dates, counts, hints. */
  meta: "text-[13px] text-on-surface-variant",
  group: "text-[13px] font-semibold text-on-surface-variant",
  /** The one large figure on a card: "9" of "9 of 10 within cadence". */
  figure: "text-2xl font-headline font-bold tabular-nums text-on-surface",
  /** The insight is a paragraph to read, so a size up from a row. */
  insight: "text-[15px] leading-relaxed text-on-surface",
} as const;

/** A list row on a Pulse card, not the queue. A plain fact uses it as is. */
export const PULSE_ROW_STATIC =
  "flex items-center gap-3 min-h-[44px] rounded-xl px-3 py-2.5 bg-surface-container-low/70";

/**
 * A row that opens one thing, so it lifts on hover. `lift` carries its own
 * transition: no `transition-*` class goes beside it. An Up next row takes
 * the state layer alone (STYLE.md, "Elevation").
 */
export const PULSE_ROW = `state-layer lift group ${PULSE_ROW_STATIC}`;

/** A fact at a row's right edge, "In 10 days". Its color is a `TONE_WASH`. */
export const PULSE_CHIP =
  "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap";

/**
 * An Up next check's ring at rest. A control's edge needs 3 to 1 (WCAG
 * 1.4.11): 40 percent measured 1.8 to 1, and 75 clears 3 to 1 on the wash
 * and the tint in both palettes (`tests/unit/frontend/pulse/contrast.test.ts`).
 */
export const CHECK_RING_REST = "border-current/75";

/** The tone of each Up next group, for its dot and its rows' glyphs. */
export const GROUP_TONE: Record<UpNextGroup, Tone> = {
  overdue: "error",
  today: "primary",
  thisWeek: "neutral",
  birthdays: "warning",
  "catch-up": "primary",
};

/** The tone of a due chip, by how soon its row is due. */
export const DUE_TONE: Record<UpNextItem["dueChip"]["variant"], Tone> = {
  urgent: "error",
  today: "primary",
  upcoming: "neutral",
  neutral: "neutral",
};

/**
 * The Composition donut: one hue, darkest for the largest slice. Not the AI
 * color, which marks AI-derived data.
 */
export const COMPOSITION_RAMP = {
  color: "var(--color-primary)",
  opacities: [1, 0.82, 0.64, 0.48, 0.34, 0.22] as readonly number[],
  other: "var(--color-surface-container-highest)",
} as const;

/**
 * The three columns, for the page, the skeleton and the route fallback.
 * Each column pads its cards by 4 px (`p-1`) for the drop ring and a lifted
 * card's shadow, and `-m-1` takes it back. The 16 px gap plus two paddings
 * make 24 px, the same as between cards in one column. From `xl` the middle
 * column is at least 19rem: at 257 px Coming up cut names and the
 * Composition switch spilled out.
 */
export const GRID_CLASSES =
  "grid grid-cols-1 lg:grid-cols-12 xl:grid-cols-[minmax(0,5fr)_minmax(19rem,3fr)_minmax(0,4fr)] gap-4 items-start -m-1";

/**
 * The order is Focus, Network, Intelligence up to `lg`, and Focus,
 * Intelligence, Network from `xl`. At `lg` Intelligence runs under the other
 * two, two cards across.
 */
export const COLUMN_CLASSES: Record<PulseColumn, string> = {
  focus: "order-1 lg:col-span-5 xl:col-span-1",
  network: "order-2 lg:col-span-7 xl:order-3 xl:col-span-1",
  intel:
    "order-3 lg:col-span-12 lg:grid lg:grid-cols-2 xl:flex xl:flex-col xl:order-2 xl:col-span-1",
};

// Customize: a moving card folds to its title, and its slot is as tall as
// the preview. A full-height slot for an 800 px Up next pushed the rest of a
// column off the screen.

/** The height of a card in the air, in px: its slot and its preview. */
export const DRAG_SLOT_HEIGHT = 64;

/**
 * The widest and the narrowest the preview gets, in px. Between the two it
 * takes the room from the card's left edge to the grip (`PulseGrid`).
 */
export const DRAG_PREVIEW_MAX_WIDTH = 320;
export const DRAG_PREVIEW_MIN_WIDTH = 200;

/**
 * The grip's middle from the preview's top right corner, so the grip sits
 * under the pointer that picked the card up.
 */
export const DRAG_GRIP_OFFSET = { right: 32, top: 32 } as const;

/** The slot a moving card leaves. The style guide allows a dashed edge here. */
export const DRAG_SLOT =
  "h-16 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5";

/** The preview under the pointer. It never turns or scales: that blurs text. */
export const DRAG_PREVIEW =
  "flex items-center gap-3 h-16 pl-4 pr-4 rounded-2xl bg-surface-container-lowest cursor-grabbing select-none shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_40%,transparent),0_18px_36px_-12px_rgb(0_0_0/0.35),0_6px_12px_-6px_rgb(0_0_0/0.16)]";

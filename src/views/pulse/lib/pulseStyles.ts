/**
 * The type, the tones and the grid of the morning page.
 *
 * A review of Pulse found 98 of 230 text nodes at 11 or 12 px, the date the
 * smallest text on the screen, and three columns of one width. The sizes
 * here are decisions, so they live in one file: a card title is 15 px
 * everywhere, a name is 14 px everywhere, and the page, its skeleton and the
 * route fallback draw the same three columns. Two of these sizes, 13 and
 * 15 px, are new on the app's scale and stay inside this object so no other
 * page picks them up by accident. The repository floor of 11 px stands. The
 * masthead's own sizes are the shared page header's (`PageHeader`).
 *
 * @module views/pulse/lib/pulseStyles
 */
import type { PulseColumn } from "../../../api/preferences";
import type { Tone } from "../../../lib/styles";
import type { UpNextGroup, UpNextItem } from "./upNext";

/** The type of the morning page. Sizes are decisions, so they live here. */
export const PULSE_TYPE = {
  /** A card's title. */
  cardTitle: "text-[15px] font-bold text-on-surface tracking-tight",
  /** The muted count after a card title. */
  cardCount: "text-[15px] font-semibold text-on-surface-variant tabular-nums",
  /** A person's name in a row. */
  name: "text-sm font-semibold text-on-surface",
  /** The task or the fact in a row. */
  rowTitle: "text-sm text-on-surface",
  /** Meta text: dates, counts, hints. */
  meta: "text-[13px] text-on-surface-variant",
  /** A group heading inside the queue. */
  group: "text-[13px] font-semibold text-on-surface-variant",
  /** The one large figure on a card: "9" of "9 of 10 within cadence". */
  figure: "text-2xl font-headline font-bold tabular-nums text-on-surface",
  /** The insight's own text. A paragraph a person reads, so a size up from a row. */
  insight: "text-[15px] leading-relaxed text-on-surface",
} as const;

/**
 * A row on the wash: the shape of every list row on a Pulse card that is
 * not the queue (Inbox, Coming up). No border and 44 px tall at least. A row
 * that is only a fact, such as a meeting, uses this as it is.
 */
export const PULSE_ROW_STATIC =
  "flex items-center gap-3 min-h-[44px] rounded-xl px-3 py-2.5 bg-surface-container-low/70";

/**
 * A row that goes somewhere. It has its own face and space around it, and a
 * press anywhere on it opens one thing, so it lifts on hover (`lift`, 1 px
 * and a soft shadow) and its face takes the state layer. `lift` carries its
 * own transition: no `transition-*` class goes on the same element. An Up
 * next row is one row of the queue, so it takes the state layer alone
 * (STYLE.md, "Elevation").
 */
export const PULSE_ROW = `state-layer lift group ${PULSE_ROW_STATIC}`;

/**
 * A chip: a fact at the right edge of a row, "In 10 days", "+12". No border
 * and no caps. Its colour is a tone, `TONE_WASH[tone]` beside it.
 */
export const PULSE_CHIP =
  "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap";

/**
 * The ring of an Up next check at rest: the group's ink at 75 percent. A
 * control's edge needs 3 to 1 (WCAG 1.4.11), and at 40 percent the ring
 * measured 1.8 to 1 on the row's wash. At 75 it clears 3 to 1 on the wash
 * and on the selected tint in both palettes, and stays a step under the
 * full ink of hover. `pulse.contrast.test.ts` measures it.
 */
export const CHECK_RING_REST = "border-current/75";

/**
 * The tone of each Up next group. The group's dot and its rows' leading
 * glyph read from it, so the eye can follow one colour down the queue.
 */
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
 * The Composition donut's ramp: one hue at six steps of opacity, the
 * largest slice darkest, and the neutral track tone for "Other". The AI
 * colour is not here: it marks AI-derived data, and a count of people by
 * industry is not that.
 */
export const COMPOSITION_RAMP = {
  color: "var(--color-primary)",
  opacities: [1, 0.82, 0.64, 0.48, 0.34, 0.22] as readonly number[],
  other: "var(--color-surface-container-highest)",
} as const;

/**
 * The three columns. The page, the skeleton and the fallback read these.
 * Each column pads its cards by 4 px (`p-1`), room for the drop ring in
 * Customize and for a lifted card's shadow. The grid's `-m-1` takes that
 * back, so a card's edge lines up with the title's. Its 16 px gap and the
 * two paddings make 24 px between cards in neighbouring columns, the same
 * as between cards in one column: at 1024 px the rows had 32 and 24.
 *
 * From `xl` the columns are 5, 3 and 4 parts, and the middle one is never
 * narrower than 19rem. Three twelfths was 257 px at 1280: Coming up cut
 * names to "Mary …", and the Composition switch spilled out of its card.
 */
export const GRID_CLASSES =
  "grid grid-cols-1 lg:grid-cols-12 xl:grid-cols-[minmax(0,5fr)_minmax(19rem,3fr)_minmax(0,4fr)] gap-4 items-start -m-1";

/**
 * One class string per column. The visual order is Focus, Network,
 * Intelligence on a phone and at `lg`, and Focus, Intelligence, Network at
 * `xl` and above, where each takes one of the grid's three tracks. Up next
 * is the job, so it has the widest. At `lg` the Intelligence column runs
 * under the other two and lays its cards out two across instead of four
 * full-width boxes.
 */
export const COLUMN_CLASSES: Record<PulseColumn, string> = {
  focus: "order-1 lg:col-span-5 xl:col-span-1",
  network: "order-2 lg:col-span-7 xl:order-3 xl:col-span-1",
  intel:
    "order-3 lg:col-span-12 lg:grid lg:grid-cols-2 xl:flex xl:flex-col xl:order-2 xl:col-span-1",
};

// ─── Customize: a card in the air ────────────────────────────────────────────
//
// A card that is being moved folds to its title. Its place in the column
// becomes a slot as tall as the preview under the pointer, so the gap that
// opens in the target column is the size of the thing in the hand. Up next
// can be 800 px tall: a slot of its full height pushed the rest of a column
// off the screen, and the pointer had to travel 400 px to pass it.

/** The height of a card in the air, in px: its slot and its preview. */
export const DRAG_SLOT_HEIGHT = 64;

/**
 * The widest and the narrowest the preview gets, in px. Between the two it
 * takes the room from the card's left edge to the grip (`PulseGrid`).
 */
export const DRAG_PREVIEW_MAX_WIDTH = 320;
export const DRAG_PREVIEW_MIN_WIDTH = 200;

/**
 * The middle of the preview's grip, from its top right corner: the 16 px
 * inset and half of the 32 px glyph box across, half of the 64 px preview
 * down. The preview is placed so the grip sits under the pointer that
 * picked the card up.
 */
export const DRAG_GRIP_OFFSET = { right: 32, top: 32 } as const;

/**
 * The slot a card leaves in its column while it moves: a dashed primary
 * outline on the primary wash, as tall as the preview. A dashed edge is the
 * one line the style guide allows for drag and drop.
 */
export const DRAG_SLOT =
  "h-16 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5";

/**
 * The preview under the pointer: the card's face, lifted. A primary hairline
 * and a deep soft shadow set it above the page in both palettes. It never
 * turns or scales: a turned card blurs its words.
 */
export const DRAG_PREVIEW =
  "flex items-center gap-3 h-16 pl-4 pr-4 rounded-2xl bg-surface-container-lowest cursor-grabbing select-none shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-primary)_40%,transparent),0_18px_36px_-12px_rgb(0_0_0/0.35),0_6px_12px_-6px_rgb(0_0_0/0.16)]";

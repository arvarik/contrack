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
 * A row that goes somewhere. The hover is the state layer over the wash, so
 * the row reads the same on a card, on the page and in both palettes.
 */
export const PULSE_ROW = `state-layer group ${PULSE_ROW_STATIC}`;

/**
 * A chip: a fact at the right edge of a row, "In 10 days", "+12". No border
 * and no caps. Its colour is a tone, `TONE_WASH[tone]` beside it.
 */
export const PULSE_CHIP =
  "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap";

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

/** The three columns. The page, the skeleton and the fallback read these. */
export const GRID_CLASSES =
  "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start";

/**
 * One class string per column. The visual order is Focus, Network,
 * Intelligence on a phone and at `lg`, and Focus, Intelligence, Network at
 * `xl` and above. Spans at `xl` are 5, 3, 4: Up next is the job, so it takes
 * the widest column. At `lg` the Intelligence column runs under the other
 * two and lays its cards out two across instead of four full-width boxes.
 */
export const COLUMN_CLASSES: Record<PulseColumn, string> = {
  focus: "order-1 lg:col-span-5",
  network: "order-2 lg:col-span-7 xl:order-3 xl:col-span-4",
  intel:
    "order-3 lg:col-span-12 lg:grid lg:grid-cols-2 xl:flex xl:flex-col xl:order-2 xl:col-span-3",
};

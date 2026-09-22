/**
 * The type and the grid of the morning page.
 *
 * A review of Pulse found 98 of 230 text nodes at 11 or 12 px, the date the
 * smallest text on the screen, and three columns of one width. The sizes
 * here are decisions, so they live in one file: a card title is 15 px
 * everywhere, a name is 14 px everywhere, and the page, its skeleton and the
 * route fallback draw the same three columns. Two of these sizes, 13 and
 * 15 px, are new on the app's scale and stay inside this object so no other
 * page picks them up by accident. The repository floor of 11 px stands.
 *
 * @module views/pulse/lib/pulseStyles
 */
import type { PulseColumn } from "../../../api/preferences";

/** The type of the morning page. Sizes are decisions, so they live here. */
export const PULSE_TYPE = {
  /** The page label, the h1. */
  label: "text-[13px] font-semibold text-on-surface-variant",
  /** The date line in the masthead. 24 px on a phone keeps "Wednesday, 24 September" on one line. */
  date: "text-2xl sm:text-[32px] leading-tight font-headline font-bold text-on-surface",
  /** The sentence under the date. */
  line: "text-base sm:text-lg leading-snug text-on-surface-variant",
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
  /** A chip's text. */
  chip: "text-xs font-semibold",
  /** A group heading inside the queue. */
  group: "text-[13px] font-semibold text-on-surface-variant",
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

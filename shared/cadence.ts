/**
 * How often a person wants to keep up with a tracked contact. Every menu
 * offers `CADENCE_CHOICES`: Weekly, Monthly, Quarterly (90 days, the account
 * default) and Yearly.
 *
 * The API takes any positive number of days. A value off the four choices
 * has words of its own ("Every 2 months"), and a menu shows it as one more
 * row (`cadenceOptions`), so a menu never claims a cadence the contact does
 * not have.
 *
 * Set when a contact is tracked (`applyTrackingRules` in
 * server/services/contactService). The score's recency signal and the
 * catch-up clock read it. This file imports nothing, so the server and the
 * client both read it.
 */

interface CadenceChoice {
  days: number;
  /** One word, for a menu and for the Track button: "Quarterly". */
  label: string;
}

/** The four cadences the app offers, from the most often to the least. */
export const CADENCE_CHOICES: readonly CadenceChoice[] = [
  { days: 7, label: "Weekly" },
  { days: 30, label: "Monthly" },
  { days: 90, label: "Quarterly" },
  { days: 365, label: "Yearly" },
] as const;

/**
 * Every value the Default cadence preference accepts: the four choices, and
 * 60 and 180 for preferences saved at either. The select shows such a value
 * as a fifth option until it changes.
 */
export const CADENCE_DAYS = [7, 30, 60, 90, 180, 365] as const;
export type CadenceDays = (typeof CADENCE_DAYS)[number];

/** The cadence a new account starts with. */
export const DEFAULT_CADENCE_DAYS: CadenceDays = 90;

/** The longest cadence a contact may have: ten years. */
export const MAX_CADENCE_DAYS = 3650;

export function isCadenceDays(value: unknown): value is CadenceDays {
  return (
    typeof value === "number" &&
    (CADENCE_DAYS as readonly number[]).includes(value)
  );
}

/** The units a cadence off the list is counted in, the largest first. */
const UNITS = [
  { days: 365, name: "year" },
  { days: 30, name: "month" },
  { days: 7, name: "week" },
  { days: 1, name: "day" },
] as const;

/**
 * How long a cadence off the list is, in the largest unit that divides it:
 * "2 months" for 60, "2 weeks" for 14, "45 days" for 45. A month is 30 days
 * here, as it is in the list.
 */
function span(days: number): string {
  const unit =
    Number.isInteger(days) && days > 0
      ? (UNITS.find((u) => days % u.days === 0) ?? UNITS[3])
      : UNITS[3];
  const count = days / unit.days;
  return `${count} ${unit.name}${count === 1 ? "" : "s"}`;
}

/** The word for a listed cadence, or null when it is off the list. */
const listedLabel = (days: number): string | null =>
  CADENCE_CHOICES.find((choice) => choice.days === days)?.label ?? null;

/**
 * A cadence in words: "Quarterly", or "Every 2 months" off the list.
 * `sentence: true` lowercases it for mid-sentence use: "Tracking Rowan Vale,
 * quarterly".
 */
export function describeCadence(
  days: number,
  { sentence = false }: { sentence?: boolean } = {},
): string {
  const text = listedLabel(days) ?? `Every ${span(days)}`;
  return sentence ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * The cadence as the Track button says it, in the fewest words: "Quarterly"
 * for a listed value, "2 months" for one off the list.
 */
export function shortCadence(days: number): string {
  return listedLabel(days) ?? span(days);
}

/**
 * The days a cadence menu lists: the four choices and each extra value it
 * must show, most often first, none twice. An extra that is not a positive
 * whole number is left out.
 */
export function cadenceOptions(...extra: number[]): number[] {
  const days = new Set(CADENCE_CHOICES.map((choice) => choice.days));
  for (const value of extra) {
    if (Number.isInteger(value) && value > 0) days.add(value);
  }
  return [...days].sort((a, b) => a - b);
}

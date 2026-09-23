/**
 * How often a person wants to keep up with a tracked contact.
 *
 * Track says who. Cadence says how often. The app offers four cadences, one
 * word each: Weekly, Monthly, Quarterly and Yearly. The Track menu on a
 * contact page, the bulk cadence menu on the Tracked page and the Default
 * cadence preference all read `CADENCE_CHOICES`.
 *
 * Quarterly stays on purpose. Ninety days is the account default
 * (`DEFAULT_CADENCE_DAYS`) and most tracked contacts already have it, so a
 * list without it would leave most contacts on a cadence the menu has no
 * name for.
 *
 * Before 2.0 the menus offered every 2 months (60 days) and every 6 months
 * (180 days) as well. What was saved then keeps working. The preference
 * still accepts both (`CADENCE_DAYS`, the accepted days, is a longer list
 * than the four choices), and the API takes any positive number of days for
 * a contact. A value off the four choices has words of its own ("Every 2
 * months"), and a menu shows it as one more row in its place in the order
 * (`cadenceOptions`), so a menu never claims a cadence the contact or the
 * account does not have.
 *
 * The cadence is set when a contact is tracked (see
 * `applyTrackingRules` in server/services/contactService), and the score's
 * recency signal and the catch-up clock both read it.
 *
 * This file imports nothing, so the server and the client both read it.
 *
 * @module shared/cadence
 */

export interface CadenceChoice {
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
 * Every value the Default cadence preference accepts, as a tuple the
 * preference schema can use: the four choices, and 60 and 180, which the
 * menus offered before 2.0. A preference saved at either still loads, and
 * the Default cadence select shows it as a fifth option until it changes.
 */
export const CADENCE_DAYS = [7, 30, 60, 90, 180, 365] as const;
export type CadenceDays = (typeof CADENCE_DAYS)[number];

/** The cadence a new account starts with. */
export const DEFAULT_CADENCE_DAYS: CadenceDays = 90;

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
 * A cadence in words.
 *
 * "Quarterly" for a listed value, "Every 2 months" or "Every 45 days" for
 * one off the list. `sentence: true` gives the lowercase form for the middle
 * of a sentence: "Tracking Ada Lovelace, quarterly" and "Ada Lovelace,
 * every 2 months".
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
 * The days a menu of cadences lists: the four choices, and each extra value
 * the menu has to show as well, such as a contact's cadence or a stored
 * preference off the list. In order, from the most often to the least, with
 * no value twice. An extra that is not a positive whole number of days is
 * left out.
 */
export function cadenceOptions(...extra: number[]): number[] {
  const days = new Set(CADENCE_CHOICES.map((choice) => choice.days));
  for (const value of extra) {
    if (Number.isInteger(value) && value > 0) days.add(value);
  }
  return [...days].sort((a, b) => a - b);
}

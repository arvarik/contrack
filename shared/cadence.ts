/**
 * How often a person wants to keep up with a tracked contact.
 *
 * Track says who. Cadence says how often. The five choices here are the
 * ones the app offers: the Default cadence preference, the cadence menu on a
 * contact page and the bulk cadence menu all read this list. The API keeps
 * taking any positive number of days, so a value off the list is possible
 * and `describeCadence` still gives it words.
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
  /** In title case, for a menu: "Every 3 months". */
  label: string;
}

export const CADENCE_CHOICES: readonly CadenceChoice[] = [
  { days: 30, label: "Every month" },
  { days: 60, label: "Every 2 months" },
  { days: 90, label: "Every 3 months" },
  { days: 180, label: "Every 6 months" },
  { days: 365, label: "Every year" },
] as const;

/** The days of each listed choice, as a tuple the preference schema can use. */
export const CADENCE_DAYS = [30, 60, 90, 180, 365] as const;
export type CadenceDays = (typeof CADENCE_DAYS)[number];

/** The cadence a new account starts with. */
export const DEFAULT_CADENCE_DAYS: CadenceDays = 90;

export function isCadenceDays(value: unknown): value is CadenceDays {
  return (
    typeof value === "number" &&
    (CADENCE_DAYS as readonly number[]).includes(value)
  );
}

/**
 * A cadence in words.
 *
 * "Every 3 months" for a listed value, "Every 45 days" for one off the list.
 * `sentence: true` gives the lowercase form for the middle of a sentence:
 * "Tracking Ada Lovelace, every 3 months".
 */
export function describeCadence(
  days: number,
  { sentence = false }: { sentence?: boolean } = {},
): string {
  const listed = CADENCE_CHOICES.find((choice) => choice.days === days);
  const text = listed
    ? listed.label
    : `Every ${days} day${days === 1 ? "" : "s"}`;
  return sentence ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

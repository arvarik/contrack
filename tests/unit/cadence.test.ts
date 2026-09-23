/**
 * The cadence choices and their words.
 *
 * The Default cadence preference, the Track menu on a contact page and the
 * bulk cadence menu all read `shared/cadence.ts`, so the list and the words
 * are pinned here once.
 *
 * The menus offer four words. A cadence saved before 2.0, 60 or 180 days,
 * or any other value the API took, keeps working: it has words of its own,
 * the preference still accepts 60 and 180, and a menu shows such a value as
 * one more row in its place in the order.
 */
import { describe, expect, it } from "vitest";
import {
  CADENCE_CHOICES,
  CADENCE_DAYS,
  DEFAULT_CADENCE_DAYS,
  cadenceOptions,
  describeCadence,
  isCadenceDays,
  shortCadence,
} from "../../shared/cadence";

describe("CADENCE_CHOICES", () => {
  it("offers weekly, monthly, quarterly and yearly, in that order", () => {
    expect(CADENCE_CHOICES.map((c) => c.days)).toEqual([7, 30, 90, 365]);
    expect(CADENCE_CHOICES.map((c) => c.label)).toEqual([
      "Weekly",
      "Monthly",
      "Quarterly",
      "Yearly",
    ]);
  });

  it("starts an account at quarterly, one of the four", () => {
    expect(DEFAULT_CADENCE_DAYS).toBe(90);
    expect(CADENCE_CHOICES.some((c) => c.days === DEFAULT_CADENCE_DAYS)).toBe(
      true,
    );
  });
});

describe("the accepted days", () => {
  it("are the four choices and the two values the menus offered before 2.0", () => {
    expect([...CADENCE_DAYS]).toEqual([7, 30, 60, 90, 180, 365]);
    for (const choice of CADENCE_CHOICES) {
      expect(isCadenceDays(choice.days), choice.label).toBe(true);
    }
    expect(isCadenceDays(60)).toBe(true);
    expect(isCadenceDays(180)).toBe(true);
  });

  it("refuse anything else", () => {
    expect(isCadenceDays(45)).toBe(false);
    expect(isCadenceDays(0)).toBe(false);
    expect(isCadenceDays("90")).toBe(false);
    expect(isCadenceDays(null)).toBe(false);
  });
});

describe("describeCadence", () => {
  it("gives a listed value its one word", () => {
    expect(describeCadence(7)).toBe("Weekly");
    expect(describeCadence(30)).toBe("Monthly");
    expect(describeCadence(90)).toBe("Quarterly");
    expect(describeCadence(365)).toBe("Yearly");
  });

  it("counts a value off the list in the largest unit that divides it", () => {
    expect(describeCadence(60)).toBe("Every 2 months");
    expect(describeCadence(180)).toBe("Every 6 months");
    expect(describeCadence(14)).toBe("Every 2 weeks");
    expect(describeCadence(730)).toBe("Every 2 years");
    expect(describeCadence(45)).toBe("Every 45 days");
    expect(describeCadence(1)).toBe("Every 1 day");
  });

  it("lowercases the first letter for the middle of a sentence", () => {
    // The toasts: "Tracking Ada Lovelace, quarterly", "Ada Lovelace, every
    // 2 months", "3 contacts, monthly".
    expect(describeCadence(90, { sentence: true })).toBe("quarterly");
    expect(describeCadence(60, { sentence: true })).toBe("every 2 months");
    expect(describeCadence(45, { sentence: true })).toBe("every 45 days");
  });
});

describe("shortCadence", () => {
  it("is the word for a listed value and the span for any other", () => {
    expect(shortCadence(90)).toBe("Quarterly");
    expect(shortCadence(7)).toBe("Weekly");
    expect(shortCadence(60)).toBe("2 months");
    expect(shortCadence(180)).toBe("6 months");
    expect(shortCadence(45)).toBe("45 days");
  });
});

describe("cadenceOptions", () => {
  it("is the four choices when nothing else has to show", () => {
    expect(cadenceOptions()).toEqual([7, 30, 90, 365]);
    expect(cadenceOptions(90)).toEqual([7, 30, 90, 365]);
  });

  it("puts a value off the list in its place in the order, once", () => {
    expect(cadenceOptions(60)).toEqual([7, 30, 60, 90, 365]);
    expect(cadenceOptions(180, 180)).toEqual([7, 30, 90, 180, 365]);
    expect(cadenceOptions(45, 730)).toEqual([7, 30, 45, 90, 365, 730]);
  });

  it("leaves out a value that is not a positive whole number of days", () => {
    expect(cadenceOptions(0, -30, 1.5, Number.NaN)).toEqual([7, 30, 90, 365]);
  });
});

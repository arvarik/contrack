/**
 * The cadence choices and their words.
 *
 * The Default cadence preference, the cadence menu on a contact page and the
 * bulk cadence menu all read `shared/cadence.ts`, so the list and the words
 * are pinned here once.
 */
import { describe, expect, it } from "vitest";
import {
  CADENCE_CHOICES,
  CADENCE_DAYS,
  DEFAULT_CADENCE_DAYS,
  describeCadence,
  isCadenceDays,
  shortCadence,
} from "../../shared/cadence";

describe("CADENCE_CHOICES", () => {
  it("offers a month, two, three, six and a year, in that order", () => {
    expect(CADENCE_CHOICES.map((c) => c.days)).toEqual([30, 60, 90, 180, 365]);
    expect([...CADENCE_DAYS]).toEqual([30, 60, 90, 180, 365]);
    expect(CADENCE_CHOICES.map((c) => c.label)).toEqual([
      "Every month",
      "Every 2 months",
      "Every 3 months",
      "Every 6 months",
      "Every year",
    ]);
  });

  it("starts an account at every 3 months", () => {
    expect(DEFAULT_CADENCE_DAYS).toBe(90);
    expect(isCadenceDays(90)).toBe(true);
    expect(isCadenceDays(45)).toBe(false);
    expect(isCadenceDays("90")).toBe(false);
  });
});

describe("describeCadence", () => {
  it("gives a listed value its label", () => {
    expect(describeCadence(30)).toBe("Every month");
    expect(describeCadence(365)).toBe("Every year");
  });

  it("gives a value off the list its days", () => {
    expect(describeCadence(45)).toBe("Every 45 days");
    expect(describeCadence(1)).toBe("Every 1 day");
  });

  it("lowercases the first letter for the middle of a sentence", () => {
    expect(describeCadence(90, { sentence: true })).toBe("every 3 months");
    expect(describeCadence(45, { sentence: true })).toBe("every 45 days");
  });
});

describe("shortCadence", () => {
  it("gives a chip two or three characters", () => {
    expect(shortCadence(30)).toBe("1 mo");
    expect(shortCadence(60)).toBe("2 mo");
    expect(shortCadence(90)).toBe("3 mo");
    expect(shortCadence(180)).toBe("6 mo");
    expect(shortCadence(365)).toBe("1 yr");
  });

  it("falls back to days for a value off the list", () => {
    expect(shortCadence(45)).toBe("45 d");
    expect(shortCadence(7)).toBe("7 d");
  });
});

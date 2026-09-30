// =============================================================================
// The seven questions every network can ask, and the facets that answer them
// =============================================================================
// The starter pool is built from a network's own values. These seven do not
// depend on any value: how long since you spoke, who you track, whose details
// are old or missing. Each is a fixed question with the facets the app
// already uses for the same thing, so the search answers it with no model and
// the answer is the list the Pulse Inbox and the palette open.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  GENERAL_QUESTIONS,
  generalQuestionFor,
  normalizeQuestion,
} from "../../../shared/generalQuestions";
import { facetFiltersSchema } from "../../../shared/searchFacets";

describe("GENERAL_QUESTIONS", () => {
  it("holds seven questions, each asked once and each with a facet", () => {
    expect(GENERAL_QUESTIONS).toHaveLength(7);
    const texts = GENERAL_QUESTIONS.map((q) => q.text);
    expect(new Set(texts).size).toBe(7);
    expect(new Set(texts.map(normalizeQuestion)).size).toBe(7);
    for (const question of GENERAL_QUESTIONS) {
      expect(question.filters.length, question.text).toBeGreaterThan(0);
    }
  });

  it("reads as questions a person would ask, and ends each with a question mark", () => {
    for (const { text } of GENERAL_QUESTIONS) {
      expect(text, text).toMatch(/^(Who|Whose) .+\?$/);
    }
  });

  it("uses only facets the search request accepts", () => {
    for (const question of GENERAL_QUESTIONS) {
      const parsed = facetFiltersSchema.safeParse(
        question.filters.map((filter) => ({ ...filter })),
      );
      expect(parsed.success, question.text).toBe(true);
    }
  });

  it("names the same facets as the links in the Pulse Inbox", () => {
    const byText = (text: string) =>
      GENERAL_QUESTIONS.find((q) => q.text === text)?.filters;
    expect(byText("Who is missing a location?")).toEqual([
      { field: "missing", value: "location" },
    ]);
    expect(byText("Who is missing an email address?")).toEqual([
      { field: "missing", value: "email" },
    ]);
    expect(byText("Who am I not tracking yet?")).toEqual([
      { field: "tracked", value: "no" },
    ]);
    expect(
      byText("Whose details haven't been updated in over 6 months?"),
    ).toEqual([{ field: "updated", operator: ">", value: "6m" }]);
  });
});

describe("generalQuestionFor", () => {
  it("recognises each question as the page writes it", () => {
    for (const question of GENERAL_QUESTIONS) {
      expect(generalQuestionFor(question.text), question.text).toBe(question);
    }
  });

  it("ignores case, the question mark, extra spaces and a curly apostrophe", () => {
    const question = GENERAL_QUESTIONS.find((q) =>
      q.text.includes("haven't I"),
    );
    expect(question).toBeDefined();
    for (const typed of [
      "who haven't i contacted in over 3 months",
      "  Who   haven’t I contacted in over 3 months?  ",
      "WHO HAVENT I CONTACTED IN OVER 3 MONTHS?",
    ]) {
      expect(generalQuestionFor(typed), typed).toBe(question);
    }
  });

  it("leaves every other question to the rest of the search", () => {
    for (const typed of [
      "Who haven't I contacted in over 4 months?",
      "Who haven't I contacted in over 3 months in Lisbon?",
      "Who is missing a company?",
      "Who do I know in Berlin?",
      "track",
      "",
      "   ",
    ]) {
      expect(generalQuestionFor(typed), typed).toBeNull();
    }
  });

  it("does not let the caller change a question by editing what it gets back", () => {
    const first = generalQuestionFor("Who do I track?");
    expect(first).not.toBeNull();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.filters)).toBe(true);
  });
});

describe("normalizeQuestion", () => {
  it("folds case, apostrophes, punctuation and spaces", () => {
    expect(normalizeQuestion("  Who   haven’t I… contacted?! ")).toBe(
      "who havent i contacted",
    );
    expect(normalizeQuestion("Who's missing?")).toBe("whos missing");
  });
});

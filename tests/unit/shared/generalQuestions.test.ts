// =============================================================================
// The seven questions every network can ask, and how a typed question matches
// =============================================================================
// Which people each question finds is pinned in
// tests/integration/search.starterQuestions.test.ts, through the real search.
// These check the table's rows and the match on the words.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  GENERAL_QUESTIONS,
  generalQuestionFor,
} from "../../../shared/generalQuestions";
import { facetFiltersSchema } from "../../../shared/searchFacets";

describe("GENERAL_QUESTIONS", () => {
  it("writes each row as a question, with facets the search request accepts", () => {
    for (const { text, filters } of GENERAL_QUESTIONS) {
      expect(text).toMatch(/^(Who|Whose) .+\?$/);
      expect(filters.length, text).toBeGreaterThan(0);
      expect(facetFiltersSchema.safeParse(filters).success, text).toBe(true);
    }
  });
});

describe("generalQuestionFor", () => {
  it("matches a question whatever its case, spacing, punctuation or apostrophe", () => {
    for (const question of GENERAL_QUESTIONS) {
      expect(generalQuestionFor(question.text), question.text).toBe(question);
    }
    const contacted = GENERAL_QUESTIONS.find((q) =>
      q.text.includes("haven't I"),
    );
    expect(contacted).toBeDefined();
    for (const typed of [
      "who haven't i contacted in over 3 months",
      "  Who   haven’t I… contacted in over 3 months?!  ",
      "WHO HAVENT I CONTACTED IN OVER 3 MONTHS?",
    ]) {
      expect(generalQuestionFor(typed), typed).toBe(contacted);
    }
  });

  it("leaves every other question to the rest of the search", () => {
    for (const typed of [
      "Who haven't I contacted in over 4 months?",
      "Who haven't I contacted in over 3 months in Lisbon?",
      "Who is missing a company?",
      "track",
      "   ",
    ]) {
      expect(generalQuestionFor(typed), typed).toBeNull();
    }
  });
});

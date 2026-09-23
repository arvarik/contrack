// =============================================================================
// Ask Contrack's suggested questions, built from the person's own network
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  FIXED_QUESTIONS,
  suggestedQuestions,
} from "../../src/views/search/suggestions";

const person = (
  over: Partial<{
    industry: string | null;
    location: string | null;
    company: string | null;
    isGhost: boolean;
  }> = {},
) => ({
  industry: null,
  location: null,
  company: null,
  isGhost: false,
  ...over,
});

describe("suggestedQuestions", () => {
  it("asks about the network's most common industry, city and company first", () => {
    const questions = suggestedQuestions([
      person({
        industry: "Music Streaming",
        location: "Austin, TX",
        company: "Pied Piper",
      }),
      person({
        industry: "Music Streaming",
        location: "Austin, TX",
        company: "Pied Piper",
      }),
      person({
        industry: "Finance",
        location: "Sydney, Australia",
        company: "Hooli",
      }),
    ]);
    expect(questions.slice(0, 3)).toEqual([
      "Who works in Music Streaming?",
      "Who do I know in Austin?",
      "Who works at Pied Piper?",
    ]);
    expect(questions).toHaveLength(6);
    expect(questions.slice(3)).toEqual(FIXED_QUESTIONS.slice(0, 3));
  });

  it("skips a fact that only one person has, and does not count ghosts", () => {
    const questions = suggestedQuestions([
      person({ industry: "Finance", company: "Hooli" }),
      person({ industry: "Design", company: "Hooli", isGhost: true }),
      person({ industry: "Design", company: "Initech" }),
    ]);
    // Finance, Design and each company appear once among the real people.
    expect(questions).toEqual(FIXED_QUESTIONS.slice(0, 6));
  });

  it("falls back to the fixed examples before the network loads", () => {
    expect(suggestedQuestions([])).toEqual([...FIXED_QUESTIONS]);
  });

  it("never suggests a question People search cannot answer", () => {
    // People search reads profiles, not dates.
    for (const q of FIXED_QUESTIONS) expect(q).not.toMatch(/contacted/i);
  });
});

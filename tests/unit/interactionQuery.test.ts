// =============================================================================
// Unit Tests — the MATCH expression a question becomes
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  QUESTION_WORDS,
  compileInteractionMatch,
} from "../../server/services/search/interactionQuery.ts";

describe("compileInteractionMatch", () => {
  it("drops the words that make a question a question", () => {
    expect(compileInteractionMatch("Who discussed hiring?")).toEqual({
      tokens: ["hiring"],
      strict: '"hiring"*',
      loose: null,
    });
  });

  it("matches every word first, and offers any word as the fallback", () => {
    expect(compileInteractionMatch("hiring plans Berlin")).toEqual({
      tokens: ["hiring", "plans", "Berlin"],
      strict: '"hiring"* AND "plans"* AND "Berlin"*',
      loose: '"hiring"* OR "plans"* OR "Berlin"*',
    });
  });

  it("keeps kinds of note as words, since a note can be about one", () => {
    expect(compileInteractionMatch("meeting about the call").tokens).toEqual([
      "meeting",
      "call",
    ]);
  });

  it("has nothing to match when every word is a question word", () => {
    expect(compileInteractionMatch("who did I talk to")).toEqual({
      tokens: [],
      strict: null,
      loose: null,
    });
  });

  it("can be told to search for the question words after all", () => {
    expect(compileInteractionMatch("who did I talk to", true).tokens).toEqual([
      "who",
      "did",
      "I",
      "talk",
      "to",
    ]);
  });

  it("treats FTS syntax as words, never as operators", () => {
    // "or" is a question word and goes; "NOT" is not one and stays, quoted.
    const out = compileInteractionMatch('hiring OR NOT "plans" -berlin col:x');
    expect(out.tokens).toEqual([
      "hiring",
      "NOT",
      "plans",
      "berlin",
      "col",
      "x",
    ]);
    for (const token of out.tokens) expect(out.strict).toContain(`"${token}"`);
    expect(out.strict).not.toMatch(/(^|\s)(OR|NOT)(\s|$)/);
    expect(out.strict).not.toContain("col:");
  });

  it("makes a one-letter word an exact term, not a prefix", () => {
    expect(compileInteractionMatch("plan b").strict).toBe('"plan"* AND "b"');
  });

  it("keeps accented letters, which the tokenizer folds on both sides", () => {
    expect(compileInteractionMatch("café").strict).toBe('"café"*');
  });

  it("names its question words in lower case only", () => {
    for (const word of QUESTION_WORDS) expect(word).toBe(word.toLowerCase());
    expect(compileInteractionMatch("WHO Discussed Hiring").tokens).toEqual([
      "Hiring",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { firstSentence, sentenceCase } from "../../src/views/pulse/lib/insight";

describe("pulse.insight", () => {
  it("puts the model's Title Case category in sentence case", () => {
    expect(sentenceCase("Relationship Maintenance")).toBe(
      "Relationship maintenance",
    );
    expect(sentenceCase("  network   growth ")).toBe("Network growth");
    expect(sentenceCase("Strategy")).toBe("Strategy");
  });

  it("keeps an acronym and a name with inner capitals as the model spelled them", () => {
    expect(sentenceCase("AI Adoption")).toBe("AI adoption");
    expect(sentenceCase("Outreach On LinkedIn")).toBe("Outreach on LinkedIn");
    // Each part of a hyphenated word counts as a word.
    expect(sentenceCase("Follow-Up Strategy")).toBe("Follow-up strategy");
    expect(sentenceCase("AI-Powered Outreach")).toBe("AI-powered outreach");
    expect(sentenceCase("Re-Engage Dormant Ties")).toBe(
      "Re-engage dormant ties",
    );
    expect(sentenceCase("Follow Up With CRM Data")).toBe(
      "Follow up with CRM data",
    );
  });

  it("asks the first sentence, cut at a word near 120 characters", () => {
    expect(firstSentence("Three went quiet. Two are founders.")).toBe(
      "Three went quiet",
    );
    const long = `${"word ".repeat(40)}end.`;
    const question = firstSentence(long);
    expect(question.length).toBeLessThanOrEqual(120);
    expect(question.endsWith("word")).toBe(true);
  });
});

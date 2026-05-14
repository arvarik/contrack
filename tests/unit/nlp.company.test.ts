import { describe, it, expect } from "vitest";
import { normalizeCompany } from "../../server/utils/nlp/company.ts";

describe("NLP Company", () => {
  describe("normalizeCompany", () => {
    it("strips common corporate suffixes", () => {
      expect(normalizeCompany("Acme Corp")).toBe("acme");
      expect(normalizeCompany("Acme Corp.")).toBe("acme");
      expect(normalizeCompany("Apple, Inc.")).toBe("apple");
      expect(normalizeCompany("McKinsey & Company")).toBe("mckinsey and");
    });

    it("handles multiple stacked suffixes", () => {
      expect(normalizeCompany("Acme Holdings Group LLC")).toBe("acme");
    });

    it("handles empty strings and punctuation", () => {
      expect(normalizeCompany("")).toBe("");
      expect(normalizeCompany("A.B.C.")).toBe("a b c");
    });
  });
});

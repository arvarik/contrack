// =============================================================================
// Unit tests: Ask Contrack query intent (classifyQuery, nameSignals)
// =============================================================================
// The kind decides whether a model runs at all. Names, emails, phone numbers
// and quoted phrases are answered locally. The traps are the ones that cost
// an answer: a company that reads like a name, and a question that contains
// one.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  classifyQuery,
  nameSignals,
  NAME_SIGNAL_SCORE,
  type NamedResult,
} from "../../server/services/search/intent.ts";

const kindOf = (query: string, results: NamedResult[] = []) =>
  classifyQuery(query, nameSignals(query, results)).kind;

describe("classifyQuery: kinds that need no results", () => {
  it.each([
    ["ada@example.com", "email"],
    ["  Ada.Lovelace+crm@mail.example.co.uk ", "email"],
    ["+1 (415) 555-1234", "phone"],
    ["4155551234", "phone"],
    ["415.555.1234", "phone"],
    ['"rock climbing"', "quoted"],
    ["“rock climbing”", "quoted"],
  ])("%s is %s, and local", (query, kind) => {
    const intent = classifyQuery(query);
    expect(intent.kind).toBe(kind);
    expect(intent.local).toBe(true);
    expect(intent.weights).toEqual({ lexical: 0.7, dense: 0.3 });
  });

  it("needs seven digits for a phone number", () => {
    expect(classifyQuery("555-1234").kind).toBe("phone");
    expect(classifyQuery("555-123").kind).toBe("mixed");
  });

  it("does not read an email inside a sentence as an email query", () => {
    expect(classifyQuery("who emailed ada@example.com").kind).toBe(
      "conceptual",
    );
  });

  it("does not read two quoted phrases as one", () => {
    expect(classifyQuery('"rock" and "climbing"').kind).not.toBe("quoted");
  });
});

describe("classifyQuery: names", () => {
  it("is a name when every result's name starts with the tokens", () => {
    expect(kindOf("Ada Lov", [{ name: "Ada Lovelace" }])).toBe("name");
    expect(
      kindOf("ada", [{ name: "Ada Lovelace" }, { name: "Ada Yonath" }]),
    ).toBe("name");
  });

  it("folds accents on both sides", () => {
    expect(kindOf("Jose Garcia", [{ name: "José García" }])).toBe("name");
  });

  it("is a name when a close approximate name was found", () => {
    const typo: NamedResult = {
      name: "Jonathan Smith",
      approximate: true,
      score: 0.91,
    };
    expect(kindOf("Jonathon Smyth", [typo])).toBe("name");
    expect(
      kindOf("Jonathon Smyth", [{ ...typo, score: NAME_SIGNAL_SCORE - 0.01 }]),
    ).toBe("mixed");
  });

  it("is a name when the first token is a known nickname a result carries", () => {
    expect(
      kindOf("Bob Carter", [{ name: "Robert Carter" }, { name: "Bea Carter" }]),
    ).toBe("name");
  });

  it("has at most four tokens", () => {
    expect(
      kindOf("Ada Augusta King Lovelace Byron", [
        { name: "Ada Augusta King Lovelace Byron" },
      ]),
    ).not.toBe("name");
  });

  it("needs a result: an unknown name is not a local answer", () => {
    expect(kindOf("Zyx Qwerty", [])).toBe("mixed");
  });

  it("trap: a company that looks like a name is not a name", () => {
    // People at Morgan Stanley. Their names carry neither word.
    expect(
      kindOf("Morgan Stanley", [{ name: "Priya Raman" }, { name: "Tom Hale" }]),
    ).toBe("mixed");
  });

  it("trap: a question that contains a name is not a name", () => {
    expect(kindOf("who is Ada Lovelace", [{ name: "Ada Lovelace" }])).toBe(
      "conceptual",
    );
    // With a strong name signal it is still not a name. The model checks it.
    expect(
      kindOf("who is Ada Lovelace", [
        { name: "Ada Lovelace", approximate: true, score: 0.95 },
      ]),
    ).toBe("mixed");
  });
});

describe("classifyQuery: questions", () => {
  it.each([
    ["someone who knows about beekeeping", "conceptual"],
    ["who works in fintech", "conceptual"],
    ["people I haven't talked to in 3 months", "conceptual"],
    ["product manager at Northwind Logistics", "conceptual"],
    ["investors in Berlin", "mixed"],
    ["fintech", "mixed"],
  ])("%s is %s", (query, kind) => {
    const intent = classifyQuery(query);
    expect(intent.kind).toBe(kind);
    expect(intent.local).toBe(false);
  });

  it("weights the channels by kind", () => {
    expect(classifyQuery("who works in fintech").weights).toEqual({
      lexical: 0.3,
      dense: 0.7,
    });
    expect(classifyQuery("investors in Berlin").weights).toEqual({
      lexical: 0.5,
      dense: 0.5,
    });
  });

  it("returns the folded tokens", () => {
    expect(classifyQuery("Zoë in MÜNCHEN").tokens).toEqual([
      "zoe",
      "in",
      "munchen",
    ]);
  });
});

describe("nameSignals", () => {
  it("reports nothing for no results", () => {
    expect(nameSignals("Ada", [])).toEqual({
      namesStartWithTokens: false,
      bestApproximateScore: 0,
      givenNameHit: false,
    });
  });

  it("takes the best approximate score and ignores exact rows' scores", () => {
    expect(
      nameSignals("Kristof Novak", [
        { name: "Krzysztof Nowak", approximate: true, score: 0.8 },
        { name: "Kristina Novak", approximate: true, score: 0.87 },
        { name: "Kristof Anders", score: 0.99 },
      ]).bestApproximateScore,
    ).toBe(0.87);
  });

  it("finds a given name only in a result's name", () => {
    expect(nameSignals("Maria", [{ name: "Chen Wei" }]).givenNameHit).toBe(
      false,
    );
    expect(nameSignals("Maria", [{ name: "Maria Chen" }]).givenNameHit).toBe(
      true,
    );
  });
});

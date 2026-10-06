// Unit tests: the fields that answer an Ask question (matchedOn.ts)

import { describe, expect, it } from "vitest";
import {
  MAX_MATCHED,
  explainMatch,
  findMarks,
  questionTerms,
  windowed,
  type MatchedContact,
} from "../../../../server/services/search/matchedOn.ts";
import type { MatchedOn } from "../../../../shared/matchedOn.ts";

const now = new Date("2026-09-26T12:00:00Z");

/** The marked words of a matched field, in order. */
const marked = (entry: MatchedOn) =>
  entry.marks.map(([a, b]) => entry.text.slice(a, b));

const person = (fields: Partial<MatchedContact>): MatchedContact => ({
  role: null,
  headline: null,
  company: null,
  industry: null,
  location: null,
  about: null,
  preferences: null,
  lastContactedAt: null,
  interests: [],
  tags: [],
  experience: [],
  education: [],
  ...fields,
});

describe("questionTerms", () => {
  it("keeps the words that name something, not the ones that ask", () => {
    const terms = questionTerms("Who is interested in machine learning?");
    expect(findMarks("Machine Learning", terms)).toEqual([[0, 16]]);
    for (const asking of ["Who", "is", "interested", "in"])
      expect(findMarks(asking, terms), asking).toEqual([]);
  });

  it("has no words for a question made only of asking words", () => {
    expect(questionTerms("Who do I know?").pattern).toBeNull();
    expect(questionTerms("").pattern).toBeNull();
  });

  it("finds the other forms of a word, and initialisms both ways", () => {
    const designers = questionTerms("designers in Lisbon");
    expect(findMarks("Head of Design", designers)).toEqual([[8, 14]]);
    const ml = questionTerms("who knows ML");
    expect(findMarks("Machine learning at scale", ml)).toEqual([[0, 16]]);
    const long = questionTerms("anyone in venture capital");
    expect(findMarks("VC associate", long)).toEqual([[0, 2]]);
  });

  it("matches whole words only", () => {
    const terms = questionTerms("who likes art");
    expect(findMarks("Artificial intelligence", terms)).toEqual([]);
    expect(findMarks("Street art and murals", terms)).toEqual([[7, 10]]);
  });

  it("marks the letters of the contact's own text, accents and all", () => {
    const terms = questionTerms("people in zurich or koln");
    const text = "Moved from Zürich to Köln";
    const marks = findMarks(text, terms);
    expect(marks.map(([a, b]) => text.slice(a, b))).toEqual(["Zürich", "Köln"]);
    // A text whose folding changes its length keeps its offsets too.
    const sharp = "Straße 5, Zürich";
    expect(findMarks(sharp, terms).map(([a, b]) => sharp.slice(a, b))).toEqual([
      "Zürich",
    ]);
  });

  it("reads what the question leans on", () => {
    expect(questionTerms("who is into jazz").focus).toBe("liking");
    expect(questionTerms("who works in fintech").focus).toBe("work");
    expect(questionTerms("jazz fintech").focus).toBeNull();
  });
});

describe("explainMatch", () => {
  const ml = questionTerms("Who is interested in machine learning?");

  it("lists interests before a role for a question about liking", () => {
    const both = person({
      role: "ML Engineer",
      interests: [{ interest: "machine learning" }],
    });
    expect(explainMatch(both, ml).map((m) => m.field)).toEqual([
      "interest",
      "role",
    ]);
    const work = questionTerms("Who works in machine learning?");
    expect(explainMatch(both, work).map((m) => m.field)).toEqual([
      "role",
      "interest",
    ]);
  });

  it("puts what a filter or the AI check proved first, and says so", () => {
    const contact = person({
      role: "Analyst",
      location: "Lisbon, Portugal",
      about: "Builds machine learning models for fraud.",
    });
    const entries = explainMatch(contact, ml, [
      { evidence: { field: "location" }, how: "filter" },
      {
        evidence: { field: "about", value: "machine learning models" },
        how: "ai",
      },
    ]);
    expect(entries.map((m) => [m.field, m.how])).toEqual([
      ["location", "filter"],
      ["about", "ai"],
    ]);
    expect(entries[0]!.text).toBe("Lisbon, Portugal");
    expect(marked(entries[1]!)).toEqual(["machine learning"]);
  });

  it("names the matching items of a list field, marked ones first", () => {
    const [entry] = explainMatch(
      person({
        tags: [
          { tag: "friend" },
          { tag: "ml-reading-group" },
          { tag: "machine learning" },
        ],
      }),
      ml,
    );
    expect(entry!.field).toBe("tag");
    expect(entry!.text).toBe("ml-reading-group, machine learning");
    expect(marked(entry!)).toEqual(["ml", "machine learning"]);
  });

  it("finds the words in a job or a school", () => {
    const [job] = explainMatch(
      person({
        experience: [
          { role: "Barista", company: "Blue Bottle" },
          {
            role: "Research Intern",
            company: "DeepMind",
            description: "Machine learning for proteins",
          },
        ],
      }),
      ml,
    );
    expect(job!.field).toBe("experience");
    expect(job!.text).toBe(
      "Research Intern at DeepMind: Machine learning for proteins",
    );
    const [school] = explainMatch(
      person({
        education: [
          { school: "MIT", degree: "MS", fieldOfStudy: "Machine Learning" },
        ],
      }),
      ml,
    );
    expect(school).toMatchObject({
      field: "education",
      text: "MIT, MS, Machine Learning",
    });
  });

  it("cuts a long field to a line around its first mark", () => {
    const about = `${"Grew up by the sea and sailed every summer. ".repeat(4)}Now leads machine learning research at a lab. ${"Loves long walks. ".repeat(6)}`;
    const [entry] = explainMatch(person({ about }), ml);
    expect(entry!.field).toBe("about");
    expect(entry!.text.length).toBeLessThanOrEqual(112);
    expect(entry!.text.startsWith("…")).toBe(true);
    expect(entry!.text.endsWith("…")).toBe(true);
    expect(marked(entry!)).toEqual(["machine learning"]);
  });

  it("falls back to the passage close in meaning, marked as such", () => {
    const entries = explainMatch(
      person({ role: "Researcher" }),
      ml,
      [],
      [{ field: "about", text: "Works on deep neural networks for vision" }],
    );
    expect(entries).toEqual([
      {
        field: "about",
        text: "Works on deep neural networks for vision",
        marks: [],
        how: "meaning",
      },
    ]);
  });

  it("says when the last contact was, for a recency filter", () => {
    const entries = explainMatch(
      person({ lastContactedAt: "2026-05-20T10:00:00.000Z" }),
      questionTerms("Who haven't I talked to lately?"),
      [{ evidence: { field: "lastContact" }, how: "filter" }],
      [],
      now,
    );
    expect(entries).toEqual([
      { field: "lastContact", text: "4 months ago", marks: [], how: "filter" },
    ]);
    expect(
      explainMatch(
        person({}),
        questionTerms("never contacted"),
        [{ evidence: { field: "lastContact" }, how: "filter" }],
        [],
        now,
      )[0]!.text,
    ).toBe("None logged");
  });

  it(`lists at most ${MAX_MATCHED} fields, each field once`, () => {
    const entries = explainMatch(
      person({
        role: "Machine Learning Lead",
        headline: "Machine learning at Globex",
        industry: "Machine Learning",
        interests: [{ interest: "Machine Learning" }],
        tags: [{ tag: "machine learning" }],
      }),
      ml,
      [{ evidence: { field: "role" }, how: "filter" }],
    );
    expect(entries).toHaveLength(MAX_MATCHED);
    expect(new Set(entries.map((m) => m.field)).size).toBe(MAX_MATCHED);
    expect(entries[0]).toMatchObject({ field: "role", how: "filter" });
  });

  it("says nothing for a contact with no field to show", () => {
    expect(explainMatch(person({ role: "Chef" }), ml)).toEqual([]);
  });

  describe("an address", () => {
    const valencia = questionTerms("Valencia");
    const home = [
      { address: "3190 Valencia St, San Francisco, CA 94110", label: "home" },
      { address: "1 Market St, San Francisco", label: "work" },
    ];

    it("names the address that holds the words, marked, when nothing else does", () => {
      const entries = explainMatch(person({ addresses: home }), valencia);
      expect(entries).toHaveLength(1);
      // The work address holds no word of the question, so it stays out.
      expect(entries[0]).toMatchObject({
        field: "address",
        how: "words",
        text: "3190 Valencia St, San Francisco, CA 94110",
      });
      expect(marked(entries[0])).toEqual(["Valencia"]);
    });

    it("lists the address after every other field that matched", () => {
      const entries = explainMatch(
        person({
          role: "Valencia Street Baker",
          about: "Runs a stall on Valencia St on Sundays",
          addresses: home,
        }),
        valencia,
      );
      expect(entries.map((m) => m.field)).toEqual(["role", "about", "address"]);
    });
  });
});

describe("windowed", () => {
  it("leaves a short text alone", () => {
    expect(windowed("Head of Design", [[8, 14]])).toEqual({
      text: "Head of Design",
      marks: [[8, 14]],
    });
  });

  it("brings a mark deep in a short text to the front, for a phone's two lines", () => {
    const text =
      "Subnecto damnatio coaegresco in apud. Builds machine learning models for fraud detection.";
    const start = text.indexOf("machine");
    const cut = windowed(text, [[start, start + 16]]);
    expect(cut.text).toBe(
      "…in apud. Builds machine learning models for fraud detection.",
    );
    const [[a, b]] = cut.marks;
    expect(cut.text.slice(a!, b!)).toBe("machine learning");
    // A mark near the start stays where it is.
    expect(windowed("Builds machine learning models", [[7, 23]]).text).toBe(
      "Builds machine learning models",
    );
  });

  it("keeps the marks on the same words after a cut", () => {
    const text = `${"word ".repeat(40)}target ${"tail ".repeat(40)}`;
    const start = text.indexOf("target");
    const cut = windowed(text, [[start, start + 6]]);
    const [[a, b]] = cut.marks;
    expect(cut.text.slice(a!, b!)).toBe("target");
    expect(cut.text.length).toBeLessThanOrEqual(112);
  });
});

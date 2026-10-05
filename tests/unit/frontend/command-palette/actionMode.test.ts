import { describe, expect, it } from "vitest";
import {
  findLogContact,
  logContactSuggestions,
  parseLogInput,
} from "../../../../src/components/command-palette/actionMode";

const people = [
  { id: "1", name: "Nancy Garcia" },
  { id: "2", name: "Nancy Anderson" },
  { id: "3", name: "Ann Nancy" },
  { id: "4", name: "Tyler Jackson" },
];

describe("parseLogInput", () => {
  it.each([
    [">", { step: "kind", partial: "" }],
    ["> ", { step: "kind", partial: "" }],
    [">no", { step: "kind", partial: "no" }],
    ["> note", { step: "kind", partial: "note" }],
    ["> notes", { step: "kind", partial: "notes" }],
  ])("asks for the kind while it is typed: %j", (input, step) => {
    expect(parseLogInput(input)).toEqual(step);
  });

  it("asks for the contact once a kind and a space are typed", () => {
    expect(parseLogInput("> note ")).toEqual({
      step: "contact",
      kind: "note",
      partial: "",
    });
    expect(parseLogInput(">CALL tyl")).toEqual({
      step: "contact",
      kind: "call",
      partial: "tyl",
    });
  });

  it("reads the text after the colon", () => {
    expect(parseLogInput("> meeting Tyler Jackson:  Went over Q3 ")).toEqual({
      step: "text",
      kind: "meeting",
      name: "Tyler Jackson",
      text: "Went over Q3",
    });
    expect(parseLogInput("> email tyler:")).toEqual({
      step: "text",
      kind: "email",
      name: "tyler",
      text: "",
    });
  });
});

describe("findLogContact", () => {
  it("prefers the whole name, then a name that starts with the words", () => {
    expect(findLogContact(people, "nancy anderson")?.id).toBe("2");
    expect(findLogContact(people, "Nancy")?.id).toBe("1");
    expect(findLogContact(people, "ann")?.id).toBe("3");
  });

  it("falls back to a name that holds the words, and finds nothing else", () => {
    expect(findLogContact(people, "jackson")?.id).toBe("4");
    expect(findLogContact(people, "zed")).toBeUndefined();
    expect(findLogContact(people, "  ")).toBeUndefined();
  });
});

describe("logContactSuggestions", () => {
  it("lists the names that start with the words first, then the rest", () => {
    expect(logContactSuggestions(people, "nan").map((p) => p.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("stops at the limit, and lists everyone for no words", () => {
    expect(logContactSuggestions(people, "", 2)).toHaveLength(2);
    expect(logContactSuggestions(people, "o", 10).map((p) => p.id)).toEqual([
      "2",
      "4",
    ]);
  });
});

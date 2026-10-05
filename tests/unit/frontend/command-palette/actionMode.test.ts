// `>` mode, a step at a time: the kind, the contact, the text.
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

describe("> mode", () => {
  it("reads the kind, then the name, then the text after the colon", () => {
    expect(parseLogInput("> no")).toEqual({ step: "kind", partial: "no" });
    expect(parseLogInput(">CALL tyl")).toEqual({
      step: "contact",
      kind: "call",
      partial: "tyl",
    });
    expect(parseLogInput("> email Tyler Jackson:  Sent Q3 ")).toEqual({
      step: "text",
      kind: "email",
      name: "Tyler Jackson",
      text: "Sent Q3",
    });
  });

  it("takes the whole name, then a start, then a part, and nothing else", () => {
    expect(findLogContact(people, "nancy anderson")?.id).toBe("2");
    expect(findLogContact(people, "ann")?.id).toBe("3");
    expect(findLogContact(people, "jackson")?.id).toBe("4");
    expect(findLogContact(people, "zed")).toBeUndefined();
  });

  it("offers the names that start with the words first, up to the limit", () => {
    const ids = (typed: string, limit?: number) =>
      logContactSuggestions(people, typed, limit).map((p) => p.id);
    expect(ids("nan")).toEqual(["1", "2", "3"]);
    expect(ids("", 2)).toEqual(["1", "2"]);
  });
});

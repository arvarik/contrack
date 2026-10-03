// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import {
  parseQuery,
  useQueryTokenizer,
} from "../../../../src/hooks/useQueryTokenizer.ts";

describe("parseQuery", () => {
  // A facet is a pill once a space follows it. One still being typed, an open
  // quote included, is the active prefix that the autocomplete reads.
  it.each([
    [
      "near:London/50km list:Advisors ",
      [
        { field: "near", value: "London", km: 50 },
        { field: "list", value: "Advisors" },
      ],
      "",
      null,
    ],
    ["missing:company John", [{ field: "missing", value: "company" }], "John"],
    ["tracked:yes Ada", [{ field: "tracked", value: "yes" }], "Ada"],
    [
      'industry:"Venture Capital" Ada',
      [{ field: "industry", value: "Venture Capital" }],
      "Ada",
    ],
    ["near:Lon", [], "", { field: "near", partial: "Lon" }],
    ["tracked:n", [], "", { field: "tracked", partial: "n" }],
    [
      'industry:"Venture Cap',
      [],
      "",
      { field: "industry", partial: "Venture Cap" },
    ],
  ])("reads %j", (input, filters, freeText, activePrefix = null) => {
    expect(parseQuery(input)).toEqual({ filters, freeText, activePrefix });
  });
});

describe("useQueryTokenizer", () => {
  const setup = (initial: string) =>
    renderHook(() => {
      const [raw, setRaw] = useState(initial);
      return { raw, tokenizer: useQueryTokenizer(raw, setRaw) };
    }).result;

  it("keeps a pill picked from the autocomplete until it is removed", () => {
    const result = setup("");
    act(() =>
      result.current.tokenizer.addFilter({ field: "missing", value: "email" }),
    );
    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "missing", value: "email" },
    ]);
    act(() => result.current.tokenizer.removeFilter(0));
    expect(result.current.tokenizer.parsed.filters).toEqual([]);
  });

  it("strips a removed pill's token, quotes and all, from the input", () => {
    const result = setup('industry:"Venture Capital" tag:vc ');
    act(() => result.current.tokenizer.removeFilter(0));
    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "tag", value: "vc" },
    ]);
    expect(result.current.raw).not.toContain("Venture");
  });
});

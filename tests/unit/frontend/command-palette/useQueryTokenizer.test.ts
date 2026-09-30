// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useQueryTokenizer } from "../../../../src/hooks/useQueryTokenizer.ts";

describe("useQueryTokenizer", () => {
  // One row for each facet tested here: a field the patterns do not know
  // fails only the rows that use it. `tracked:` is the newest facet, and its two rows pin it in both
  // patterns: a locked pill and an active prefix.
  it.each([
    [
      "near:London/50km list:Advisors ",
      [
        { field: "near", value: "London", km: 50 },
        { field: "list", value: "Advisors" },
      ],
      "",
    ],
    ["missing:company John", [{ field: "missing", value: "company" }], "John"],
    ["tracked:yes Ada", [{ field: "tracked", value: "yes" }], "Ada"],
  ])("locks a facet followed by a space in %j", (input, filters, freeText) => {
    function useTest() {
      const [raw, setRaw] = useState(input);
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.filters).toEqual(filters);
    expect(result.current.tokenizer.parsed.freeText).toBe(freeText);
    expect(result.current.tokenizer.hasFilters).toBe(true);
  });

  it.each([
    ["near:Lon", "near", "Lon"],
    ["missing:loc", "missing", "loc"],
    ["tracked:n", "tracked", "n"],
  ])(
    "reads the facet being typed in %j as the active prefix",
    (input, field, partial) => {
      function useTest() {
        const [raw, setRaw] = useState(input);
        const tokenizer = useQueryTokenizer(raw, setRaw);
        return { tokenizer, raw, setRaw };
      }

      const { result } = renderHook(() => useTest());

      expect(result.current.tokenizer.parsed.activePrefix).toEqual({
        field,
        partial,
      });
      expect(result.current.tokenizer.parsed.filters).toEqual([]);
    },
  );

  it("supports addFilter and removeFilter with missing facet", () => {
    function useTest() {
      const [raw, setRaw] = useState("");
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    act(() => {
      result.current.tokenizer.addFilter({ field: "missing", value: "email" });
    });

    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "missing", value: "email" },
    ]);

    act(() => {
      result.current.tokenizer.removeFilter(0);
    });

    expect(result.current.tokenizer.parsed.filters).toEqual([]);
  });

  // The map's insight bars write a value with a space in double quotes. A
  // value cut at its space locked `"Venture` and left `Capital"` as text.
  it("locks a quoted value with a space as one pill", () => {
    function useTest() {
      const [raw, setRaw] = useState('industry:"Venture Capital" Ada');
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "industry", value: "Venture Capital" },
    ]);
    expect(result.current.tokenizer.parsed.freeText).toBe("Ada");
  });

  it("keeps an open quote as the facet being typed", () => {
    function useTest() {
      const [raw, setRaw] = useState('industry:"Venture Cap');
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.activePrefix).toEqual({
      field: "industry",
      partial: "Venture Cap",
    });
    expect(result.current.tokenizer.parsed.filters).toEqual([]);
    expect(result.current.tokenizer.parsed.freeText).toBe("");
  });

  it("strips a quoted token from the input when its pill is removed", () => {
    function useTest() {
      const [raw, setRaw] = useState('industry:"Venture Capital" tag:vc ');
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    act(() => {
      result.current.tokenizer.removeFilter(0);
    });

    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "tag", value: "vc" },
    ]);
    expect(result.current.raw).not.toContain("Venture");
  });

  it("removes pill and strips filter token from input", () => {
    function useTest() {
      const [raw, setRaw] = useState("near:Paris list:Core ");
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.filters).toHaveLength(2);

    act(() => {
      result.current.tokenizer.removeFilter(0);
    });

    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "list", value: "Core" },
    ]);
  });
});

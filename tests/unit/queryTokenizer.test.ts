// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useQueryTokenizer,
  parseFilterValue,
} from "../../src/hooks/useQueryTokenizer";

describe("parseFilterValue", () => {
  it("parses near:London/50km to km: 50", () => {
    const filter = parseFilterValue("near", "London/50km");
    expect(filter).toEqual({
      field: "near",
      value: "London",
      km: 50,
    });
  });

  it("parses near:London/50 without explicit km suffix to km: 50", () => {
    const filter = parseFilterValue("near", "London/50");
    expect(filter).toEqual({
      field: "near",
      value: "London",
      km: 50,
    });
  });

  it("defaults near:Paris to 25 km", () => {
    const filter = parseFilterValue("near", "Paris");
    expect(filter).toEqual({
      field: "near",
      value: "Paris",
      km: 25,
    });
  });

  it("parses list facet values directly", () => {
    const filter = parseFilterValue("list", "investors");
    expect(filter).toEqual({
      field: "list",
      value: "investors",
    });
  });

  it("parses hyphenated list names for lists with spaces", () => {
    // Note: Free-text tokenizer uses whitespace boundary for pills,
    // so multi-word list names use the hyphen form (e.g. list:advisors-board)
    // or are selected via autocomplete.
    const filter = parseFilterValue("list", "advisors-board");
    expect(filter).toEqual({
      field: "list",
      value: "advisors-board",
    });
  });
});

describe("useQueryTokenizer hook", () => {
  it("tokenizes near and list facets when followed by a space", () => {
    let raw = "near:London/50km list:Advisors ";
    const setRaw = (val: string) => {
      raw = val;
    };

    const { result } = renderHook(() => useQueryTokenizer(raw, setRaw));

    expect(result.current.parsed.filters).toEqual([
      { field: "near", value: "London", km: 50 },
      { field: "list", value: "Advisors" },
    ]);
    expect(result.current.hasFilters).toBe(true);
  });

  it("identifies activePrefix for near: or list: in progress", () => {
    let raw = "near:Lon";
    const setRaw = (val: string) => {
      raw = val;
    };

    const { result } = renderHook(() => useQueryTokenizer(raw, setRaw));

    expect(result.current.parsed.activePrefix).toEqual({
      field: "near",
      partial: "Lon",
    });
    expect(result.current.parsed.filters).toEqual([]);
  });

  it("removes pill and strips filter token from input", () => {
    let raw = "near:Paris list:Core ";
    const setRaw = (val: string) => {
      raw = val;
    };

    const { result } = renderHook(() => useQueryTokenizer(raw, setRaw));

    expect(result.current.parsed.filters).toHaveLength(2);

    act(() => {
      result.current.removeFilter(0);
    });

    expect(result.current.parsed.filters).toEqual([
      { field: "list", value: "Core" },
    ]);
  });
});

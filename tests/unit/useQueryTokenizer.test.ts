// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useQueryTokenizer } from "../../src/hooks/useQueryTokenizer.ts";

describe("useQueryTokenizer", () => {
  it("parses missing: facet when locked with space", () => {
    function useTest() {
      const [raw, setRaw] = useState("missing:company John");
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.filters).toEqual([
      { field: "missing", value: "company" },
    ]);
    expect(result.current.tokenizer.parsed.freeText.trim()).toBe("John");
  });

  it("detects active prefix for missing: without trailing space", () => {
    function useTest() {
      const [raw, setRaw] = useState("missing:loc");
      const tokenizer = useQueryTokenizer(raw, setRaw);
      return { tokenizer, raw, setRaw };
    }

    const { result } = renderHook(() => useTest());

    expect(result.current.tokenizer.parsed.activePrefix).toEqual({
      field: "missing",
      partial: "loc",
    });
  });

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
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useQueryTokenizer } from "../../src/hooks/useQueryTokenizer";

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

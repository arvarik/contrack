// @vitest-environment jsdom
// =============================================================================
// useStarterDraw: the questions under "Try asking", drawn from the pool once
// =============================================================================
// The Ask page draws six and the palette's AI mode draws four, through this
// one hook. A draw is made when the list appears and stays put while the pool
// refreshes behind it, so no chip moves under a pointer. A new `draw` number,
// the page's Clear, draws again.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { StarterQuestion } from "../../../../shared/starterQuestions";

const state: { questions: StarterQuestion[] | undefined } = {
  questions: undefined,
};
vi.mock("../../../../src/api", () => ({
  useStarterQuestions: () => ({
    data: state.questions ? { questions: state.questions } : undefined,
  }),
}));

import { useStarterDraw } from "../../../../src/hooks/useStarterDraw";

const pool = (prefix: string, count = 60): StarterQuestion[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: (["company", "city", "role", "general"] as const)[i % 4]!,
    text: `${prefix} ${i}`,
  }));

let calls = 0;
beforeEach(() => {
  calls = 0;
  // A source that never repeats, so two draws differ.
  vi.spyOn(Math, "random").mockImplementation(
    () => (calls++ * 0.6180339887) % 1,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  state.questions = undefined;
});

describe("useStarterDraw", () => {
  it("draws as many questions as it is asked for, from the pool", () => {
    state.questions = pool("first");
    const six = renderHook(() => useStarterDraw(6));
    const four = renderHook(() => useStarterDraw(4));
    expect(six.result.current).toHaveLength(6);
    expect(four.result.current).toHaveLength(4);
    for (const text of [...six.result.current, ...four.result.current])
      expect(text).toMatch(/^first \d+$/);
  });

  it("shows nothing until the pool arrives, then draws once", () => {
    const { result, rerender } = renderHook(() => useStarterDraw(4));
    expect(result.current).toEqual([]);
    state.questions = pool("late");
    rerender();
    expect(result.current).toHaveLength(4);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("keeps the draw while the pool is fetched again behind it", () => {
    state.questions = pool("old");
    const { result, rerender } = renderHook(() => useStarterDraw(4));
    const first = [...result.current];
    // The pool refetches with new questions, as it does after an edit.
    state.questions = pool("new");
    rerender();
    expect(result.current).toEqual(first);
  });

  it("draws again when the draw number changes", () => {
    state.questions = pool("set");
    const { result, rerender } = renderHook(
      ({ draw }) => useStarterDraw(4, draw),
      {
        initialProps: { draw: 0 },
      },
    );
    const first = [...result.current];
    rerender({ draw: 0 });
    expect(result.current).toEqual(first);
    rerender({ draw: 1 });
    expect(result.current).not.toEqual(first);
    expect(result.current).toHaveLength(4);
  });

  it("shows nothing for an account with nothing to ask about", () => {
    state.questions = [];
    const { result } = renderHook(() => useStarterDraw(4));
    expect(result.current).toEqual([]);
  });
});

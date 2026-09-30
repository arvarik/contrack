// @vitest-environment jsdom
// =============================================================================
// The palette's AI mode: four questions from the same pool as the Ask page
// =============================================================================
// `AiStarters` draws four of the account's starter questions through
// `useStarterDraw`, the hook the Ask page draws its six with
// (searchView.test.tsx has the six, Clear and the empty pool). A press or a
// click puts the question in the palette's input.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StarterQuestion } from "../../../../shared/starterQuestions";

const state: { questions: StarterQuestion[] | undefined } = {
  questions: undefined,
};
vi.mock("../../../../src/api", () => ({
  useStarterQuestions: () => ({
    data: state.questions ? { questions: state.questions } : undefined,
  }),
}));

import { AiStarters } from "../../../../src/components/command-palette/AiStarters";

/** One question of each of five kinds, so a draw of four is any four. */
const pool = (word: string): StarterQuestion[] =>
  (["industry", "city", "company", "role", "general"] as const).map(
    (kind, i) => ({ kind, text: `${word} ${i}?` }),
  );
const shown = () =>
  screen.queryAllByRole("button").map((button) => button.textContent);

afterEach(() => {
  cleanup();
  state.questions = undefined;
});

describe("AiStarters", () => {
  it("shows four of the pool's questions, and a press or a click hands one over", () => {
    state.questions = pool("Who");
    const onPick = vi.fn();
    render(<AiStarters onPick={onPick} />);
    const buttons = screen.getAllByRole("button");
    expect(shown()).toHaveLength(4);
    for (const text of shown()) expect(text).toMatch(/^\? Who \d\?$/);

    // A press must not take the focus from the palette's input.
    expect(fireEvent.mouseDown(buttons[0]!)).toBe(false);
    // Enter or Space on a focused button is a click.
    fireEvent.click(buttons[1]!);
    expect(onPick.mock.calls).toEqual(
      [buttons[0]!, buttons[1]!].map((b) => [b.textContent!.slice(2)]),
    );
  });

  it("keeps its four while the pool is fetched again behind it", () => {
    state.questions = pool("Old");
    const { rerender } = render(<AiStarters onPick={vi.fn()} />);
    const first = shown();
    state.questions = pool("New");
    rerender(<AiStarters onPick={vi.fn()} />);
    expect(shown()).toEqual(first);
  });

  it("shows nothing until there is a question to ask, then draws", () => {
    const { rerender } = render(<AiStarters onPick={vi.fn()} />);
    expect(shown()).toEqual([]);
    state.questions = [];
    rerender(<AiStarters onPick={vi.fn()} />);
    expect(shown()).toEqual([]);
    state.questions = pool("Late");
    rerender(<AiStarters onPick={vi.fn()} />);
    expect(shown()).toHaveLength(4);
  });
});

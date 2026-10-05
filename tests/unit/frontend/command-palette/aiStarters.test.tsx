// @vitest-environment jsdom
// =============================================================================
// The palette's AI mode: four questions from the same pool as the Ask page
// =============================================================================
// `AiStarters` draws four of the account's starter questions through
// `useStarterDraw`, the hook the Ask page draws its six with
// (searchView.test.tsx has the six, Clear and the empty pool). Each is a row
// of the palette's list, and picking one puts the question in its input.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Command } from "cmdk";
import type { ReactNode } from "react";
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
  screen.queryAllByRole("option").map((option) => option.textContent);

/** cmdk's rows need a `Command` around them, as in the palette. */
const inList = (children: ReactNode) => <Command>{children}</Command>;

afterEach(() => {
  cleanup();
  state.questions = undefined;
});

describe("AiStarters", () => {
  it("shows four of the pool's questions as rows, and a click hands one over", () => {
    state.questions = pool("Who");
    const onPick = vi.fn();
    render(inList(<AiStarters onPick={onPick} />));
    expect(screen.getByRole("group", { name: "Try asking" })).toBeTruthy();
    const rows = screen.getAllByRole("option");
    expect(shown()).toHaveLength(4);
    for (const text of shown()) expect(text).toMatch(/^Who \d\?$/);

    fireEvent.click(rows[1]!);
    expect(onPick.mock.calls).toEqual([[rows[1]!.textContent]]);
  });

  it("keeps its four while the pool is fetched again behind it", () => {
    state.questions = pool("Old");
    const { rerender } = render(inList(<AiStarters onPick={vi.fn()} />));
    const first = shown();
    state.questions = pool("New");
    rerender(inList(<AiStarters onPick={vi.fn()} />));
    expect(shown()).toEqual(first);
  });

  it("shows nothing until there is a question to ask, then draws", () => {
    const { rerender } = render(inList(<AiStarters onPick={vi.fn()} />));
    expect(shown()).toEqual([]);
    state.questions = [];
    rerender(inList(<AiStarters onPick={vi.fn()} />));
    expect(shown()).toEqual([]);
    state.questions = pool("Late");
    rerender(inList(<AiStarters onPick={vi.fn()} />));
    expect(shown()).toHaveLength(4);
  });
});

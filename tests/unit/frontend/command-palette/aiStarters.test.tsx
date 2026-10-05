// @vitest-environment jsdom
// The palette's AI mode draws four of the account's starter questions, the
// pool and the draw the Ask page uses (searchView.test.tsx has the rest).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Command } from "cmdk";
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

const pool = (word: string): StarterQuestion[] =>
  (["industry", "city", "company", "role", "general"] as const).map(
    (kind, i) => ({ kind, text: `${word} ${i}?` }),
  );
const shown = () => screen.queryAllByRole("option").map((o) => o.textContent);

afterEach(cleanup);

describe("AiStarters", () => {
  it("shows four rows, keeps them while the pool reloads, and hands one over", () => {
    const onPick = vi.fn();
    const view = () => (
      <Command>
        <AiStarters onPick={onPick} />
      </Command>
    );
    state.questions = undefined;
    const { rerender } = render(view());
    expect(shown()).toEqual([]);

    state.questions = pool("Old");
    rerender(view());
    const first = shown();
    expect(first).toHaveLength(4);

    state.questions = pool("New");
    rerender(view());
    expect(shown()).toEqual(first);

    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(onPick).toHaveBeenCalledWith(first[1]);
  });
});

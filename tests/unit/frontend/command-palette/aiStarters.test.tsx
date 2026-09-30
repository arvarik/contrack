// @vitest-environment jsdom
// =============================================================================
// The palette's AI mode: four questions from the same pool as the Ask page
// =============================================================================
// The palette used to show four fixed examples, "Who do I know in London
// working in FinTech?" among them, which find nobody in most networks. It
// shows four of the account's own starter questions now, drawn when the list
// appears, and a press fills the input with the question.
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

const POOL: StarterQuestion[] = [
  { kind: "industry", text: "Who works in Fintech?" },
  { kind: "city", text: "Who do I know in Lisbon?" },
  { kind: "company", text: "Who works at Northwind Logistics?" },
  { kind: "interest", text: "Who is interested in Rock Climbing?" },
  { kind: "role", text: "Who works as a CTO?" },
  { kind: "general", text: "Who do I track?" },
];

afterEach(() => {
  cleanup();
  state.questions = undefined;
});

describe("AiStarters", () => {
  it("shows four questions from the pool, each as a button that starts with a question mark", () => {
    state.questions = POOL;
    render(<AiStarters onPick={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    for (const button of buttons) {
      const text = button.textContent ?? "";
      expect(text.startsWith("? ")).toBe(true);
      expect(POOL.map((q) => q.text)).toContain(text.slice(2));
    }
    expect(new Set(buttons.map((b) => b.textContent)).size).toBe(4);
  });

  it("no longer offers the fixed examples", () => {
    state.questions = POOL;
    render(<AiStarters onPick={vi.fn()} />);
    const text = document.body.textContent ?? "";
    for (const old of [
      "Who do I know in London working in FinTech?",
      "Who likes espresso?",
      "Who works at a startup as a designer?",
    ])
      expect(text).not.toContain(old);
  });

  it("hands the question, without its question mark prefix, to onPick", () => {
    state.questions = POOL;
    const onPick = vi.fn();
    render(<AiStarters onPick={onPick} />);
    const button = screen.getAllByRole("button")[0]!;
    fireEvent.mouseDown(button);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(POOL.map((q) => q.text)).toContain(onPick.mock.calls[0]![0]);
  });

  it("asks the question when a keyboard user presses Enter on it, which is a click", () => {
    state.questions = POOL;
    const onPick = vi.fn();
    render(<AiStarters onPick={onPick} />);
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(POOL.map((q) => q.text)).toContain(onPick.mock.calls[0]![0]);
  });

  it("keeps the same four while it stays on screen", () => {
    state.questions = POOL;
    const { rerender } = render(<AiStarters onPick={vi.fn()} />);
    const first = screen.getAllByRole("button").map((b) => b.textContent);
    rerender(<AiStarters onPick={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(
      first,
    );
  });

  it("shows what a small pool has, and nothing for an account with nothing to ask about", () => {
    state.questions = POOL.slice(0, 2);
    const { unmount } = render(<AiStarters onPick={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    unmount();
    state.questions = [];
    render(<AiStarters onPick={vi.fn()} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

/**
 * The questions under the palette's AI mode, before anything is typed.
 *
 * Four of the account's own starter questions, the same pool and the same
 * draw as "Try asking" on the Ask page (`useStarterDraw`). Each is a button
 * that puts the question in the input after the `?`, where the palette asks
 * it as it asks anything typed there.
 *
 * It draws when it appears, which is each time the palette enters AI mode
 * with an empty question, and keeps those four while it stays on screen.
 *
 * @module components/command-palette/AiStarters
 */
import { useStarterDraw } from "../../hooks/useStarterDraw";
import { PALETTE_SUGGESTION_COUNT } from "../../views/search/suggestions";

export const AiStarters = ({
  onPick,
}: {
  /** Receives the question, without the `?` the button shows before it. */
  onPick: (question: string) => void;
}) => {
  const questions = useStarterDraw(PALETTE_SUGGESTION_COUNT);
  if (questions.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Try asking"
      className="space-y-1.5 text-left max-w-xs mx-auto"
    >
      {questions.map((question) => (
        <button
          key={question}
          // A mouse press must not take the focus from the input, so it asks
          // on the press. Enter and Space on a focused button are a click, and
          // a press that already asked has removed the list before it arrives.
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(question);
          }}
          onClick={() => onPick(question)}
          className="state-layer w-full min-h-[44px] sm:min-h-0 text-left text-xs px-3 py-2 rounded-lg bg-primary/5 text-primary transition-colors"
        >
          ? {question}
        </button>
      ))}
    </div>
  );
};

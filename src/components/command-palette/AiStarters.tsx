/**
 * The questions under the palette's AI mode, before anything is typed.
 *
 * Four of the account's own starter questions, the same pool and the same
 * draw as "Try asking" on the Ask page (`useStarterDraw`). Each is a row of
 * the palette's list, so `↓` reaches it and `Enter` picks it, as a click
 * does. Picking one puts the question in the input after the `?`, where the
 * palette asks it as it asks anything typed there. They were buttons: the
 * arrow keys passed them by, and cmdk took the `Enter` on a focused one.
 *
 * It draws when it appears, which is each time the palette enters AI mode
 * with an empty question, and keeps those four while it stays on screen.
 *
 * @module components/command-palette/AiStarters
 */
import { Command } from "cmdk";
import { Sparkles } from "lucide-react";
import { useStarterDraw } from "../../hooks/useStarterDraw";
import { PALETTE_SUGGESTION_COUNT } from "../../views/search/suggestions";
import { cn } from "../../lib/utils";
import { GROUP_HEADING_PRIMARY, ITEM_CURRENT } from "./utils";

export const AiStarters = ({
  onPick,
}: {
  /** Receives the question, without the `?` the row shows before it. */
  onPick: (question: string) => void;
}) => {
  const questions = useStarterDraw(PALETTE_SUGGESTION_COUNT);
  if (questions.length === 0) return null;
  return (
    <Command.Group heading="Try asking" className={GROUP_HEADING_PRIMARY}>
      {questions.map((question) => (
        <Command.Item
          key={question}
          value={`starter_${question}`}
          onSelect={() => onPick(question)}
          className={cn(
            "flex items-center gap-3 px-3 py-2 min-h-[44px] sm:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface",
            ITEM_CURRENT,
          )}
        >
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate">{question}</span>
        </Command.Item>
      ))}
    </Command.Group>
  );
};

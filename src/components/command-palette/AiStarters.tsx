/**
 * Four starter questions under AI mode before anything is typed, drawn as
 * "Try asking" on Ask draws them (`useStarterDraw`). Each is a list row, so
 * `↓` and `Enter` reach it. Picking one puts it after the `?`. A new draw
 * comes each time the mode opens empty.
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
            "flex items-center gap-3 px-3 py-2 min-h-[44px] pointer-fine:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface",
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

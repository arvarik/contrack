/**
 * ChipInput: a row of removable chips and one "+ Add" button, for tags,
 * preferences and interests.
 *
 * 1. A chip that enrichment found wears the AI color and a sparkle.
 * 2. "+ Add" opens a field in its place. Enter adds the text and keeps the
 *    field open. A comma splits: "beta, gamma" adds two. Escape, or leaving
 *    an empty field, closes it. Leaving a field with text adds the text.
 * 3. Focus never falls to the page. After a remove it moves to the next
 *    chip's remove button, or to "+ Add" when no chip is left.
 *
 * The component does not save. The caller writes the change and offers Undo.
 */
import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ADD_BUTTON, ADD_BUTTON_SMALL, ADD_FIELD } from "../../../lib/styles";

export interface Chip {
  id: string;
  label: string;
  /** True when enrichment found the value. Drawn in the AI color. */
  ai?: boolean;
}

interface ChipInputProps {
  chips: readonly Chip[];
  /** Called with the new texts, trimmed: never empty, never a duplicate. */
  onAdd: (texts: string[]) => void;
  onRemove: (chip: Chip) => void;
  /** The singular noun, in lower case: "tag", "preference", "interest". */
  noun: string;
  /** The add button's visible text after the plus. Default "Add". */
  addText?: string;
  /** The small "+ tag" of the header's chip row. */
  small?: boolean;
}

export const ChipInput = ({
  chips,
  onAdd,
  onRemove,
  noun,
  addText = "Add",
  small = false,
}: ChipInputProps) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  /**
   * Where focus goes once the page catches up: "+ Add" after the field
   * closed by key, or the chip that took a removed chip's place. A remove
   * draws only when the save answers, so focus moves once the chip has left
   * the list. A failed save leaves the chip, and focus, where they are.
   */
  const focusNext = useRef<{ removed: string; index: number } | "add" | null>(
    null,
  );

  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    if (target === "add") {
      focusNext.current = null;
      addButton.current?.focus();
      return;
    }
    if (chips.some((chip) => chip.id === target.removed)) return;
    focusNext.current = null;
    const removes =
      container.current?.querySelectorAll<HTMLButtonElement>(
        "[data-chip-remove]",
      ) ?? [];
    const button = removes[Math.min(target.index, removes.length - 1)];
    if (button) button.focus();
    else addButton.current?.focus();
  }, [chips, adding]);

  /** Add each comma-separated part that is new, in one call. */
  const commit = () => {
    const text = draft;
    setDraft("");
    const seen = new Set(chips.map((chip) => chip.label.toLowerCase()));
    const added = text
      .split(",")
      .map((part) => part.trim())
      .filter((part) => {
        const key = part.toLowerCase();
        if (!part || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (added.length) onAdd(added);
  };

  const close = (byKey: boolean) => {
    setAdding(false);
    setDraft("");
    if (byKey) focusNext.current = "add";
  };

  return (
    <div ref={container} className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip, index) => (
        // No overflow clip: it would clip the remove button's tap box.
        // `max-w-full` and `min-w-0` keep a long word inside the card.
        <span
          key={chip.id}
          className={cn(
            "max-w-full flex items-center gap-1 text-xs font-bold py-1 pl-2.5 pr-1 rounded-md border",
            chip.ai
              ? "bg-ai/10 text-on-ai-wash border-ai/20"
              : "bg-surface-container text-on-surface-variant border-transparent",
          )}
        >
          {chip.ai && (
            <Sparkles
              aria-hidden="true"
              className="w-3 h-3 opacity-70 shrink-0"
            />
          )}
          <span className="min-w-0 whitespace-normal break-words">
            {chip.label}
          </span>
          <button
            type="button"
            data-chip-remove=""
            aria-label={`Remove ${noun} ${chip.label}`}
            onClick={() => {
              focusNext.current = { removed: chip.id, index };
              onRemove(chip);
            }}
            className={cn(
              "hit-area state-layer w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors hover:text-error",
              chip.ai ? "text-on-ai-wash" : "text-on-surface-variant",
            )}
          >
            <X aria-hidden="true" className="w-3 h-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <input
          type="text"
          aria-label={`New ${noun}`}
          placeholder={`Add ${noun}`}
          // Opens only after the person pressed "+ Add".
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
          onBlur={() => {
            commit();
            setAdding(false);
          }}
          className={ADD_FIELD}
        />
      ) : (
        <button
          ref={addButton}
          type="button"
          aria-label={`Add ${noun}`}
          onClick={() => setAdding(true)}
          className={small ? ADD_BUTTON_SMALL : ADD_BUTTON}
        >
          <Plus
            aria-hidden="true"
            className={small ? "w-3.5 h-3.5" : "w-4 h-4"}
          />
          {addText}
        </button>
      )}
    </div>
  );
};

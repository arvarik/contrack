import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { useCompletedActionItems } from "../../../api";
import { formatWhen } from "../../../lib/datetime";
import { BTN_QUIET, TONE_TEXT } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";

const LIST_ID = "completed-card-content";

/**
 * Completed: one line, in both states.
 *
 * "Nothing completed yet." or "3 completed recently", and a quiet Show that
 * opens the list under the line: each row on the wash with the title struck
 * through, the name as a link and when it was done. Nobody reads a framed
 * box for a number, and the queue above is the card that earns the frame.
 */
export const CompletedCard = () => {
  const { data: completedItems = [] } = useCompletedActionItems();
  const [expanded, setExpanded] = useState(false);
  const count = completedItems.length;
  const open = expanded && count > 0;

  return (
    <div className="flex flex-col gap-2">
      <CardFrame
        cardId="completed"
        title="Completed"
        variant="line"
        headerAction={
          count > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className={BTN_QUIET}
              aria-expanded={open}
              aria-controls={LIST_ID}
            >
              {open ? "Hide" : "Show"}
            </button>
          )
        }
      >
        {count === 0 ? "Nothing completed yet" : `${count} completed recently`}
      </CardFrame>

      {open && (
        // The rows start on the line's edge, where a card's rows start. The
        // list scrolls inside itself from lg only, like the queue: on a
        // phone a box that scrolls inside the page catches the flick.
        <ul
          id={LIST_ID}
          aria-label="Completed follow-ups"
          className="flex flex-col gap-1.5 px-4 sm:px-5 lg:max-h-72 lg:overflow-y-auto"
        >
          {completedItems.map((item) => (
            // On a phone the date takes a line of its own under the title:
            // beside the name and the date the title had one letter left.
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl px-3 py-2 bg-surface-container-low/70"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <CheckCircle2
                  aria-hidden="true"
                  className={cn("w-4 h-4 shrink-0", TONE_TEXT.success)}
                />
                <span
                  className={cn(
                    PULSE_TYPE.rowTitle,
                    "line-through text-on-surface-variant truncate",
                  )}
                >
                  {item.title}
                </span>
                {/* A 14 px name with a 44 px tap box from `hit-area`. */}
                <Link
                  to={`/contact/${item.contactId}`}
                  className={cn(
                    PULSE_TYPE.name,
                    "hit-area inline-flex shrink-0 text-on-surface-variant hover:text-primary transition-colors",
                  )}
                >
                  {item.contactName}
                </Link>
              </div>
              <span
                className={cn(
                  PULSE_TYPE.meta,
                  "shrink-0 tabular-nums max-sm:w-full max-sm:pl-6",
                )}
              >
                {item.completedAt ? formatWhen(item.completedAt) : "Done"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

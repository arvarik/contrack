import React, { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { useCompletedActionItems } from "../../../api";
import { formatWhen } from "../../../lib/datetime";

export const CompletedCard = () => {
  const { data: completedItems = [] } = useCompletedActionItems();
  const [expanded, setExpanded] = useState(false);

  if (completedItems.length === 0) {
    return (
      <CardFrame
        cardId="completed"
        title="Completed"
        icon={CheckCircle2}
        count={0}
        compact
      >
        <p className="text-xs text-on-surface-variant italic">
          No completed follow-ups yet.
        </p>
      </CardFrame>
    );
  }

  return (
    <CardFrame
      cardId="completed"
      title="Completed"
      icon={CheckCircle2}
      count={completedItems.length}
      compact
      headerAction={
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="hit-area p-1 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          aria-label={
            expanded ? "Collapse completed items" : "Expand completed items"
          }
          aria-expanded={expanded}
          aria-controls="completed-card-content"
        >
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      }
    >
      {expanded ? (
        <div
          id="completed-card-content"
          className="space-y-2 pt-1 max-h-72 overflow-y-auto nice-scrollbar"
        >
          {completedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2 rounded-lg bg-surface-container-lowest border border-outline/10 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 pr-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0 opacity-70" />
                <span className="font-medium text-on-surface line-through opacity-70 truncate">
                  {item.title}
                </span>
                <Link
                  to={`/contact/${item.contactId}`}
                  className="text-on-surface-variant hover:text-primary transition-colors truncate max-w-[120px]"
                >
                  ({item.contactName})
                </Link>
              </div>
              <span className="text-[11px] text-on-surface-variant shrink-0 tabular-nums">
                {item.completedAt ? formatWhen(item.completedAt) : "Done"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-on-surface-variant">
          {completedItems.length}{" "}
          {completedItems.length === 1 ? "item" : "items"} completed recently.
        </p>
      )}
    </CardFrame>
  );
};

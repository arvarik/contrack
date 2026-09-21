import React, { useState, useRef, useEffect, memo } from "react";
import { Link } from "react-router-dom";
import { Check, HeartPulse, Cake, Clock, ExternalLink } from "lucide-react";
import { cn } from "../../../lib/utils";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";
import { SnoozeMenu } from "./SnoozeMenu";
import type { UpNextItem } from "../lib/upNext";

export interface ActionRowProps {
  item: UpNextItem;
  isSelected?: boolean;
  onSelect?: () => void;
  onComplete?: (id: string) => void;
  onLog?: (contactId: string) => void;
  onOpenContact?: (contactId: string) => void;
}

export const ActionRow = memo(
  ({
    item,
    isSelected = false,
    onSelect,
    onComplete,
    onLog,
    onOpenContact: _onOpenContact,
  }: ActionRowProps) => {
    const [isCompleting, setIsCompleting] = useState(false);
    const [showSnooze, setShowSnooze] = useState(false);
    const [snoozeTriggerRect, setSnoozeTriggerRect] = useState<DOMRect | null>(
      null,
    );
    const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      return () => {
        if (completeTimerRef.current) {
          clearTimeout(completeTimerRef.current);
        }
      };
    }, []);

    const handleComplete = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isCompleting) return;
      setIsCompleting(true);
      completeTimerRef.current = setTimeout(() => {
        onComplete?.(item.id);
      }, 280);
    };

    const handleLog = (e: React.MouseEvent) => {
      e.stopPropagation();
      onLog?.(item.contactId);
    };

    const handleOpenSnooze = (e: React.MouseEvent) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setSnoozeTriggerRect(rect);
      setShowSnooze((prev) => !prev);
    };

    const chipStyles = {
      urgent: "text-error bg-error/10 border-error/20",
      today: "text-primary bg-primary/10 border-primary/20",
      upcoming:
        "text-on-surface-variant bg-surface-container-high border-outline/10",
      neutral:
        "text-on-surface-variant bg-surface-container-low border-outline/10",
    };

    return (
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <div
        role="listitem"
        aria-current={isSelected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "w-full rounded-xl border border-outline/15 p-3 sm:p-3.5 flex items-center gap-3 transition-all duration-200 group relative bg-surface-container-lowest hover:bg-surface-container-low cursor-pointer",
          isSelected &&
            "ring-2 ring-primary border-primary ring-offset-2 ring-offset-surface scale-[1.005] z-10 bg-surface-container-low",
          isCompleting && "opacity-50 scale-[0.98]",
        )}
      >
        {/* Check button (for real action items) OR Log button (for birthday/slipping) */}
        {item.hasCheckAction ? (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isCompleting}
            aria-label={`Mark "${item.title}" done`}
            className={cn(
              "hit-area w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-150 cursor-pointer",
              item.dueChip.variant === "urgent"
                ? "border-error/40 text-error hover:bg-error hover:text-white"
                : "border-primary/40 text-primary hover:bg-primary hover:text-on-primary",
              isCompleting &&
                "bg-emerald-500 border-emerald-500 text-white scale-110",
            )}
          >
            <Check
              className={cn(
                "w-3.5 h-3.5 transition-opacity",
                isCompleting
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100",
              )}
            />
          </button>
        ) : item.kind === "birthday" ? (
          <button
            type="button"
            onClick={handleLog}
            title="Log a birthday note"
            aria-label={`Wish ${item.contactName} a happy birthday`}
            className="hit-area w-6 h-6 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 hover:bg-amber-500 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <Cake className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleLog}
            title="Log an interaction"
            aria-label={`Log note for ${item.contactName}`}
            className="hit-area w-6 h-6 rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-on-primary flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <HeartPulse className="w-3.5 h-3.5" />
          </button>
        )}

        {/* 32px ScoreRingAvatar */}
        <div className="shrink-0">
          <ScoreRingAvatar
            contact={{
              name: item.contactName,
              avatarUrl: item.contactAvatarUrl,
              isTracked: item.isTracked,
              relationshipScore: item.relationshipScore,
              lastContactedAt: item.lastContactedAt,
            }}
            size={32}
          />
        </div>

        {/* Main details */}
        <div className="flex flex-col flex-1 min-w-0 pr-2">
          <div className="flex items-center gap-2">
            {/*
              A 16 px text link with a 44 px tap box. The clip for a long
              name sits on an inner span so the box is not cut away with it.
            */}
            <Link
              to={`/contact/${item.contactId}`}
              onClick={(e) => e.stopPropagation()}
              className="hit-area inline-flex min-w-0 text-xs font-semibold text-on-surface hover:text-primary transition-colors"
            >
              <span className="truncate max-w-[180px] sm:max-w-none">
                {item.contactName}
              </span>
            </Link>

            {/* Due chip */}
            <span
              className={cn(
                "text-[11px] font-bold px-1.5 py-0.5 rounded border tracking-tight uppercase tabular-nums shrink-0",
                chipStyles[item.dueChip.variant],
              )}
            >
              {item.dueChip.text}
            </span>
          </div>

          <span
            className={cn(
              "text-xs sm:text-sm font-medium text-on-surface-variant truncate mt-0.5 transition-all",
              isCompleting && "line-through opacity-50",
            )}
          >
            {item.title}
          </span>
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-1 shrink-0 opacity-80 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          {item.hasCheckAction && (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={showSnooze}
              onClick={handleOpenSnooze}
              title="Snooze"
              aria-label="Snooze item"
              className="hit-area p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
            </button>
          )}

          <Link
            to={`/contact/${item.contactId}`}
            onClick={(e) => e.stopPropagation()}
            title="Open contact profile"
            aria-label={`Open profile for ${item.contactName}`}
            className="hit-area p-1.5 rounded-lg hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Snooze popup menu */}
        {item.hasCheckAction && (
          <SnoozeMenu
            itemId={item.id}
            isOpen={showSnooze}
            onClose={() => setShowSnooze(false)}
            triggerRect={snoozeTriggerRect}
          />
        )}
      </div>
    );
  },
);

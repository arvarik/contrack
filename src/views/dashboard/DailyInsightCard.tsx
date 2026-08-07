import React from "react";
import { cn } from "../../lib/utils";
import { CARD_TINTED, SECTION_HEADING } from "../../lib/styles";
import { Sparkles } from "lucide-react";
import { DailyInsight } from "../../api";

interface DailyInsightCardProps {
  insight?: DailyInsight | null;
  isLoading: boolean;
  /** CSS entrance delay from `tileDelay(index)`. */
  delay?: string;
}

/**
 * The insight arrives on its own query, well after the dashboard payload.
 *
 * The swap used to run through `<AnimatePresence mode="wait">`, which waits for
 * the skeleton to finish exiting before mounting the text — and in that gap the
 * card has no content, collapses to its header height, and yanks every tile
 * below it upward and back. The fix is structural, not a tuning problem: one
 * slot with a reserved minimum height, and a plain opacity crossfade inside it.
 */
export const DailyInsightCard = ({
  insight,
  isLoading,
  delay,
}: DailyInsightCardProps) => {
  const state = isLoading ? "loading" : insight ? "loaded" : "empty";

  return (
    <div
      style={{ animationDelay: delay }}
      className={cn(CARD_TINTED, "tile-enter col-span-full group")}
    >
      {/*
        Wraps rather than clips. The category comes from the model and can be
        several words long ("Strategic Network Diversification"); pinned to the
        right of the heading with `shrink-0` it ran straight off the edge of the
        card, where the card's own `overflow-hidden` silently cut it in half.
      */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-4">
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span
          className={cn(
            SECTION_HEADING,
            "mb-0 text-primary uppercase tracking-widest font-bold",
          )}
        >
          Network Intelligence
        </span>
        {insight && (
          <span className="text-[10px] text-primary sm:ml-auto uppercase tracking-widest font-bold bg-primary/5 px-2 py-0.5 rounded-full ring-1 ring-primary/20 max-w-full truncate">
            {insight.category}
          </span>
        )}
      </div>

      {/* Fixed slot: the height never depends on which state is showing. */}
      <div className="min-h-[4.5rem]">
        {/* Keyed so the crossfade replays on state change, not on re-render. */}
        <div key={state} className="fade-enter">
          {state === "loading" ? (
            <div className="space-y-3" aria-hidden>
              <div className="h-4 bg-primary/20 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-primary/20 rounded animate-pulse w-full" />
              <div className="h-4 bg-primary/20 rounded animate-pulse w-5/6" />
            </div>
          ) : state === "loaded" ? (
            <p className="text-on-surface font-headline text-base sm:text-lg leading-relaxed md:w-11/12 text-pretty">
              {insight!.text}
            </p>
          ) : (
            <p className="text-on-surface-variant text-sm">
              Configure your AI provider API key to receive automated
              relationship insights.
            </p>
          )}
        </div>
      </div>

      <div className="absolute -right-8 -bottom-8 opacity-5 pointer-events-none transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-12">
        <Sparkles className="w-48 h-48 text-primary" />
      </div>
    </div>
  );
};

import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { DailyInsight } from "../../../api";

export interface InsightCardProps {
  insight?: DailyInsight | null;
  isLoading: boolean;
  aiAllowed?: boolean;
}

export const InsightCard = ({
  insight,
  isLoading,
  aiAllowed = true,
}: InsightCardProps) => {
  const categoryBadge = insight?.category ? (
    <span className="text-[11px] text-primary uppercase tracking-wider font-bold bg-primary/10 px-2 py-0.5 rounded-md ring-1 ring-primary/20 max-w-[160px] truncate">
      {insight.category}
    </span>
  ) : null;

  return (
    <CardFrame
      cardId="insight"
      title="Daily insight"
      badge={categoryBadge}
      className="bg-surface-container-low/60 border-primary/20"
    >
      <div className="min-h-[4rem] flex flex-col justify-between gap-3">
        {!aiAllowed ? (
          <p className="text-on-surface-variant text-xs sm:text-sm">
            AI is off for your account.{" "}
            <Link
              to="/settings/privacy#ai-assist"
              className="hit-area inline-flex items-center text-primary hover:underline font-medium"
            >
              Turn on in Settings
            </Link>
          </p>
        ) : isLoading ? (
          <div className="space-y-2.5" aria-hidden>
            <div className="h-3.5 bg-primary/15 rounded animate-pulse w-3/4" />
            <div className="h-3.5 bg-primary/15 rounded animate-pulse w-full" />
            <div className="h-3.5 bg-primary/15 rounded animate-pulse w-5/6" />
          </div>
        ) : insight ? (
          <div className="space-y-3">
            <p className="text-on-surface text-xs sm:text-sm leading-relaxed text-pretty font-medium">
              {insight.text}
            </p>
            <div>
              <Link
                to={`/search?q=${encodeURIComponent(insight.text)}`}
                className="hit-area py-1 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline group"
              >
                <span>Ask a follow-up</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-on-surface-variant text-xs sm:text-sm">
            Configure your AI provider API key in Settings &rarr; AI to receive
            daily relationship insights.
          </p>
        )}
      </div>
    </CardFrame>
  );
};

/**
 * InsightCard: the day's AI observation, or one line that names the next step.
 *
 * With an insight the card is the paragraph, the category as a quiet badge
 * after the title, and one chip, "Ask about this insight", which sends the
 * insight's first sentence to the Ask page. Without one the card is a line
 * that speaks by role: an admin is told to add a key and given the door, a
 * member is told the admin has not added one yet, and an account with AI
 * off is told where the switch is. Nobody reads a framed box that says
 * "configure your provider".
 */
import React from "react";
import { Link } from "react-router-dom";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { useAuth } from "../../../components/auth/AuthGate";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";
import { firstSentence } from "../lib/insight";
import type { DailyInsight } from "../../../api";

export interface InsightCardProps {
  insight?: DailyInsight | null;
  isLoading: boolean;
  aiAllowed?: boolean;
}

/** A link inside a line: the one door the sentence offers. */
const LINE_LINK =
  "hit-area inline-flex items-center font-medium text-primary hover:underline underline-offset-4";

export const InsightCard = ({
  insight,
  isLoading,
  aiAllowed = true,
}: InsightCardProps) => {
  const { isAdmin } = useAuth();

  if (!aiAllowed) {
    return (
      <CardFrame cardId="insight" title="Daily insight" variant="line">
        AI is off for your account.{" "}
        <Link to="/settings/privacy#ai-assist" className={LINE_LINK}>
          Turn on in Settings
        </Link>
      </CardFrame>
    );
  }

  if (isLoading) {
    return (
      <CardFrame cardId="insight" title="Daily insight">
        <div className="space-y-2.5 py-1" aria-busy="true" aria-hidden="true">
          <div className="h-3.5 bg-surface-container-high rounded animate-pulse w-3/4" />
          <div className="h-3.5 bg-surface-container-high rounded animate-pulse w-full" />
          <div className="h-3.5 bg-surface-container-high rounded animate-pulse w-5/6" />
        </div>
      </CardFrame>
    );
  }

  if (!insight) {
    return (
      <CardFrame cardId="insight" title="Daily insight" variant="line">
        {isAdmin ? (
          <>
            Add an AI key to get one.{" "}
            <Link to="/settings/admin/ai" className={LINE_LINK}>
              Open AI settings
            </Link>
          </>
        ) : (
          "Your admin has not added an AI key yet."
        )}
      </CardFrame>
    );
  }

  const question = firstSentence(insight.text);

  return (
    <CardFrame
      cardId="insight"
      title="Daily insight"
      badge={
        insight.category ? (
          <span
            className={cn(
              PULSE_TYPE.meta,
              "inline-flex items-center gap-1 min-w-0 truncate",
            )}
          >
            {/* The AI colour marks AI-derived data, and this is some. */}
            <Sparkles
              className="w-3.5 h-3.5 shrink-0 text-ai"
              aria-hidden="true"
            />
            {insight.category}
          </span>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <p className={cn(PULSE_TYPE.insight, "text-pretty")}>{insight.text}</p>
        {question && (
          <div>
            <Link
              to={`/search?q=${encodeURIComponent(question)}`}
              className="hit-area inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-primary/10 text-on-primary-wash hover:bg-primary/15 transition-colors"
            >
              <MessageCircleQuestion
                className="w-3.5 h-3.5 shrink-0"
                aria-hidden="true"
              />
              Ask about this insight
            </Link>
          </div>
        )}
      </div>
    </CardFrame>
  );
};

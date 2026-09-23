/**
 * InsightCard: the day's AI observation, or one line that names the next step.
 *
 * With an insight the card is the paragraph, the category on a quiet line
 * over it, and one chip, "Ask about this insight", which sends the
 * insight's first sentence to the Ask page. Without one the card is a line
 * that speaks by role: an admin is told to add a key and given the door, a
 * member is told the admin has not added one yet, and an account with AI
 * off is told where the switch is. Nobody reads a framed box that says
 * "configure your provider". While the insight loads, the card holds the
 * shape of an insight, its words drawn as bars.
 */
import React from "react";
import { Link } from "react-router-dom";
import { MessageCircleQuestion, Sparkles } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { InsightPlaceholder } from "../components/PulseSkeleton";
import { useAuth } from "../../../components/auth/AuthGate";
import { TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";
import { firstSentence, sentenceCase } from "../lib/insight";
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

  // On its way, the insight is the card the skeleton drew: its paragraph as
  // bars that wrap like an insight of a common length. With AI on, an
  // insight is the likely answer, and the page lands at its height.
  if (isLoading) {
    return (
      <CardFrame cardId="insight" title="Daily insight">
        <span className="sr-only">Loading</span>
        <InsightPlaceholder />
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
    <CardFrame cardId="insight" title="Daily insight">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          {/* The category the model gave the insight, whole and in
              sentence case, on a quiet line over it. Beside the title it
              was cut to "Relationship Maintenanc…" and pushed the title
              onto two lines. The AI colour marks what a model wrote. */}
          {insight.category && (
            <p className={cn(PULSE_TYPE.meta, "flex items-center gap-1.5")}>
              <Sparkles
                className="w-3.5 h-3.5 shrink-0 text-ai"
                aria-hidden="true"
              />
              {sentenceCase(insight.category)}
            </p>
          )}
          <p className={cn(PULSE_TYPE.insight, "text-pretty")}>
            {insight.text}
          </p>
        </div>
        {question && (
          <div>
            {/* An action, so the primary's wash, and a chip that is a
                control, so the hover layer over it. */}
            <Link
              to={`/search?q=${encodeURIComponent(question)}`}
              className={cn(
                "hit-area state-layer inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                TONE_WASH.primary,
              )}
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

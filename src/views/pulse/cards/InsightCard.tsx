/**
 * InsightCard: the day's AI observation, or one line that names the next step.
 *
 * With an insight the card is the paragraph and the category on a quiet line
 * over it. Without one the card is a line that says why. With no model for
 * the insight it speaks by role: an admin is told to set one up and given
 * the door, a member is told the admin has not yet. With a model set up, the
 * provider failed or wrote nothing, so the line says so and offers Try
 * again: "Add an AI key" was wrong there. An account with AI off is told
 * where the switch is. While the insight loads, the card holds the shape of
 * an insight, its words drawn as bars.
 */
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import { InsightPlaceholder } from "../components/PulseSkeleton";
import { useAuth } from "../../../components/auth/AuthGate";
import { useAISettings } from "../../../api/aiSettings";
import { AI_FEATURES, featureStatus } from "../../../lib/aiFeatures";
import { cn } from "../../../lib/utils";
import { PULSE_TYPE } from "../lib/pulseStyles";
import { sentenceCase } from "../lib/insight";
import type { DailyInsight } from "../../../api";

interface InsightCardProps {
  insight?: DailyInsight | null;
  isLoading: boolean;
  aiAllowed?: boolean;
  /** Ask for the insight again, after a provider that failed. */
  onRetry?: () => void;
}

const INSIGHT = AI_FEATURES.find((feature) => feature.id === "briefings")!;

/** A link inside a line: the one door the sentence offers. */
const LINE_LINK =
  "hit-area inline-flex items-center font-medium text-primary hover:underline underline-offset-4";

export const InsightCard = ({
  insight,
  isLoading,
  aiAllowed = true,
  onRetry,
}: InsightCardProps) => {
  const { isAdmin } = useAuth();
  // Whether a model writes insights. Read only for an empty answer: members
  // may read these settings too.
  const { data: settings } = useAISettings({
    enabled: aiAllowed && !isLoading && !insight,
  });

  if (!aiAllowed) {
    return (
      <CardFrame cardId="insight" title="Daily insight" variant="line">
        AI is off for your account.{" "}
        <Link to="/settings/privacy#ai-assist" className={LINE_LINK}>
          Turn it on in Settings → Privacy and AI
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
    const ready =
      settings &&
      featureStatus(INSIGHT, settings, { accountAiOn: true }).state === "ready";
    return (
      <CardFrame cardId="insight" title="Daily insight" variant="line">
        {!settings ? (
          "No insight today"
        ) : ready ? (
          <>
            Could not write today&apos;s insight.{" "}
            {onRetry && (
              <button type="button" onClick={onRetry} className={LINE_LINK}>
                Try again
              </button>
            )}
          </>
        ) : isAdmin ? (
          <>
            Set up a Fast model to get one.{" "}
            <Link to="/settings/admin/ai" className={LINE_LINK}>
              Open AI settings
            </Link>
          </>
        ) : (
          "Your admin has not set up AI yet"
        )}
      </CardFrame>
    );
  }

  return (
    <CardFrame cardId="insight" title="Daily insight">
      <div className="flex flex-col gap-1.5">
        {/* The category the model gave the insight, whole and in sentence
            case, on a quiet line over it. Beside the title it was cut to
            "Relationship Maintenanc…" and pushed the title onto two lines.
            The AI colour marks what a model wrote. */}
        {insight.category && (
          <p className={cn(PULSE_TYPE.meta, "flex items-center gap-1.5")}>
            <Sparkles
              className="w-3.5 h-3.5 shrink-0 text-ai"
              aria-hidden="true"
            />
            {sentenceCase(insight.category)}
          </p>
        )}
        <p className={cn(PULSE_TYPE.insight, "text-pretty")}>{insight.text}</p>
      </div>
    </CardFrame>
  );
};

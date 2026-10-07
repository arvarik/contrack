/**
 * Why an AI button waits, and the link that fixes it for a person who can:
 * "No AI model is set up. Connect a provider in Settings → Administration →
 * AI". Every waiting AI button says it this way.
 */
import { Link } from "react-router-dom";
import { aiSetupLine, type AiSetup } from "../hooks/useAiSetup";
import { TEXT_LINK } from "../lib/styles";
import { cn } from "../lib/utils";

export const AiSetupNote = ({
  setup,
  onNavigate,
  className,
}: {
  setup: AiSetup;
  /** Runs when the link is followed: a dialog closes itself. */
  onNavigate?: () => void;
  className?: string;
}) => (
  <p className={cn("text-xs text-on-surface-variant text-pretty", className)}>
    {aiSetupLine(setup)}
    {setup.fix && (
      <>
        {". "}
        <Link to={setup.fix.path} onClick={onNavigate} className={TEXT_LINK}>
          {setup.fix.label}
        </Link>
      </>
    )}
  </p>
);

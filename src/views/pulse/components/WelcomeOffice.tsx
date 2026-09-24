import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Upload,
  PenLine,
  Bot,
  Calendar,
  ChevronRight,
} from "lucide-react";
import { CARD, KBD_SM, LABEL_PRIMARY, TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../components/auth/AuthGate";
import { SETTINGS_PAGES } from "../../settings/registry";
import { openQuickNote } from "../../../lib/appEvents";
import { PULSE_ROW } from "../lib/pulseStyles";

/** One step: a row on the wash, the whole row the control. */
const STEP = cn(
  PULSE_ROW,
  "w-full justify-between p-4 text-left cursor-pointer",
);

/** A step's glyph, in the primary's wash: each step is an action to take. */
const STEP_ICON = cn("p-2 rounded-lg mt-0.5 shrink-0", TONE_WASH.primary);

/** A step's name. */
const STEP_TITLE = "text-sm font-bold text-on-surface block";

/** The chevron that says the step goes somewhere. */
const STEP_CHEVRON =
  "w-5 h-5 text-on-surface-variant group-hover:text-on-surface shrink-0 transition-transform group-hover:translate-x-0.5";

export const WelcomeOffice = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const hasConnectorsPage = SETTINGS_PAGES.some(
    (p) => p.id === "connectors" || p.path === "/settings/connectors",
  );

  const aiSettingsPath = isAdmin
    ? "/settings/admin/ai"
    : "/settings/privacy#ai-assist";

  return (
    // The inner block sets the inset. The card's own padding came on top of
    // it and a phone lost 96 of its 358 px to padding.
    <div className={cn(CARD, "p-0")}>
      <div className="p-6 sm:p-8 space-y-6">
        <div>
          <div className={cn(LABEL_PRIMARY, "flex items-center gap-2 mb-2")}>
            <Sparkles className="w-4 h-4" />
            <span>Welcome to Pulse</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold font-headline text-on-surface">
            Bring your people in
          </h2>
          <p className="text-sm text-on-surface-variant mt-1">
            Import contacts and log a note. Pulse fills itself from there
          </p>
        </div>

        <div className="space-y-3">
          {/* Step 1: Import contacts */}
          <button onClick={() => navigate("/?import=1")} className={STEP}>
            <div className="flex items-start gap-3.5">
              <div className={STEP_ICON}>
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <span className={STEP_TITLE}>Import contacts</span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Bring in contacts from a CSV or vCard file
                </span>
              </div>
            </div>
            <ChevronRight className={STEP_CHEVRON} />
          </button>

          {/* Step 2: Log your first note */}
          <button onClick={() => openQuickNote()} className={STEP}>
            <div className="flex items-start gap-3.5">
              <div className={STEP_ICON}>
                <PenLine className="w-5 h-5" />
              </div>
              <div>
                <span className={STEP_TITLE}>Log your first note</span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Record a recent interaction or set a follow-up date
                  {/* A phone has no keyboard to press it on. */}
                  <span className="hidden sm:inline">
                    {" "}
                    (press <kbd className={KBD_SM}>⌘⇧I</kbd>)
                  </span>
                </span>
              </div>
            </div>
            <ChevronRight className={STEP_CHEVRON} />
          </button>

          {/* Step 3: Connect AI */}
          <Link to={aiSettingsPath} className={STEP}>
            <div className="flex items-start gap-3.5">
              <div className={STEP_ICON}>
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <span className={STEP_TITLE}>Connect AI</span>
                <span className="text-xs text-on-surface-variant mt-0.5 block">
                  Enable relationship analysis, smart parsing, and daily
                  insights
                </span>
              </div>
            </div>
            <ChevronRight className={STEP_CHEVRON} />
          </Link>

          {/* Step 4: Connect a calendar (hidden without connectors page) */}
          {hasConnectorsPage && (
            <Link to="/settings/connectors" className={STEP}>
              <div className="flex items-start gap-3.5">
                <div className={STEP_ICON}>
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <span className={STEP_TITLE}>Connect a calendar</span>
                  <span className="text-xs text-on-surface-variant mt-0.5 block">
                    Sync meetings and automatically track upcoming interactions
                  </span>
                </div>
              </div>
              <ChevronRight className={STEP_CHEVRON} />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

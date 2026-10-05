/**
 * The palette's `?` mode: ask AI about the network.
 *
 * It renders in three parts, because the list is a listbox and holds rows
 * only (`aria-required-children`): `notes` above the list (the intro, the
 * waits, a warning), `rows` inside it (the starters, the answer, a link to
 * set AI up) and `after` below it (the brief and the links out).
 *
 * When AI cannot answer, the mode says why and how to fix it. Without a
 * model, the answer used to say "AI could not check these people this
 * time", as if it were a passing outage, and offered a brief that failed.
 *
 * @module components/command-palette/AiMode
 */
import { useMemo } from "react";
import { Command } from "cmdk";
import { ArrowUpRight, HelpCircle, Settings, Sparkles } from "lucide-react";
import { useAISettings } from "../../api/aiSettings";
import { AI_FEATURES, featureStatus } from "../../lib/aiFeatures";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";
import type { SemanticMatch } from "../../types";
import { useAuth } from "../auth/AuthGate";
import { AIResultCard, AIShimmerRow } from "./AiComponents";
import { AiStarters } from "./AiStarters";
import { SynthesisBar } from "./SynthesisBar";
import {
  aiResultsHeading,
  GROUP_HEADING_DEFAULT,
  GROUP_HEADING_PRIMARY,
  ITEM_CURRENT,
} from "./utils";

/** Why AI cannot answer, and the page that fixes it, if this person can. */
export interface AiSetup {
  why: "account" | "instance" | "model";
  fix?: { label: string; path: string };
}

const ASK = AI_FEATURES.find((feature) => feature.id === "ask")!;

/**
 * Whether Ask has AI behind it, read the way Settings reads it
 * (`featureStatus`). Null while it is ready, and while the settings load.
 */
export function useAiSetup(enabled: boolean, aiAllowed: boolean) {
  const { data: settings } = useAISettings({ enabled: enabled && aiAllowed });
  const { isAdmin } = useAuth();
  return useMemo((): AiSetup | null => {
    if (!aiAllowed) {
      return {
        why: "account",
        fix: {
          label: "Turn AI on in Privacy and AI",
          path: "/settings/privacy",
        },
      };
    }
    if (!settings) return null;
    const status = featureStatus(ASK, settings, { accountAiOn: true });
    if (status.state === "ready") return null;
    return {
      why: settings.instance.aiOff ? "instance" : "model",
      fix:
        isAdmin && status.fix
          ? {
              label: `${status.fix.label} on Administration → AI`,
              path: `/settings/admin/ai#${status.fix.anchor}`,
            }
          : undefined,
    };
  }, [aiAllowed, settings, isAdmin]);
}

/** The line about AI's state: what is off, and who can turn it on. */
const SETUP_WORDS: Record<AiSetup["why"], { state: string; ask: string }> = {
  account: { state: "AI is off for your account", ask: "" },
  instance: {
    state: "AI is off on this instance",
    ask: "Ask an admin to turn it on",
  },
  model: { state: "No AI model is set up", ask: "Ask an admin to set one up" },
};

const CENTERED = "py-8 text-center text-sm text-on-surface-variant";

export interface AiModeProps {
  part: "notes" | "rows" | "after";
  /** The question, without the `?`. */
  question: string;
  /** Typed, and the palette waits for the typing to stop. */
  waiting: boolean;
  loading: boolean;
  /** The answer arrived, perhaps with nobody in it. */
  answered: boolean;
  error: string | null;
  results: SemanticMatch[];
  total: number;
  fallback: boolean;
  /** The question the answer is for: the brief reads it. */
  answeredQuery: string;
  setup: AiSetup | null;
  onPickStarter: (question: string) => void;
  onOpenContact: (id: string) => void;
  onNavigate: (path: string) => void;
}

export const AiMode = (props: AiModeProps) => {
  const { part, question, setup, results, fallback } = props;
  const showResults =
    question.length >= 3 && !props.loading && results.length > 0;
  const setupLine = setup
    ? [SETUP_WORDS[setup.why].state, !setup.fix && SETUP_WORDS[setup.why].ask]
        .filter(Boolean)
        .join(". ")
    : null;

  if (part === "notes") {
    if (props.error) {
      return (
        <div role="alert" className="px-4 py-3 text-sm text-error">
          {props.error}
        </div>
      );
    }
    if (question.length === 0) {
      return (
        <div className="pt-6 pb-3 text-center text-sm text-on-surface-variant">
          <Sparkles className="w-8 h-8 text-primary mx-auto mb-3" />
          <p className="font-bold text-on-surface mb-1">Ask AI</p>
          <p className="text-xs">
            Ask anything about your network in plain English
          </p>
          {setupLine && (
            <p className="mt-3 mx-auto max-w-md text-xs text-warning text-balance">
              {setupLine}. Answers use keyword and meaning search only
            </p>
          )}
        </div>
      );
    }
    if (question.length < 3) {
      return <p className={CENTERED}>Keep typing your question…</p>;
    }
    if (props.loading) {
      // For the whole wait: the first list the server streams is a guess
      // AI has not checked yet, so the palette keeps it back.
      return (
        <div className="px-1 py-2 space-y-1">
          <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-primary flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 animate-pulse" /> Asking AI…
          </p>
          <AIShimmerRow delay={0} />
          <AIShimmerRow delay={0.08} />
          <AIShimmerRow delay={0.16} />
        </div>
      );
    }
    if (props.waiting) {
      return <p className={CENTERED}>Asks when you stop typing…</p>;
    }
    if (props.answered && results.length === 0) {
      return (
        <div className={CENTERED}>
          <p className="font-bold text-on-surface mb-1">No matches found</p>
          <p className="text-xs">
            Try other words, or search people without the ?
          </p>
        </div>
      );
    }
    if (showResults && fallback) {
      return (
        <p className="flex items-start gap-1.5 px-3 pt-2 text-xs text-warning">
          <HelpCircle
            className="w-3.5 h-3.5 mt-px shrink-0"
            aria-hidden="true"
          />
          {setupLine ?? "AI could not check these people this time"}. They match
          your words or their meaning
        </p>
      );
    }
    return null;
  }

  // A row to the page that turns AI on: under the intro, and under an
  // answer AI did not check.
  const setupRow = setup?.fix &&
    (question.length === 0 || (showResults && fallback)) && (
      <Command.Group heading="Set up AI" className={GROUP_HEADING_DEFAULT}>
        <Command.Item
          value={`setup_${setup.why}`}
          onSelect={() => props.onNavigate(setup.fix!.path)}
          className={cn(
            "flex items-center gap-3 px-3 py-2 min-h-[44px] pointer-fine:min-h-0 rounded-xl cursor-default select-none transition-colors text-sm text-on-surface",
            ITEM_CURRENT,
          )}
        >
          <Settings className="w-4 h-4 shrink-0 text-on-surface-variant" />
          <span className="truncate">{setup.fix.label}</span>
        </Command.Item>
      </Command.Group>
    );

  if (part === "rows") {
    if (question.length === 0) {
      // Setting AI up first: without it the starters get a local answer.
      return (
        <>
          {setupRow}
          <AiStarters onPick={props.onPickStarter} />
        </>
      );
    }
    if (!showResults) return null;
    return (
      <>
        <Command.Group
          heading={aiResultsHeading(fallback, results.length, props.total)}
          className={GROUP_HEADING_PRIMARY}
        >
          {results.map((match, i) => (
            <AIResultCard
              key={match.id}
              match={match}
              index={i}
              isFallback={fallback}
              onSelect={() => props.onOpenContact(match.id)}
            />
          ))}
        </Command.Group>
        {setupRow}
      </>
    );
  }

  if (!showResults) return null;
  const link = (path: string, label: string) => (
    <button
      type="button"
      onClick={() => props.onNavigate(path)}
      className="hit-area text-xs text-primary flex items-center gap-1 group"
    >
      {label}
      <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
    </button>
  );
  return (
    <>
      {/* A brief needs a model, and a list AI did not check is no basis. */}
      {!setup && !fallback && (
        <SynthesisBar
          query={props.answeredQuery}
          contacts={results}
          resultCount={results.length}
          compact
        />
      )}
      <div className="px-3 py-2 flex flex-wrap justify-end gap-x-4 gap-y-1">
        {link(
          `/search?mode=notes&q=${encodeURIComponent(question)}`,
          "Search notes",
        )}
        {link(
          `/search?q=${encodeURIComponent(question)}`,
          `Open in ${NAMES.ask.label}`,
        )}
      </div>
    </>
  );
};

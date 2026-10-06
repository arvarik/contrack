/**
 * EngineChoice: what contact research searches the web with.
 *
 * ```
 * ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────────┐
 * │ ◉ Google Gemini   │ │ ○ SearXNG         │ │ ○ Google Gemini and       │
 * │   Its own web     │ │   Needs a SearXNG │ │   SearXNG                 │
 * │   search…         │ │   address         │ │   Needs a SearXNG address │
 * └───────────────────┘ └───────────────────┘ └───────────────────────────┘
 * SearXNG is not set up. Set it up in Administration → AI.
 * ```
 *
 * One value, shown where it is set and where it is used:
 *
 * - `scope="instance"` on Administration → AI → Web search: the instance's
 *   engine, which an account that keeps "Instance default" searches with.
 * - `scope="account"` on Contact enrichment: this account's engine. With
 *   more than one account it is the account's own choice, and its first
 *   tile is "Instance default (…)". With one account, that account is the
 *   admin and the instance is theirs alone, so the tile sets the instance's
 *   engine, the same value as the AI page, and there is no "Instance
 *   default" to explain.
 *
 * An engine that cannot run stays as a disabled tile that says what it
 * lacks, rather than disappearing. The line under the tiles says what
 * research does about it, with a link to the setup for an admin and "Ask
 * your admin" for a member.
 *
 * @module views/settings/EngineChoice
 */
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChoiceGroup, type Choice } from "../../components/ui/ChoiceGroup";
import { useAuth } from "../../components/auth/AuthGate";
import { usePreferences } from "../../contexts/PreferencesContext";
import { useAISettings, useSetWebSearch } from "../../api/aiSettings";
import {
  AI_FEATURES,
  featureStatus,
  NEED_ANCHORS,
  webSearchProvider,
} from "../../lib/aiFeatures";
import {
  choiceName,
  ENGINE_HINT,
  engineName,
  NEED_WORDS,
} from "../../lib/webSearchEngine";
import {
  engineFor,
  WEB_SEARCH_ENGINES,
  type EngineChoice as Choosable,
  type EngineNeed,
  type WebSearchEngine,
} from "../../../shared/webSearchEngine";
import { cn } from "../../lib/utils";
import { TOUCH_LINK } from "./layout";

const RESEARCH = AI_FEATURES.find((feature) => feature.id === "research")!;

/** Where an admin sets web search up. */
const AI_PAGE = "/settings/admin/ai";

/** Where an admin fixes the first need an engine lacks. */
function setupLink(need: EngineNeed | undefined): string {
  return `${AI_PAGE}#${NEED_ANCHORS[need ?? "web-search"]}`;
}

interface EngineChoiceProps {
  /** The instance's engine, or this account's. */
  scope: "instance" | "account";
}

export function EngineChoice({ scope }: EngineChoiceProps) {
  const { data: settings } = useAISettings();
  const { isAdmin } = useAuth();
  const { preferences, setPreference } = usePreferences();
  const setWebSearch = useSetWebSearch();

  // Tile-shaped placeholders while the settings load, so the page under the
  // tiles does not jump when they arrive.
  if (!settings)
    return (
      <ul
        aria-busy="true"
        aria-label="Loading web search engines"
        className="grid gap-2 sm:grid-cols-3"
      >
        {[0, 1, 2].map((tile) => (
          <li
            key={tile}
            className="h-20 rounded-xl bg-surface-container-low animate-pulse"
          />
        ))}
      </ul>
    );
  const { webSearch } = settings;
  const provider = webSearchProvider(settings);
  // With one account the account's engine is the instance's.
  const instanceScope =
    scope === "instance" || (isAdmin && !settings.multipleAccounts);
  const accountChoice = preferences.webSearchEngine;

  const engineTile = (engine: WebSearchEngine): Choice<Choosable> => {
    const state = webSearch.engines[engine];
    // "Off" is said once, under the tiles. A tile names the setup it lacks,
    // or else what it does.
    const lacks = state.missing.find((need) => need !== "off");
    return {
      value: engine,
      label: engineName(engine, provider),
      hint: lacks ? NEED_WORDS[lacks] : ENGINE_HINT[engine],
      disabled: !state.available,
    };
  };
  const tiles: Choice<Choosable>[] = [
    ...(instanceScope
      ? []
      : [
          {
            value: "default" as const,
            label: choiceName("default", webSearch.engine, provider),
            hint: "The engine set for everyone here",
          },
        ]),
    ...WEB_SEARCH_ENGINES.map(engineTile),
  ];

  // The instance's value, or the account's. On a one-account instance, an
  // engine the account chose before also counts until the next choice.
  const value: Choosable = instanceScope
    ? engineFor(
        scope === "instance" ? "default" : accountChoice,
        webSearch.engine,
      )
    : accountChoice;

  const choose = (next: Choosable) => {
    if (!instanceScope) {
      setPreference("webSearchEngine", next);
      return;
    }
    if (next === "default") return;
    setWebSearch.mutate(
      { engine: next },
      {
        onSuccess: () => {
          // One value: an engine this account chose before gives way.
          if (scope === "account" && accountChoice !== "default")
            setPreference("webSearchEngine", "default");
          toast.success(`Research searches with ${engineName(next, provider)}`);
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const status = featureStatus(
    RESEARCH,
    settings,
    scope === "account"
      ? { engineChoice: accountChoice, accountAiOn: preferences.aiAssist }
      : {},
  );
  // The first need of the chosen engine, else of the first that cannot run.
  const blocked = [value, ...WEB_SEARCH_ENGINES]
    .filter((engine): engine is WebSearchEngine => engine !== "default")
    .map((engine) => webSearch.engines[engine])
    .find((state) => !state.available);
  // What to do about it, on Contact enrichment: an admin goes to the setup,
  // a member asks for it. The AI page is the setup, so it needs neither.
  const aiOff = settings.instance.aiOff || preferences.aiAssist === false;
  const next =
    scope !== "account" || aiOff
      ? null
      : isAdmin
        ? blocked && (
            <Link
              to={setupLink(blocked.missing[0])}
              className={cn(
                "font-semibold text-primary hover:underline",
                TOUCH_LINK,
              )}
            >
              {webSearch.allowed ? "Set up web search" : "Turn web search on"}
            </Link>
          )
        : !webSearch.allowed
          ? null
          : status.state !== "ready"
            ? "Ask your admin to set it up"
            : null;
  const reason =
    !webSearch.allowed && !isAdmin && scope === "account"
      ? "An admin turned web search off"
      : status.reason;

  return (
    <div className="space-y-2">
      <ChoiceGroup
        label="Web search engine"
        value={value}
        options={tiles}
        onChange={choose}
        pending={setWebSearch.isPending}
        className={instanceScope ? "sm:grid-cols-3" : "sm:grid-cols-2"}
      />
      {(reason || next) && (
        <p className="text-xs text-on-surface-variant text-pretty">
          {reason}
          {reason && next && ". "}
          {next}
        </p>
      )}
    </div>
  );
}

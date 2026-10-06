/**
 * aiFeatures: what each AI feature uses, in one table.
 *
 * Models are chosen by role on Settings → Administration → AI (the Fast model, the
 * Strong model, the embedding model), but people think by feature: "why
 * did research find nothing", "what reads my notes". This table maps one to
 * the other, and every place that says which model does what reads it:
 *
 *   - the "What each feature uses" list on Settings → Administration → AI, with a link
 *     from each part to its control
 *   - the same list, read-only, on Privacy and AI
 *   - the "Used by" line under each model on Settings → Administration → AI
 *
 * `featureStatus` says whether a feature works now, and if not, why, from
 * the same settings view the pages read.
 *
 * @module lib/aiFeatures
 */
import type { AISettings } from "../api/aiSettings";
import {
  engineFor,
  type EngineChoice,
  type EngineNeed,
  type WebSearchEngine,
} from "../../shared/webSearchEngine";
import { engineName, NEED_WORDS } from "./webSearchEngine";

/** One kind of AI a feature uses: a model role, the reranker, or web search. */
export type AiRole = "fast" | "strong" | "embedding" | "reranker" | "webSearch";

/** Each role's name, as the AI page's controls are named. */
const ROLE_NAMES: Record<AiRole, string> = {
  fast: "Fast model",
  strong: "Strong model",
  embedding: "Embedding model",
  reranker: "Reranker",
  webSearch: "Web search",
};

/** The row on Settings → Administration → AI where each role is changed. */
export const ROLE_ANCHORS: Record<AiRole, string> = {
  fast: "fast-model",
  strong: "strong-model",
  embedding: "embedding-model",
  reranker: "reranker",
  webSearch: "web-search-engine",
};

/** The capability behind each model role, in the settings view. */
const ROLE_CAPABILITY = {
  fast: "quick",
  strong: "deep",
  embedding: "embeddings",
} as const;

interface FeaturePart {
  role: AiRole;
  /** What this part does for the feature. */
  does: string;
  /** The feature works without it, with less. */
  optional?: boolean;
  /** Only for these engines (contact research's Strong model). */
  engines?: readonly WebSearchEngine[];
}

export interface AiFeature {
  id: string;
  name: string;
  /** What the feature does, in a line. */
  does: string;
  parts: readonly FeaturePart[];
}

export const AI_FEATURES: readonly AiFeature[] = [
  {
    id: "ask",
    name: "Ask Contrack",
    does: "Answers questions about your network",
    parts: [
      { role: "embedding", does: "Finds people by meaning" },
      { role: "reranker", does: "Orders the results", optional: true },
      {
        role: "fast",
        does: "Understands the question and checks the answers",
        optional: true,
      },
    ],
  },
  {
    id: "research",
    name: "Contact research",
    does: "Finds public facts about a contact on the web",
    parts: [
      { role: "webSearch", does: "Searches the web" },
      {
        role: "strong",
        does: "Reads SearXNG's pages",
        engines: ["searxng", "combined"],
      },
      { role: "fast", does: "Fills the fields" },
    ],
  },
  {
    id: "duplicates",
    name: "Duplicates",
    does: "Finds contacts that are the same person",
    parts: [
      { role: "embedding", does: "Finds close matches" },
      {
        role: "strong",
        does: "Decides unclear pairs in an AI scan",
        optional: true,
      },
    ],
  },
  {
    id: "briefings",
    name: "Briefings and insights",
    does: "Briefings, and the daily insight on Pulse",
    parts: [{ role: "fast", does: "Writes them" }],
  },
  {
    id: "text",
    name: "Add from text and notes",
    does: "Reads pasted text, and the people named in notes",
    parts: [{ role: "fast", does: "Reads the text" }],
  },
  {
    id: "mail",
    name: "Email summaries",
    does: "Summaries of synced mail and of email files",
    parts: [
      { role: "fast", does: "Summarizes synced mail" },
      { role: "strong", does: "Summarizes email files" },
    ],
  },
];

/** The features that use a role, by name: the "Used by" line of a model. */
export function featuresUsing(role: AiRole): string[] {
  return AI_FEATURES.filter((feature) =>
    feature.parts.some((part) => part.role === role),
  ).map((feature) => feature.name);
}

/** Whose view of the features: the instance's, or one account's. */
export interface FeatureViewer {
  /** The account's own AI switch, for its view. Undefined for the instance's. */
  accountAiOn?: boolean;
  /** The account's engine choice, for its view. Undefined for the instance's. */
  engineChoice?: EngineChoice;
}

/** What a feature's status is. */
export type FeatureState = "ready" | "limited" | "off" | "setup";

export const STATE_WORDS: Record<FeatureState, string> = {
  ready: "Ready",
  limited: "Limited",
  off: "Off",
  setup: "Needs setup",
};

export interface FeatureStatus {
  state: FeatureState;
  /** Why it is not ready, in a sentence. */
  reason?: string;
  /**
   * What an admin does about it on Settings → Administration → AI: the words of a
   * link, and the row it goes to. None for an account's own switch, which
   * is on its own page.
   */
  fix?: FeatureFix;
}

interface FeatureFix {
  label: string;
  /** A row on Settings → Administration → AI. */
  anchor: string;
}

/** The row on Settings → Administration → AI that gives an engine a need it lacks. */
export const NEED_ANCHORS: Record<EngineNeed, string> = {
  off: "allow-web-search",
  "web-search": "searxng",
  research: "web-search-model",
  deep: "strong-model",
  quick: "fast-model",
};

/** The link that fixes a need, in a few words. */
const NEED_FIX: Record<EngineNeed, FeatureFix> = {
  off: { label: "Turn web search on", anchor: NEED_ANCHORS.off },
  "web-search": {
    label: "Add a SearXNG address",
    anchor: NEED_ANCHORS["web-search"],
  },
  research: { label: "Connect a provider", anchor: "providers" },
  deep: { label: "Choose a Strong model", anchor: NEED_ANCHORS.deep },
  quick: { label: "Choose a Fast model", anchor: NEED_ANCHORS.quick },
};

/** One part of a feature as the list shows it: the role and what runs it. */
export interface FeaturePartView {
  role: AiRole;
  name: string;
  does: string;
  /** What runs it now: "Google Gemini", "Built-in", or "Not set". */
  runs: string;
}

/** The engine a viewer's research searches with. */
function viewerEngine(
  settings: AISettings,
  viewer: FeatureViewer,
): WebSearchEngine {
  return engineFor(viewer.engineChoice ?? "default", settings.webSearch.engine);
}

/** The web search model's provider, such as "Google Gemini", or null. */
export function webSearchProvider(settings: AISettings): string | null {
  return settings.capabilities.research?.resolved?.providerLabel ?? null;
}

/** What runs a role now, in a word or two. */
function runsRole(
  role: AiRole,
  settings: AISettings,
  engine: WebSearchEngine,
): string {
  if (role === "reranker") return settings.reranker.model ? "Built-in" : "Off";
  if (role === "webSearch")
    return engineName(engine, webSearchProvider(settings));
  const resolved = settings.capabilities[ROLE_CAPABILITY[role]]?.resolved;
  return resolved ? resolved.providerLabel : "Not set";
}

/** A feature's parts that apply now, with what runs each. */
export function featureParts(
  feature: AiFeature,
  settings: AISettings,
  viewer: FeatureViewer = {},
): FeaturePartView[] {
  const engine = viewerEngine(settings, viewer);
  return feature.parts
    .filter((part) => !part.engines || part.engines.includes(engine))
    .map((part) => ({
      role: part.role,
      name: ROLE_NAMES[part.role],
      does: part.does,
      runs: runsRole(part.role, settings, engine),
    }));
}

/** Whether a model role is set up and served now. */
function serves(settings: AISettings, role: "fast" | "strong"): boolean {
  return !!settings.capabilities[ROLE_CAPABILITY[role]]?.resolved;
}

/**
 * Whether a feature works now, for the instance or for one account, and
 * why not when it does not.
 */
export function featureStatus(
  feature: AiFeature,
  settings: AISettings,
  viewer: FeatureViewer = {},
): FeatureStatus {
  const instanceOff = settings.instance.aiOff;
  const accountOff = viewer.accountAiOn === false;
  if (instanceOff || accountOff) {
    const why = instanceOff
      ? "AI is off on this instance"
      : "AI is off for your account";
    const fix = instanceOff
      ? { label: "Turn AI on", anchor: "ai-instance" }
      : undefined;
    if (feature.id === "ask")
      return { state: "limited", reason: `Local search only. ${why}`, fix };
    if (feature.id === "duplicates")
      return { state: "limited", reason: `Exact scan only. ${why}`, fix };
    return { state: "off", reason: why, fix };
  }

  const fast = serves(settings, "fast");
  const strong = serves(settings, "strong");
  switch (feature.id) {
    case "ask":
      return fast
        ? { state: "ready" }
        : {
            state: "limited",
            reason: "Local search only. AI answers need a Fast model",
            fix: NEED_FIX.quick,
          };
    case "research":
      return researchStatus(settings, viewer);
    case "duplicates":
      return strong
        ? { state: "ready" }
        : {
            state: "limited",
            reason: "AI scans need a Strong model",
            fix: NEED_FIX.deep,
          };
    case "mail":
      if (fast && strong) return { state: "ready" };
      if (!fast && !strong)
        return {
          state: "setup",
          reason: "Needs a Fast and a Strong model",
          fix: NEED_FIX.quick,
        };
      return fast
        ? {
            state: "limited",
            reason: "Email files need a Strong model",
            fix: NEED_FIX.deep,
          }
        : {
            state: "limited",
            reason: "Synced mail needs a Fast model",
            fix: NEED_FIX.quick,
          };
    default:
      return fast
        ? { state: "ready" }
        : { state: "setup", reason: "Needs a Fast model", fix: NEED_FIX.quick };
  }
}

/**
 * Contact research: off when web search is off, ready when the engine can
 * run, limited when only another engine can (research gives way to it),
 * and needing setup when none can.
 */
function researchStatus(
  settings: AISettings,
  viewer: FeatureViewer,
): FeatureStatus {
  const { webSearch } = settings;
  if (!webSearch.allowed)
    return { state: "off", reason: "Web search is off", fix: NEED_FIX.off };
  const engine = viewerEngine(settings, viewer);
  const state = webSearch.engines[engine];
  if (state.available) return { state: "ready" };
  const provider = webSearchProvider(settings);
  const fallback = (["provider", "searxng"] as const).find(
    (other) => webSearch.engines[other].available,
  );
  // "Needs a SearXNG address" as a clause: only its first letter lowers.
  const need = NEED_WORDS[state.missing[0]];
  const lacks = need.charAt(0).toLowerCase() + need.slice(1);
  if (fallback)
    return {
      state: "limited",
      reason: `${engineName(engine, provider)} ${lacks}, so research searches with ${engineName(fallback, provider)}`,
      fix: NEED_FIX[state.missing[0]],
    };
  // A stack with SearXNG and no web search model is set up for SearXNG, so
  // its missing need is the one to name, as the server does.
  const named =
    !provider && webSearch.searxng.configured
      ? webSearch.engines.searxng
      : state;
  return {
    state: "setup",
    reason: NEED_WORDS[named.missing[0]],
    fix: NEED_FIX[named.missing[0]],
  };
}

/**
 * The engine a start runs: the chosen one when it can run, else the first
 * that can, as the server gives way (`chooseResearch`), else null.
 */
export function engineThatRuns(
  settings: AISettings,
  engine: WebSearchEngine,
): WebSearchEngine | null {
  const { engines } = settings.webSearch;
  if (engines[engine].available) return engine;
  return (
    (["provider", "searxng"] as const).find(
      (other) => engines[other].available,
    ) ?? null
  );
}

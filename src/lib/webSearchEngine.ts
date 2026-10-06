/**
 * The words for what contact research searches the web with, wherever an
 * engine is named: the web search model's own search, named by its provider,
 * a self-hosted SearXNG, or both. Each tile says what it costs, because the
 * provider bills its searches, and SearXNG's are free while the Strong model
 * that reads the pages is not.
 */
import type {
  EngineChoice,
  EngineNeed,
  WebSearchEngine,
} from "../../shared/webSearchEngine";

/** The provider's name when no web search model is connected. */
const NO_PROVIDER = "Web search model";

/**
 * An engine's name: the provider (null when none is connected), "SearXNG",
 * or both, "Google Gemini and SearXNG".
 */
export function engineName(
  engine: WebSearchEngine,
  provider: string | null,
): string {
  if (engine === "searxng") return "SearXNG";
  const name = provider ?? NO_PROVIDER;
  return engine === "combined" ? `${name} and SearXNG` : name;
}

/** What each engine does, and what it costs, in a line. */
export const ENGINE_HINT: Record<WebSearchEngine, string> = {
  provider: "Its own web search. The provider bills each search",
  searxng: "Free searches on your SearXNG. The Strong model reads the pages",
  combined: "Both at once, for the most facts. It costs both",
};

/** What an engine lacks, in a few words, for its disabled tile. */
export const NEED_WORDS: Record<EngineNeed, string> = {
  off: "Web search is off",
  "web-search": "Needs a SearXNG address",
  research: "Needs a web search model",
  deep: "Needs a Strong model",
  quick: "Needs a Fast model",
};

/** An account's choice as its tile names it: "Instance default (SearXNG)". */
export function choiceName(
  choice: EngineChoice,
  instanceEngine: WebSearchEngine,
  provider: string | null,
): string {
  return choice === "default"
    ? `Instance default (${engineName(instanceEngine, provider)})`
    : engineName(choice, provider);
}

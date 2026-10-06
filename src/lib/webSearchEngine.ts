/**
 * webSearchEngine: the words for what contact research searches the web
 * with, wherever an engine is named: Settings → AI → Web search, the
 * Contact enrichment page, its confirmation, and a contact's Enrich menu.
 *
 * Three engines (`shared/webSearchEngine`): the web search model's own
 * search, named by its provider ("Google Gemini"), a self-hosted SearXNG,
 * or both at once. Each tile says what the engine does and what it costs,
 * because the choice changes the bill: the provider bills its searches,
 * and SearXNG's searches are free while the Strong model that reads the
 * pages is not.
 *
 * @module lib/webSearchEngine
 */
import type {
  EngineChoice,
  EngineNeed,
  WebSearchEngine,
} from "../../shared/webSearchEngine";

/** The provider's name when no web search model is connected. */
const NO_PROVIDER = "Web search model";

/**
 * An engine's name: the provider for its own search, "SearXNG", or both
 * named, "Google Gemini and SearXNG".
 *
 * @param provider - The web search model's provider, such as "Google
 *   Gemini", or null when none is connected.
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

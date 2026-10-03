// =============================================================================
// Web search engine: what contact research searches the web with
// =============================================================================
// Three engines, each run by a strategy on the server:
//
//   provider  the web search model's own search ("two-pass"), the default
//   searxng   a self-hosted SearXNG runs the searches, and the Strong model
//             reads the pages ("searxng")
//   combined  both at once, with the facts of both kept ("combined")
//
// An admin sets the instance's engine (Settings → Administration → AI → Web
// search). An account keeps "Instance default" or chooses its own on Contact
// enrichment (the `webSearchEngine` preference). Every start that names no
// strategy uses the account's engine: the Enrichment page, a contact's Enrich
// menu, "Enrich new contacts automatically", and an API call. An engine that
// cannot run, such as SearXNG with no address, gives way to one that can.
// =============================================================================

import { z } from "zod";

export const webSearchEngineSchema = z.enum([
  "provider",
  "searxng",
  "combined",
]);

export type WebSearchEngine = z.infer<typeof webSearchEngineSchema>;

/** The engines in the order a choice lists them: the default first. */
export const WEB_SEARCH_ENGINES: readonly WebSearchEngine[] =
  webSearchEngineSchema.options;

/** The instance's engine before an admin chooses. */
export const DEFAULT_WEB_SEARCH_ENGINE: WebSearchEngine = "provider";

/** An account's choice: the instance's engine, or one of its own. */
export const engineChoiceSchema = z.enum([
  "default",
  ...webSearchEngineSchema.options,
]);

export type EngineChoice = z.infer<typeof engineChoiceSchema>;

/** The engine an account's choice runs: its own, or the instance's. */
export function engineFor(
  choice: EngineChoice,
  instanceEngine: WebSearchEngine,
): WebSearchEngine {
  return choice === "default" ? instanceEngine : choice;
}

/**
 * The strategy each engine runs as. Every provider researches with
 * two-pass, which is the server's default whenever a provider serves
 * research.
 */
export const ENGINE_STRATEGY: Record<
  WebSearchEngine,
  "two-pass" | "searxng" | "combined"
> = {
  provider: "two-pass",
  searxng: "searxng",
  combined: "combined",
};

/**
 * What an engine needs before it can run, as the server reports it:
 *
 *   off         an admin turned web search off
 *   web-search  a SearXNG address
 *   research    a web search model (Gemini, OpenAI or Anthropic)
 *   deep        a Strong model, which reads SearXNG's pages
 *   quick       a Fast model, which fills the fields
 */
export const ENGINE_NEEDS = [
  "off",
  "web-search",
  "research",
  "deep",
  "quick",
] as const;

export type EngineNeed = (typeof ENGINE_NEEDS)[number];

/** Whether an engine can run now, and what it lacks when it cannot. */
export interface EngineState {
  available: boolean;
  missing: EngineNeed[];
}

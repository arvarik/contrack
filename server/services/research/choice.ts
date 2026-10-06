// =============================================================================
// Research — the choice: the technique and web search a start runs with
// =============================================================================
// A start may name a technique and a web search. What it names is used, or
// the start is refused. A start that names nothing runs the account's web
// search engine (`webSearchEngine`, which may be the instance's) while that
// can run, or else the first engine that can.
//
// A start is checked before anything is spent. Research that is off refuses
// every start. An unknown name, or a web search named with a technique that
// uses none, answers 400. A choice that is not set up answers 503 with the
// first need it lacks (`Technique.needs`).
// =============================================================================

import { z } from "zod";
import { isResearchOff, resolveCapability } from "../../ai/capabilities.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import {
  ENGINE_STRATEGY,
  WEB_SEARCH_ENGINES,
  engineFor,
  type EngineChoice,
  type EngineNeed,
  type EngineState,
  type WebSearchEngine,
} from "../../../shared/webSearchEngine.ts";
import { getWebSearchPolicy } from "../../ai/webSearchPolicy.ts";
import { isTechnique, searchesWeb, techniqueNamed } from "./techniques.ts";
import {
  DEFAULT_WEB_SEARCH,
  isWebSearch,
  webSearchNamed,
  webSearchUnset,
} from "./webSearch.ts";
import type { ResearchChoice } from "./types.ts";

/** The two choices a request may make, as a route body holds them. */
export const researchChoiceSchema = z.object({
  /** A registered technique, such as "search-and-read". */
  technique: z
    .string()
    .trim()
    .max(40)
    .refine(isTechnique, "Unknown research technique")
    .optional(),
  /** A registered web search, such as "searxng". */
  webSearch: z
    .string()
    .trim()
    .max(40)
    .refine(isWebSearch, "Unknown web search")
    .optional(),
});

/** The choice each web search engine stands for. */
const ENGINE_CHOICE: Record<WebSearchEngine, ResearchChoice> = {
  provider: { technique: "provider-search" },
  searxng: { technique: "search-and-read", webSearch: "searxng" },
  combined: { technique: "combined", webSearch: "searxng" },
};

/** The choice each `strategy` of `POST /api/ai-search` names: the words the app sends. */
export const STRATEGY_CHOICE: Record<
  (typeof ENGINE_STRATEGY)[WebSearchEngine],
  ResearchChoice
> = {
  "two-pass": ENGINE_CHOICE.provider,
  searxng: ENGINE_CHOICE.searxng,
  combined: ENGINE_CHOICE.combined,
};

/**
 * A choice as a job's `strategy` names it: "two-pass" for the research
 * model's search, the web search's id for search-and-read, and the technique
 * for any other.
 */
export function strategyOf(choice: ResearchChoice): string {
  if (choice.technique === "provider-search") return "two-pass";
  if (choice.technique === "search-and-read")
    return choice.webSearch ?? DEFAULT_WEB_SEARCH;
  return choice.technique;
}

/** Research is off for the instance: every start refuses. */
function refuseWhileOff(): void {
  if (isResearchOff())
    throw new AppError(
      "Web search is off, so contact research cannot run. An admin can turn it on in Settings → Administration → AI → Web search.",
      503,
      { code: "RESEARCH_OFF" },
    );
}

/**
 * The choice with the web search its technique uses, checked against what
 * is set up. Throws 400 for an unknown name, or for a web search named with
 * a technique that searches with none, and 503 for the first need that is
 * missing.
 */
function checked(technique: string, webSearch?: string): ResearchChoice {
  const chosen = techniqueNamed(technique);
  if (webSearch && !searchesWeb(chosen))
    throw new AppError(
      `The technique "${chosen.name}" searches with no web search. Leave out webSearch, or name a technique that uses one, such as "search-and-read".`,
      400,
    );
  const web = searchesWeb(chosen)
    ? webSearchNamed(webSearch ?? DEFAULT_WEB_SEARCH)
    : null;
  for (const need of chosen.needs()) {
    if (need.what === "web-search") {
      if (web && !web.configured()) throw webSearchUnset(web);
    } else if (!resolveCapability(need.what)) {
      throw new AppError(need.message, 503);
    }
  }
  return { technique: chosen.name, ...(web && { webSearch: web.id }) };
}

/**
 * True on a stack with SearXNG and no web search model: SearXNG is then the
 * one engine the stack is set up for, and when nothing can run, its missing
 * need is the one worth naming.
 */
function searxngStack(): boolean {
  return (
    !resolveCapability("research") &&
    webSearchNamed(DEFAULT_WEB_SEARCH).configured()
  );
}

/**
 * The engines a start tries, in order: the account's own first, then the
 * ones it gives way to. Both needs everything the other two need, so it is
 * never a fallback.
 */
function enginesToTry(engine: WebSearchEngine): WebSearchEngine[] {
  const fallbacks: WebSearchEngine[] = searxngStack()
    ? ["searxng", "provider"]
    : ["provider", "searxng"];
  return [engine, ...fallbacks.filter((other) => other !== engine)];
}

/**
 * The technique and web search a start runs with: the ones it names, or
 * else the account's engine, or else the first engine that can run.
 *
 * What a start names is used, or the start is refused. A web search named
 * alone goes with the engine's technique when that one searches the web,
 * and with search-and-read when it does not.
 *
 * An engine outlives the setup it needs: an admin can clear the SearXNG
 * address, or the web search model, later. A start that names nothing then
 * searches with an engine that can run, and does not fail. Web search that
 * is off still refuses, and so does a start no engine can run, with the
 * engine's first missing need.
 *
 * @param asked - What the start names.
 * @param choice - The account's engine choice: "default" for the instance's.
 * @throws AppError 503 `RESEARCH_OFF`, 400 for an unknown name or a web
 *   search the technique cannot use, or 503 for a choice that is not set up.
 */
export function chooseResearch(
  asked: Partial<ResearchChoice>,
  choice: EngineChoice,
): ResearchChoice {
  refuseWhileOff();
  const engine = engineFor(choice, getWebSearchPolicy().engine);
  if (asked.technique || asked.webSearch) {
    const preferred = ENGINE_CHOICE[engine].technique;
    const technique =
      asked.technique ??
      (searchesWeb(techniqueNamed(preferred)) ? preferred : "search-and-read");
    return checked(technique, asked.webSearch);
  }
  const refusals = new Map<WebSearchEngine, unknown>();
  for (const candidate of enginesToTry(engine)) {
    const { technique, webSearch } = ENGINE_CHOICE[candidate];
    try {
      const chosen = checked(technique, webSearch);
      if (candidate !== engine)
        log.info(
          "Research",
          `The ${engine} engine cannot run now (${getErrorMessage(refusals.get(engine))}); searching with ${candidate}`,
        );
      return chosen;
    } catch (err) {
      refusals.set(candidate, err);
    }
  }
  throw refusals.get(searxngStack() ? "searxng" : engine);
}

/**
 * Whether each engine can run now, and what it lacks: the settings pages
 * show an engine that cannot run as disabled, with the reason.
 *
 * The needs are the techniques' own (`Technique.needs`), the ones a start is
 * checked against, so the page and the server never disagree. Web search
 * that is off is the first need of every engine.
 */
export function engineStates(): Record<WebSearchEngine, EngineState> {
  const off = isResearchOff();
  const states = {} as Record<WebSearchEngine, EngineState>;
  for (const engine of WEB_SEARCH_ENGINES) {
    const { technique, webSearch } = ENGINE_CHOICE[engine];
    const missing: EngineNeed[] = off ? ["off"] : [];
    const chosen = techniqueNamed(technique);
    for (const need of chosen.needs()) {
      if (need.what === "web-search") {
        if (!webSearchNamed(webSearch ?? DEFAULT_WEB_SEARCH).configured())
          missing.push("web-search");
      } else if (!resolveCapability(need.what)) {
        missing.push(need.what);
      }
    }
    states[engine] = { available: missing.length === 0, missing };
  }
  return states;
}

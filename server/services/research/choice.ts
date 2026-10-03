// =============================================================================
// Research — the choice: the technique and web search a start runs with
// =============================================================================
// A start may name a technique and a web search. What it leaves out is the
// default: the account's Search with choice (`researchSource`) while it can
// run, or else the research model's own search, or the web search alone when
// no provider serves research.
//
// A start is checked before anything is spent. Research that is off refuses
// every start. An unknown name answers 400, and a choice that is not set up
// answers 503 with the first need it lacks (`Technique.needs`).
// =============================================================================

import { z } from "zod";
import { isResearchOff, resolveCapability } from "../../ai/capabilities.ts";
import { AppError } from "../../utils/AppError.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import type {
  ResearchSource,
  SOURCE_STRATEGY,
} from "../../../shared/researchSource.ts";
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

/** The choice each Search with source stands for. */
const SOURCE_CHOICE: Record<ResearchSource, ResearchChoice> = {
  provider: { technique: "provider-search" },
  searxng: { technique: "search-and-read", webSearch: "searxng" },
  combined: { technique: "combined", webSearch: "searxng" },
};

/** The choice each `strategy` of `POST /api/ai-search` names: the words the app sends. */
export const STRATEGY_CHOICE: Record<
  (typeof SOURCE_STRATEGY)[ResearchSource],
  ResearchChoice
> = {
  "two-pass": SOURCE_CHOICE.provider,
  searxng: SOURCE_CHOICE.searxng,
  combined: SOURCE_CHOICE.combined,
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
      "Contact research is off. An admin can turn it on in Settings → Administration → AI providers.",
      503,
      { code: "RESEARCH_OFF" },
    );
}

/**
 * The choice with the web search its technique uses, checked against what
 * is set up. Throws 400 for an unknown name, and 503 for the first need that
 * is missing.
 */
function checked(technique: string, webSearch?: string): ResearchChoice {
  const chosen = techniqueNamed(technique);
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
 * The default when a start names no technique: the research model's own
 * search, or the web search alone when no provider serves research and the
 * web search is set up.
 */
function defaultChoice(webSearch?: string): ResearchChoice {
  if (
    !resolveCapability("research") &&
    webSearchNamed(webSearch ?? DEFAULT_WEB_SEARCH).configured()
  )
    return { technique: "search-and-read", webSearch };
  return { technique: "provider-search" };
}

/**
 * The technique and web search a start runs with: the ones it names, or
 * else the account's Search with choice, or else the default.
 *
 * A Search with choice of SearXNG or both outlives the setup it needs: an
 * admin can clear the SearXNG address, or the research model, later. The
 * start then searches the default way, as it did before the choice, and does
 * not fail. Research that is off still refuses.
 *
 * @param asked - What the start names. A web search named alone goes with
 *   the technique the start would run anyway.
 * @param source - The account's Search with choice.
 * @throws AppError 503 `RESEARCH_OFF`, 400 for an unknown name, or 503 for
 *   a choice that is not set up.
 */
export function chooseResearch(
  asked: Partial<ResearchChoice>,
  source: ResearchSource,
): ResearchChoice {
  refuseWhileOff();
  if (asked.technique) return checked(asked.technique, asked.webSearch);
  if (source !== "provider") {
    const preferred = SOURCE_CHOICE[source];
    try {
      return checked(
        preferred.technique,
        asked.webSearch ?? preferred.webSearch,
      );
    } catch (err) {
      log.info(
        "Research",
        `Search with ${source} cannot run now (${getErrorMessage(err)}); searching the default way`,
      );
    }
  }
  const fallback = defaultChoice(asked.webSearch);
  return checked(fallback.technique, fallback.webSearch);
}

import { isResearchOff, resolveCapability } from "../../../ai/capabilities.ts";
import { AppError } from "../../../utils/AppError.ts";
// =============================================================================
// AI Search — Strategy Registry
// =============================================================================
// Factory registry for AI Search strategies. New strategies plug in here
// without modifying any other code in the system.
//
// Strategy auto-selection: 'two-pass' for every provider. Gemini cannot
// search and fill a schema in one request, and on OpenAI and Anthropic the
// split keeps a source beside every fact, which the dossier's Research card
// shows. 'single-pass' (search and schema in one request, OpenAI and
// Anthropic only) stays available by name. With a SearXNG address set, a
// start may name 'searxng' to search with SearXNG alone, or 'combined' to
// search with both and keep the facts of both. A start that names none uses
// the account's Search with choice (`preferredEnrichmentStrategy`).
// =============================================================================

import type { AISearchStrategy } from "../types.ts";
import { TwoPassStrategy } from "./twoPass.ts";
import { SinglePassStrategy } from "./singlePass.ts";
import { SearxngStrategy, getSearxngUrl } from "./searxng.ts";
import { CombinedStrategy } from "./combined.ts";
import { log } from "../../../utils/logger.ts";
import { getErrorMessage } from "../../../utils/helpers.ts";
import {
  SOURCE_STRATEGY,
  type ResearchSource,
} from "../../../../shared/researchSource.ts";

const STRATEGIES: Record<string, () => AISearchStrategy> = {
  "two-pass": () => new TwoPassStrategy(),
  "single-pass": () => new SinglePassStrategy(),
  searxng: () => new SearxngStrategy(),
  combined: () => new CombinedStrategy(),
};

/**
 * Get a strategy by name. When no name is provided, defaults to 'two-pass'
 * (Gemini behavior). Callers can use getDefaultStrategyForProvider() to
 * resolve the optimal strategy for the active provider.
 */
export function getStrategy(name: string = "two-pass"): AISearchStrategy {
  const factory = STRATEGIES[name];
  if (!factory)
    throw new AppError(
      `Unknown AI Search strategy: "${name}". Available: ${Object.keys(STRATEGIES).join(", ")}`,
      400,
    );
  return factory();
}

/**
 * Resolve the default strategy name for a given provider: two-pass, or
 * SearXNG when no provider serves research and a SearXNG instance is set.
 * Research set to "Off — never research online" rules SearXNG out too.
 *
 * OpenAI and Anthropic ran single-pass until 2026-09-26. Two-pass on them was
 * measured the same day, on one contact: GPT-6 Sol with GPT-6 Luna filled 26
 * fields, and Claude Sonnet 5 with Haiku 4.5 filled 16 and 17 in two runs.
 */
export function getDefaultStrategyForProvider(
  providerName: string | null,
): string {
  // No grounding-capable provider serves the research capability — fall back
  // to a self-hosted SearXNG instance when one is configured.
  if (!providerName && getSearxngUrl() && !isResearchOff()) return "searxng";
  return "two-pass";
}

/** Validate configuration locally before accepting an enrichment action. */
export function validateEnrichmentStrategy(requested?: string): string {
  if (isResearchOff())
    throw new AppError(
      "Contact research is off. An admin can turn it on in Settings → Administration → AI providers.",
      503,
      { code: "RESEARCH_OFF" },
    );
  const research = resolveCapability("research");
  const name =
    requested ?? getDefaultStrategyForProvider(research?.providerId ?? null);
  getStrategy(name);
  if (name === "searxng") {
    if (!getSearxngUrl() || !resolveCapability("deep"))
      throw new AppError(
        "Configure SearXNG and an AI extraction model in settings.",
        503,
      );
  } else if (name === "combined") {
    // Both searches, so both have to be there: SearXNG, the research model,
    // the deep model that reads SearXNG's pages and the quick one that
    // extracts.
    if (!getSearxngUrl())
      throw new AppError(
        "Searching with both needs a SearXNG address. An admin sets it in Settings → Administration → General.",
        503,
        { code: "SEARXNG_NOT_CONFIGURED" },
      );
    if (!research)
      throw new AppError(
        "AI provider is not configured for contact research. Check AI settings.",
        503,
      );
    if (!resolveCapability("deep") || !resolveCapability("quick"))
      throw new AppError(
        "Configure a quick and a deep AI model to search with both.",
        503,
      );
  } else {
    if (!research)
      throw new AppError(
        "AI provider is not configured for contact research. Check AI settings.",
        503,
      );
    if (name === "single-pass" && research.providerId === "gemini")
      throw new AppError(
        "Gemini research requires the two-pass strategy.",
        400,
      );
    if (name === "two-pass" && !resolveCapability("quick"))
      throw new AppError(
        "Configure a quick AI model for research extraction.",
        503,
      );
  }
  return name;
}

/**
 * The strategy for a start that names none: the account's Search with
 * choice, when it can run now, or the provider's default.
 *
 * A choice of SearXNG or both outlives the setup it needs: an admin can
 * clear the SearXNG address, or the research model, later. The start then
 * searches the default way, as it did before the choice, and does not fail.
 * Research that is off still refuses.
 */
export function preferredEnrichmentStrategy(source: ResearchSource): string {
  if (source !== "provider") {
    try {
      return validateEnrichmentStrategy(SOURCE_STRATEGY[source]);
    } catch (err) {
      if (err instanceof AppError && err.code === "RESEARCH_OFF") throw err;
      log.info(
        "AISearch",
        `Search with ${source} cannot run now (${getErrorMessage(err)}); searching the default way`,
      );
    }
  }
  return validateEnrichmentStrategy();
}

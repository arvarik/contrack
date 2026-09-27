import { resolveCapability } from "../../../ai/capabilities.ts";
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
// Anthropic only) stays available by name.
// =============================================================================

import type { AISearchStrategy } from "../types.ts";
import { TwoPassStrategy } from "./twoPass.ts";
import { SinglePassStrategy } from "./singlePass.ts";
import { SearxngStrategy, getSearxngUrl } from "./searxng.ts";

const STRATEGIES: Record<string, () => AISearchStrategy> = {
  "two-pass": () => new TwoPassStrategy(),
  "single-pass": () => new SinglePassStrategy(),
  searxng: () => new SearxngStrategy(),
  // Future strategies:
  // 'consensus':   () => new ConsensusStrategy(),
  // 'judge':       () => new JudgeStrategy(),
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
  if (!providerName && getSearxngUrl()) return "searxng";
  return "two-pass";
}

/** Validate configuration locally before accepting an enrichment action. */
export function validateEnrichmentStrategy(requested?: string): string {
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

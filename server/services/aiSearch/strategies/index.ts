// =============================================================================
// AI Search — Strategy Registry
// =============================================================================
// Factory registry for AI Search strategies. New strategies plug in here
// without modifying any other code in the system.
//
// Strategy auto-selection:
// - Gemini → 'two-pass' (grounding and schema can't coexist)
// - OpenAI/Anthropic → 'single-pass' (grounding + schema in one request)
//
// Can be overridden via explicit strategy name parameter.
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
    throw new Error(
      `Unknown AI Search strategy: "${name}". Available: ${Object.keys(STRATEGIES).join(", ")}`,
    );
  return factory();
}

/**
 * Resolve the default strategy name for a given provider.
 * - Gemini uses two-pass (grounding + schema incompatible)
 * - OpenAI/Anthropic use single-pass (both supported together)
 */
export function getDefaultStrategyForProvider(
  providerName: string | null,
): string {
  // No grounding-capable provider serves the research capability — fall back
  // to a self-hosted SearXNG instance when one is configured.
  if (!providerName) {
    if (getSearxngUrl()) return "searxng";
    return "two-pass";
  }
  switch (providerName.toLowerCase()) {
    case "openai":
    case "anthropic":
      return "single-pass";
    default:
      return "two-pass";
  }
}

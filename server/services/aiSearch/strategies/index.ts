// =============================================================================
// AI Search — Strategy Registry
// =============================================================================
// Factory registry for AI Search strategies. New strategies plug in here
// without modifying any other code in the system.
//
// Future strategies:
// - 'single-pass': When Gemini 3.x GA supports grounding + schema together
// - 'consensus':   Same prompt against 2-3 models, take intersection
// - 'judge':       Researcher model + validator model
// =============================================================================

import type { AISearchStrategy } from "../types.ts";
import { TwoPassStrategy } from "./twoPass.ts";

const STRATEGIES: Record<string, () => AISearchStrategy> = {
  'two-pass': () => new TwoPassStrategy(),
  // Future strategies plug in here:
  // 'single-pass': () => new SinglePassStrategy(),
  // 'consensus':   () => new ConsensusStrategy(),
  // 'judge':       () => new JudgeStrategy(),
};

export function getStrategy(name: string = 'two-pass'): AISearchStrategy {
  const factory = STRATEGIES[name];
  if (!factory) throw new Error(`Unknown AI Search strategy: "${name}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
  return factory();
}

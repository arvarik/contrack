// =============================================================================
// AI Layer — Public Barrel Export
// =============================================================================
// Usage:
//   import { ai } from "../ai/index.ts";
//   if (ai.isConfigured) { ... }
//
// Each AI task picks its own provider through capability routing. Import
// `generateFor` and `providerIdFor` from gateway.ts, and the capability
// functions from capabilities.ts.
// =============================================================================

import { isAnyProviderConfigured } from "./gateway.ts";

export const ai = {
  /** True when at least one provider has usable credentials. */
  get isConfigured(): boolean {
    return isAnyProviderConfigured();
  },
};

export { synthesizeSearchResults, parseSearchQuery } from "./aiService.ts";

// =============================================================================
// AI Service — Provider-Agnostic Business Logic Facade
// =============================================================================
// The implementation lives in server/ai/services/, split by domain:
//
//   contactParsing.ts    — parseContactRecord
//   relationshipIntel.ts — generateCatchMeUpBriefing, summarizeEmlEmail,
//                          generateDailyInsight
//   mentions.ts          — extractMentions
//   searchIntel.ts       — parseSearchQuery, rerankCandidates,
//                          synthesizeSearchResults
//
// This file is the stable import path: every consumer imports from here, so
// the split moved code without touching a single call site. Add new
// operations in the domain module they belong to and re-export them here.
// =============================================================================

import "../utils/loadEnv.ts";
import type { CompressedContact } from "./types.ts";

// Re-export domain types for consumers
export type { CompressedContact };

export { parseContactRecord } from "./services/contactParsing.ts";

export {
  generateCatchMeUpBriefing,
  summarizeEmlEmail,
  generateDailyInsight,
  type DailyInsight,
} from "./services/relationshipIntel.ts";

export { extractMentions } from "./services/mentions.ts";

export {
  rerankCandidates,
  synthesizeSearchResults,
  parseSearchQuery,
} from "./services/searchIntel.ts";

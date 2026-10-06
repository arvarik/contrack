// The AI operations, one import path for every consumer. The code lives in
// server/ai/services/ by domain:
//
//   contactParsing.ts    parseContactRecord
//   relationshipIntel.ts generateCatchMeUpBriefing, summarizeEmlEmail,
//                        generateDailyInsight
//   mentions.ts          extractMentions
//   searchIntel.ts       parseSearchQuery, rerankCandidates,
//                        synthesizeSearchResults
//
// Add an operation to its domain module and re-export it here.

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

// =============================================================================
// AI Service — Provider-Agnostic Business Logic Facade
// =============================================================================
// The implementation lives in server/ai/services/, split by domain:
//
//   contactParsing.ts    — parseContactRecord, bulkParseContacts
//   relationshipIntel.ts — generateCatchMeUpBriefing, summarizeEmlEmail,
//                          generateDailyInsight
//   mentions.ts          — extractMentions
//   searchIntel.ts       — parseSearchQuery, expandQueryForEmbedding,
//                          rerankCandidates, synthesizeSearchResults,
//                          generateSearchExpansion
//
// This file is the stable import path: every consumer imports from here, so
// the split moved code without touching a single call site. Add new
// operations in the domain module they belong to and re-export them here.
// =============================================================================

import "dotenv/config";
import type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
  ParsedSearchQuery,
  QueryPlan,
} from "./types.ts";

// Re-export domain types for consumers
export type {
  ParsedContact,
  MentionEntity,
  CompressedContact,
  SemanticMatchResult,
  ParsedSearchQuery,
  QueryPlan,
};

export {
  parseContactRecord,
  bulkParseContacts,
  _internal,
} from "./services/contactParsing.ts";

export {
  generateCatchMeUpBriefing,
  summarizeEmlEmail,
  generateDailyInsight,
  type DailyInsight,
} from "./services/relationshipIntel.ts";

export { extractMentions } from "./services/mentions.ts";

export {
  rerankCandidates,
  generateSearchExpansion,
  synthesizeSearchResults,
  parseSearchQuery,
  expandQueryForEmbedding,
} from "./services/searchIntel.ts";

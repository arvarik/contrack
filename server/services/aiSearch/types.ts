// =============================================================================
// AI Search — Type Definitions
// =============================================================================
// Shared types for the AI Search subsystem: the job lifecycle, batch
// tracking, and the result a research run hands to the merge. The run itself
// is the research layer's (`server/services/research/`).
// =============================================================================

import type {
  ResearchFinding,
  ResearchUsage,
} from "../../../shared/researchRecord.ts";
import type { ResearchDepth } from "../../../shared/researchDepth.ts";

// =============================================================================
// Job Lifecycle
// =============================================================================

export type {
  AISearchBatch,
  AISearchJob,
  AISearchJobStatus,
  AISearchErrorType,
} from "../../../shared/aiSearchContract.ts";

// =============================================================================
// Result
// =============================================================================

/** What one research run found, as the merge and the research record read it */
export interface AISearchResult {
  /** Partial update payload keyed by contact field/child table */
  data: Record<string, unknown>;
  /** The models that ran, the first search first */
  models: string[];
  /** Sum of token counts across all calls */
  tokenCount?: number;
  /** Wall-clock total across all calls */
  latencyMs: number;
  /** The pages the research cited, with real addresses — for provenance */
  citations?: Array<{ title: string; uri: string }>;
  /** The facts the search reported, one per line, kept for the dossier */
  findings?: ResearchFinding[];
  /** The web searches that ran */
  searchQueries?: string[];
  /**
   * `"no-public-info"` when the research searched and no page was about this
   * person. The data is empty then, and the run is recorded, not failed.
   */
  outcome?: "found" | "no-public-info";
  /** The depth the research ran at. */
  depth?: ResearchDepth;
  /** What the research spent, over every call it made. */
  usage?: ResearchUsage;
}

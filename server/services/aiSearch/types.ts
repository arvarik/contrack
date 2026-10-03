// =============================================================================
// AI Search — Type Definitions
// =============================================================================
// Shared types for the AI Search subsystem. These define the job lifecycle,
// batch tracking, strategy interface, and result shapes.
// =============================================================================

import type { HydratedContact } from "../../repositories/types.ts";
import type {
  ResearchFinding,
  ResearchRecord,
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
// Strategy Interface
// =============================================================================

/** Result from a strategy execution for one contact */
export interface AISearchResult {
  /** Partial update payload keyed by contact field/child table */
  data: Record<string, unknown>;
  /** All model IDs used (two-pass = [groundingModel, extractionModel]) */
  models: string[];
  /** Sum of token counts across all passes */
  tokenCount?: number;
  /** Wall-clock total across all passes */
  latencyMs: number;
  /** The pages the research cited, with real addresses — for provenance */
  citations?: Array<{ title: string; uri: string }>;
  /** Raw grounded text from Pass 1 */
  groundedText?: string;
  /** The facts Pass 1 reported, one per line, kept for the dossier */
  findings?: ResearchFinding[];
  /** The web searches Pass 1 ran, when the provider reports them */
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

/** How one research run should go. */
export interface ResearchOptions {
  /** How thoroughly to research. Default "standard". */
  depth?: ResearchDepth;
  /**
   * The contact's research so far, which the prompt was built from. A deep
   * run builds its second, complete-profile ask from it too.
   */
  history?: ResearchRecord | null;
  /**
   * How long the whole run may take, in ms, when the caller stops it then.
   * Searching with both stops the research model's search in time to read
   * SearXNG's facts.
   */
  timeoutMs?: number;
}

/**
 * Abstract strategy interface for AI Search.
 * Each strategy encapsulates a complete contact research flow.
 */
export interface AISearchStrategy {
  /** Human-readable strategy name for logging */
  readonly name: string;

  /**
   * Execute AI-powered research for a single contact.
   *
   * @param contact - Fully hydrated contact with all child records
   * @param prompt - Pre-built research prompt from promptTemplate
   * @param options - The depth and the deadline. Single-pass and SearXNG
   *   research have one depth, and ignore them.
   * @returns Structured result with extracted data, models used, and metrics
   * @throws Error if both passes fail (rate limit, validation, network, etc.)
   */
  execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
    options?: ResearchOptions,
  ): Promise<AISearchResult>;
}

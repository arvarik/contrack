// =============================================================================
// AI Search — Type Definitions
// =============================================================================
// Shared types for the AI Search subsystem. These define the job lifecycle,
// batch tracking, strategy interface, and result shapes.
// =============================================================================

import type { HydratedContact } from "../../repositories/types.ts";

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
  /** Grounding citations from Pass 1 groundingMetadata — for provenance */
  citations?: Array<{ title: string; uri: string }>;
  /** Raw grounded text from Pass 1 — saved as aiBackground (dossier) */
  groundedText?: string;
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
   * @returns Structured result with extracted data, models used, and metrics
   * @throws Error if both passes fail (rate limit, validation, network, etc.)
   */
  execute(
    contact: HydratedContact,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<AISearchResult>;
}

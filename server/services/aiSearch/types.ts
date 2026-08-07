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

/** Status lifecycle: queued → searching → merging → success | error */
export type AISearchJobStatus =
  "queued" | "searching" | "merging" | "success" | "error";

/** Error classification for contextual UI messages and future retry logic. */
export type AISearchErrorType =
  | "rate_limit" // 429 / quota — retryable
  | "validation" // Zod parse failure — not retryable
  | "network" // Timeout / connection — retryable once
  | "auth" // API key invalid — fatal
  | "ambiguous" // LLM couldn't identify unique person — not retryable
  | "unknown"; // Catch-all

export interface AISearchJob {
  id: string; // UUID
  contactId: string; // FK → contacts.id
  contactName: string; // Denormalized for UI
  status: AISearchJobStatus;
  error?: string; // Human-readable error message
  errorType?: AISearchErrorType; // Classified error type
  fieldsUpdated: number; // Count of fields/records merged
  startedAt?: string; // ISO timestamp
  completedAt?: string; // ISO timestamp
  latencyMs?: number; // Wall-clock time for this job
}

export interface AISearchBatch {
  id: string; // Batch UUID
  strategy: string; // e.g., 'two-pass'
  jobs: AISearchJob[]; // Ordered list
  createdAt: string; // ISO timestamp
  status: "processing" | "complete" | "cancelled";
  totalTokens: number; // Accumulated token usage across all jobs
}

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
  execute(contact: HydratedContact, prompt: string): Promise<AISearchResult>;
}

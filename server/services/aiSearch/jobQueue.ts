// =============================================================================
// AI Search — Job Queue
// =============================================================================
// In-memory batch queue managing the AI Search lifecycle. Uses EventEmitter
// to push real-time status updates to SSE clients.
//
// Jobs are ephemeral (lost on server restart). This is acceptable because
// AI Search is a discrete user action, not persistent state.
//
// Concurrency: V1 is strictly sequential (1 contact at a time) to avoid
// rate limits. Can be upgraded to p-limit(2) in the future.
//
// Rate protection: 5-minute cooldown between batch starts + single-batch
// concurrency lock. No express-rate-limit needed for a single-user local app.
// =============================================================================

import { EventEmitter } from "events";
import crypto from "crypto";
import type {
  AISearchJob,
  AISearchBatch,
  AISearchJobStatus,
  AISearchErrorType,
  AISearchStrategy,
} from "./types.ts";
import type { AIProvider } from "../../ai/provider.ts";
import { buildSearchPrompt } from "./promptTemplate.ts";
import { mergeSearchResult } from "./mergeEngine.ts";
import { contactService } from "../contactService.ts";
import { getStrategy } from "./strategies/index.ts";
import { log } from "../../utils/logger.ts";

// =============================================================================
// Error Classification
// =============================================================================

function classifyError(error: any): AISearchErrorType {
  const msg = (error?.message ?? '').toLowerCase();

  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource exhausted')) {
    return 'rate_limit';
  }
  if (msg.includes('zod') || msg.includes('validation') || msg.includes('json.parse') || msg.includes('schema')) {
    return 'validation';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) {
    return 'network';
  }
  if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('403') || msg.includes('permission')) {
    return 'auth';
  }
  if (msg.includes('ambiguous') || msg.includes('multiple people') || msg.includes('cannot identify') || msg.includes('could not identify') || msg.includes('no public information')) {
    return 'ambiguous';
  }
  return 'unknown';
}

// =============================================================================
// Job Queue
// =============================================================================

/** 5-minute cooldown between batch starts to prevent token abuse */
const COOLDOWN_MS = 5 * 60 * 1000;

/** Completed batches older than 30 minutes are garbage collected */
const GC_TTL_MS = 30 * 60 * 1000;

class AISearchJobQueue extends EventEmitter {
  private batches = new Map<string, AISearchBatch>();
  private processing = false;
  private lastBatchCompletedAt: Date | null = null;

  /**
   * Check whether a new batch can be started.
   * Enforces both the concurrency lock and the inter-batch cooldown.
   */
  canStartBatch(): { allowed: boolean; reason?: string } {
    if (this.processing) {
      return { allowed: false, reason: 'A batch is already in progress.' };
    }
    if (this.lastBatchCompletedAt) {
      const elapsed = Date.now() - this.lastBatchCompletedAt.getTime();
      if (elapsed < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return { allowed: false, reason: `Please wait ${waitSec}s before starting another batch.` };
      }
    }
    return { allowed: true };
  }

  /**
   * Create a new batch from selected contacts.
   * Runs lazy GC before allocating to keep memory bounded.
   */
  createBatch(
    contacts: Array<{ id: string; name: string }>,
    strategyName: string,
  ): AISearchBatch {
    // Lazy GC: clean up old completed batches
    this.gc();

    const batchId = crypto.randomUUID();
    const jobs: AISearchJob[] = contacts.map(c => ({
      id: crypto.randomUUID(),
      contactId: c.id,
      contactName: c.name,
      status: 'queued' as AISearchJobStatus,
      fieldsUpdated: 0,
    }));

    const batch: AISearchBatch = {
      id: batchId,
      strategy: strategyName,
      jobs,
      createdAt: new Date().toISOString(),
      status: 'processing',
      totalTokens: 0,
    };

    this.batches.set(batchId, batch);
    log.info('AISearchQueue', `Batch ${batchId} created: ${jobs.length} job(s), strategy: ${strategyName}`);
    return batch;
  }

  /**
   * Process all jobs in a batch sequentially.
   * One contact at a time. Individual failures never block the batch.
   */
  async processBatch(batchId: string, adapter: AIProvider): Promise<void> {
    if (this.processing) {
      throw new Error('An AI Search batch is already in progress');
    }
    this.processing = true;

    const batch = this.batches.get(batchId);
    if (!batch) {
      this.processing = false;
      throw new Error(`Batch ${batchId} not found`);
    }

    const strategy = getStrategy(batch.strategy);
    log.info('AISearchQueue', `Processing batch ${batchId} with strategy: ${strategy.name}`);

    try {
      for (const job of batch.jobs) {
        const jobStartMs = Date.now();

        try {
          // 1. Set status → 'searching'
          job.status = 'searching';
          job.startedAt = new Date().toISOString();
          this.emit(batchId, batch);

          // 2. Fetch full HydratedContact
          const contact = contactService.getContactById(job.contactId);
          if (!contact) {
            throw new Error(`Contact ${job.contactId} not found`);
          }

          // 3. Build prompt
          const prompt = buildSearchPrompt(contact);

          // 4. Execute strategy (two-pass internally)
          const result = await strategy.execute(contact, prompt, adapter);

          // 5. Set status → 'merging'
          job.status = 'merging';
          this.emit(batchId, batch);

          // 6. Run merge engine
          const fieldsUpdated = mergeSearchResult(job.contactId, contact, result.data as any);

          // 7. Set status → 'success'
          job.status = 'success';
          job.fieldsUpdated = fieldsUpdated;
          job.completedAt = new Date().toISOString();
          job.latencyMs = Date.now() - jobStartMs;

          // Accumulate token usage
          batch.totalTokens += result.tokenCount ?? 0;

          log.info('AISearchQueue', `Job ${job.id} (${job.contactName}): success — ${fieldsUpdated} field(s) merged in ${job.latencyMs}ms`);
          this.emit(batchId, batch);

        } catch (err: any) {
          // Per-job failure — batch continues
          job.status = 'error';
          job.error = err.message || 'Unknown error';
          job.errorType = classifyError(err);
          job.completedAt = new Date().toISOString();
          job.latencyMs = Date.now() - jobStartMs;

          log.error('AISearchQueue', `Job ${job.id} (${job.contactName}): ${job.errorType} — ${err.message}`);
          this.emit(batchId, batch);
        }
      }
    } finally {
      this.processing = false;
      this.lastBatchCompletedAt = new Date();
      batch.status = 'complete';
      // Final emit signals SSE clients to close
      this.emit(batchId, batch);
      log.info('AISearchQueue', `Batch ${batchId} complete: ${batch.jobs.filter(j => j.status === 'success').length}/${batch.jobs.length} succeeded, ${batch.totalTokens} tokens used`);
    }
  }

  /** Get a batch by ID, or null if not found. */
  getBatch(batchId: string): AISearchBatch | null {
    return this.batches.get(batchId) ?? null;
  }

  /** Get all batches that are currently processing. */
  getActiveBatches(): AISearchBatch[] {
    return Array.from(this.batches.values()).filter(b => b.status === 'processing');
  }

  /** Whether a batch is currently being processed. */
  isProcessing(): boolean {
    return this.processing;
  }

  /** Cleanup completed batches older than GC_TTL_MS. */
  gc(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, batch] of this.batches) {
      if (batch.status !== 'processing') {
        const batchTime = new Date(batch.createdAt).getTime();
        if (now - batchTime > GC_TTL_MS) {
          this.batches.delete(id);
          this.removeAllListeners(id);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      log.debug('AISearchQueue', `GC: cleaned ${cleaned} stale batch(es)`);
    }
  }
}

// Singleton instance
export const jobQueue = new AISearchJobQueue();

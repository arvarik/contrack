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
import { getErrorMessage } from "../../utils/helpers.ts";
import { aiCache } from "../../utils/aiCache.ts";

// =============================================================================
// Error Classification
// =============================================================================

function classifyError(error: any): AISearchErrorType {
  const msg = (error?.message ?? '').toLowerCase();

  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('resource exhausted')) {
    return 'rate_limit';
  }
  if (msg.includes('zod') || msg.includes('validation') || msg.includes('json.parse') || msg.includes('schema') || msg.includes('json parse')) {
    return 'validation';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('500') || msg.includes('internal') || msg.includes('503') || msg.includes('unavailable') || msg.includes('408') || msg.includes('deadline')) {
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

/** Delay between sequential jobs to avoid Gemini grounding API rate limits */
const INTER_JOB_DELAY_MS = 2_500;

/** Max retries for retryable errors (rate_limit, network, validation, unknown) per job */
const MAX_RETRIES = 4;

/** Initial backoff delay for retries (doubles each attempt: 3s → 6s → 12s → 24s) */
const INITIAL_BACKOFF_MS = 3_000;

/** Non-blocking sleep for inter-job delay and exponential backoff */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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
      // Batch mode: defer cache invalidations during the entire batch.
      // Each mergeSearchResult call triggers invalidateSearchCache() —
      // without batch mode, that's N full cache flushes. With batch mode,
      // exactly 1 flush after all jobs complete.
      aiCache.enterBatchMode();

      for (let jobIdx = 0; jobIdx < batch.jobs.length; jobIdx++) {
        const job = batch.jobs[jobIdx];
        const jobStartMs = Date.now();

        // Inter-job delay to prevent Gemini grounding API rate limiting.
        // The first job runs immediately; subsequent jobs wait 1.5s.
        if (jobIdx > 0) {
          await sleep(INTER_JOB_DELAY_MS);
        }

        // Retry loop: retryable errors (rate_limit, network) get up to MAX_RETRIES
        let lastError: any = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              // Exponential backoff: 2s → 4s → 8s
              const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
              log.info('AISearchQueue', `Job ${job.id} (${job.contactName}): retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff`);
              job.status = 'searching'; // Reset status for retry
              this.emit(batchId, batch);
              await sleep(backoffMs);
            }

            // 1. Set status → 'searching'
            job.status = 'searching';
            job.startedAt = job.startedAt ?? new Date().toISOString();
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

            // 6. Run merge engine (pass grounded text for dossier population)
            const fieldsUpdated = mergeSearchResult(job.contactId, contact, result.data as any, result.groundedText);

            // 7. Set status → 'success'
            job.status = 'success';
            job.fieldsUpdated = fieldsUpdated;
            job.completedAt = new Date().toISOString();
            job.latencyMs = Date.now() - jobStartMs;

            // Accumulate token usage
            batch.totalTokens += result.tokenCount ?? 0;

            log.info('AISearchQueue', `Job ${job.id} (${job.contactName}): success — ${fieldsUpdated} field(s) merged in ${job.latencyMs}ms`);
            this.emit(batchId, batch);
            lastError = null;
            break; // Success — exit retry loop

          } catch (err: unknown) {
            lastError = err;
            const errorType = classifyError(err);
            const isRetryable = errorType === 'rate_limit' || errorType === 'network' || errorType === 'validation' || errorType === 'unknown';

            if (!isRetryable || attempt === MAX_RETRIES) {
              // Non-retryable error or exhausted retries — mark as failed
              job.status = 'error';
              job.error = getErrorMessage(err) || 'Unknown error';
              job.errorType = errorType;
              job.completedAt = new Date().toISOString();
              job.latencyMs = Date.now() - jobStartMs;

              log.error('AISearchQueue', `Job ${job.id} (${job.contactName}): ${errorType} — ${getErrorMessage(err)}${attempt > 0 ? ` (after ${attempt} retries)` : ''}`);
              this.emit(batchId, batch);
              break; // Exit retry loop
            }

            // Retryable error — will loop and try again
            log.warn('AISearchQueue', `Job ${job.id} (${job.contactName}): ${errorType} — ${getErrorMessage(err)} (will retry)`);
          }
        }
      }
    } finally {
      aiCache.exitBatchMode();
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

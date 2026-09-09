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
} from "./types.ts";
import type { AIProvider } from "../../ai/provider.ts";
import { buildSearchPrompt, type AISearchOutput } from "./promptTemplate.ts";
import { mergeSearchResult } from "./mergeEngine.ts";
import { getStrategy } from "./strategies/index.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { withTimeout, sleep } from "../../ai/resilience.ts";
import { enrichmentContact, lockEnrichment } from "./contactSnapshot.ts";
import {
  scopeForOwnerId,
  type OwnerId,
  type Scope,
} from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";

// =============================================================================
// Error Classification
// =============================================================================

function classifyError(error: unknown): AISearchErrorType {
  const msg = (
    (error as { message?: string } | null | undefined)?.message ?? ""
  ).toLowerCase();

  if (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted")
  ) {
    return "rate_limit";
  }
  if (
    msg.includes("zod") ||
    msg.includes("validation") ||
    msg.includes("source links") ||
    msg.includes("json.parse") ||
    msg.includes("schema") ||
    msg.includes("json parse")
  ) {
    return "validation";
  }
  if (
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("500") ||
    msg.includes("internal") ||
    msg.includes("503") ||
    msg.includes("unavailable") ||
    msg.includes("408") ||
    msg.includes("deadline")
  ) {
    return "network";
  }
  if (
    msg.includes("api key") ||
    msg.includes("credentials") ||
    msg.includes("unauthorized") ||
    msg.includes("403") ||
    msg.includes("permission")
  ) {
    return "auth";
  }
  if (
    msg.includes("ambiguous") ||
    msg.includes("multiple people") ||
    msg.includes("cannot identify") ||
    msg.includes("could not identify") ||
    msg.includes("no public information")
  ) {
    return "ambiguous";
  }
  return "unknown";
}

// =============================================================================
// Job Queue
// =============================================================================

/** 5-minute cooldown between batch starts to prevent token abuse */
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * A batch and the account that started it.
 *
 * The owner is held beside the batch rather than inside it, so the shape the
 * SSE stream and the status endpoint send stays exactly the contract in
 * `shared/aiSearchContract.ts`.
 */
interface OwnedBatch {
  batch: AISearchBatch;
  ownerId: OwnerId;
}

/** Completed batches older than 30 minutes are garbage collected */
const GC_TTL_MS = 30 * 60 * 1000;

/** Delay between sequential jobs to avoid Gemini grounding API rate limits */
const INTER_JOB_DELAY_MS = 2_500;

class AISearchJobQueue extends EventEmitter {
  private batches = new Map<string, OwnedBatch>();
  private processing = false;
  private controllers = new Map<string, AbortController>();
  private lastBatchCompletedAt = new Map<OwnerId, Date>();

  /**
   * Check whether this account can start a new batch.
   *
   * The run lock stays global: provider rate limits are a property of the API
   * key, which the whole instance shares, so two accounts researching at once
   * would spend one quota twice as fast. The cooldown is per account, because
   * it exists to stop one person burning tokens and had no business making
   * everybody else wait five minutes after a stranger's batch.
   *
   * `yours` says which of the two refused, so the route can send an honest
   * message and the UI can tell "your own cooldown" from "somebody else is
   * researching right now".
   */
  canStartBatch(scope: Scope): {
    allowed: boolean;
    reason?: string;
    yours: boolean;
    retryAfterSeconds?: number;
  } {
    if (this.processing) {
      return {
        allowed: false,
        reason: "A batch is already in progress.",
        yours: this.hasActiveBatch(scope),
      };
    }
    const last = this.lastBatchCompletedAt.get(scope.ownerId);
    if (last) {
      const elapsed = Date.now() - last.getTime();
      if (elapsed < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return {
          allowed: false,
          reason: `Please wait ${waitSec}s before starting another batch.`,
          yours: true,
          retryAfterSeconds: waitSec,
        };
      }
    }
    return { allowed: true, yours: true };
  }

  /**
   * Create a new batch from selected contacts.
   * Runs lazy GC before allocating to keep memory bounded.
   */
  createBatch(
    scope: Scope,
    contacts: Array<{ id: string; name: string }>,
    strategyName: string,
  ): AISearchBatch {
    // Lazy GC: clean up old completed batches
    this.gc();

    const batchId = crypto.randomUUID();
    const jobs: AISearchJob[] = [
      ...new Map(contacts.map((c) => [c.id, c])).values(),
    ].map((c) => ({
      id: crypto.randomUUID(),
      contactId: c.id,
      contactName: c.name,
      status: "queued" as AISearchJobStatus,
      fieldsUpdated: 0,
    }));

    const batch: AISearchBatch = {
      id: batchId,
      strategy: strategyName,
      jobs,
      createdAt: new Date().toISOString(),
      status: "processing",
      totalTokens: 0,
    };

    this.batches.set(batchId, { batch, ownerId: scope.ownerId });
    log.info(
      "AISearchQueue",
      `Batch ${batchId} created: ${jobs.length} job(s), strategy: ${strategyName}`,
    );
    return batch;
  }

  /**
   * Process all jobs in a batch sequentially.
   * One contact at a time. Individual failures never block the batch.
   */
  async processBatch(batchId: string, _adapter?: AIProvider): Promise<void> {
    if (this.processing)
      throw new Error("An AI Search batch is already in progress");
    const owned = this.batches.get(batchId);
    if (!owned || owned.batch.status !== "processing") return;
    // The whole run happens in the starter's context, so every AI invocation
    // row it writes and every cache key it builds names that account. The
    // route returned long ago, so nothing is inherited: rule 7 makes the owner
    // an argument the job carries rather than an ambient value it hopes for.
    return runWithContext(
      {
        requestId: `job-ai-search-${batchId.slice(0, 8)}`,
        principal: null,
        scope: scopeForOwnerId(owned.ownerId),
      },
      () => this.runBatch(owned),
    );
  }

  /** The body of one batch run, inside the starter's context. */
  private async runBatch(owned: OwnedBatch): Promise<void> {
    const { batch } = owned;
    const scope = scopeForOwnerId(owned.ownerId);
    const batchId = batch.id;
    const strategy = getStrategy(batch.strategy);
    const controller = new AbortController();
    this.controllers.set(batchId, controller);
    this.processing = true;
    try {
      for (let index = 0; index < batch.jobs.length; index++) {
        controller.signal.throwIfAborted();
        if (index > 0) await sleep(INTER_JOB_DELAY_MS, controller.signal);
        const job = batch.jobs[index];
        const startMs = Date.now();
        let release: (() => void) | undefined;
        try {
          const contact = enrichmentContact(scope, job.contactId);
          release = lockEnrichment(job.contactId);
          job.status = "searching";
          job.startedAt = new Date().toISOString();
          this.emit(batchId, batch);
          const prompt = buildSearchPrompt(contact);
          const result = await withTimeout(
            (signal) => strategy.execute(contact, prompt, signal),
            90_000,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          job.status = "merging";
          this.emit(batchId, batch);
          job.fieldsUpdated = mergeSearchResult(
            scope,
            job.contactId,
            contact,
            result.data as AISearchOutput,
            result.citations,
          );
          job.status = "success";
          batch.totalTokens += result.tokenCount ?? 0;
        } catch (error) {
          if (controller.signal.aborted) {
            job.status = "cancelled";
          } else {
            job.status = "error";
            job.errorType = classifyError(error);
            job.error = getErrorMessage(error);
            log.warn(
              "AISearchQueue",
              `Job ${job.id} failed. The batch does not repeat completed research stages.`,
            );
          }
        } finally {
          release?.();
          job.completedAt = new Date().toISOString();
          job.latencyMs = Date.now() - startMs;
          this.emit(batchId, batch);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (this.controllers.get(batchId) === controller) {
        this.processing = false;
        this.lastBatchCompletedAt.set(owned.ownerId, new Date());
        this.controllers.delete(batchId);
      }
      batch.status = controller.signal.aborted ? "cancelled" : "complete";
      this.emit(batchId, batch);
    }
  }

  /** Stop active research and prevent queued contacts from starting. */
  cancelBatch(scope: Scope, batchId: string): AISearchBatch | null {
    const batch = this.getBatch(scope, batchId);
    if (!batch || batch.status !== "processing") return batch ?? null;
    batch.status = "cancelled";
    for (const job of batch.jobs) {
      if (["queued", "searching", "merging"].includes(job.status)) {
        job.status = "cancelled";
        job.completedAt = new Date().toISOString();
      }
    }
    this.controllers.get(batchId)?.abort();
    this.emit(batchId, batch);
    return batch;
  }

  /**
   * One of this account's batches, or null.
   *
   * A batch id another account started is null here, which the routes turn
   * into the same 404 an id that never existed gets. Batch ids are random
   * UUIDs, so this is not about guessing them: it is about a leaked or shared
   * id not becoming a live view of somebody else's research.
   */
  getBatch(scope: Scope, batchId: string): AISearchBatch | null {
    const owned = this.batches.get(batchId);
    if (!owned || owned.ownerId !== scope.ownerId) return null;
    return owned.batch;
  }

  /** This account's batches that are currently processing. */
  getActiveBatches(scope: Scope): AISearchBatch[] {
    return Array.from(this.batches.values())
      .filter((b) => b.ownerId === scope.ownerId)
      .filter((b) => b.batch.status === "processing")
      .map((b) => b.batch);
  }

  /** Whether this account has a batch in flight. */
  hasActiveBatch(scope: Scope): boolean {
    return this.getActiveBatches(scope).length > 0;
  }

  /** Whether the instance is running a batch, for anybody. */
  isProcessing(): boolean {
    return this.processing;
  }

  /** Cleanup completed batches older than GC_TTL_MS. */
  gc(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, { batch }] of this.batches) {
      if (batch.status !== "processing") {
        const batchTime = new Date(batch.createdAt).getTime();
        if (now - batchTime > GC_TTL_MS) {
          this.batches.delete(id);
          this.removeAllListeners(id);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      log.debug("AISearchQueue", `GC: cleaned ${cleaned} stale batch(es)`);
    }
  }

  /** Reset queue state for tests. */
  __resetForTests(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.batches.clear();
    this.processing = false;
    this.lastBatchCompletedAt.clear();
  }
}

// Singleton instance
export const jobQueue = new AISearchJobQueue();

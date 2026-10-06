// The research batch queue, in memory, pushing status to SSE clients through an
// EventEmitter. Jobs are lost on restart, which is fine for a discrete user
// action.
//
// One contact at a time, to stay inside rate limits, and one batch at a time on
// the instance, because the limits belong to the API key the instance shares. A
// second start by the same account joins the running batch.
//
// No cooldown between batches: a real 429 from the provider pauses that model
// in the adapter, and the router moves to another.

import { EventEmitter } from "events";
import crypto from "crypto";
import type {
  AISearchJob,
  AISearchBatch,
  AISearchJobStatus,
  AISearchErrorType,
} from "./types.ts";
import type { AIProvider } from "../../ai/provider.ts";
import { mergeSearchResult, researchHistory } from "./mergeEngine.ts";
import {
  isRefusal,
  research,
  strategyOf,
  toAISearchResult,
  type ResearchChoice,
} from "../research/index.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { sleep } from "../../ai/resilience.ts";
import { enrichmentContact, lockEnrichment } from "./contactSnapshot.ts";
import {
  scopeForOwnerId,
  type OwnerId,
  type Scope,
} from "../../tenancy/scope.ts";
import { runWithContext } from "../../tenancy/requestContext.ts";
import {
  DEFAULT_RESEARCH_DEPTH,
  type ResearchDepth,
} from "../../../shared/researchDepth.ts";

// Error Classification

function classifyError(error: unknown): AISearchErrorType {
  // An AI switch said no: AI is off for the instance or the account, or
  // research is off.
  if (isRefusal(error)) return "auth";
  // A no-match with no web search behind it fails the source rule, like an
  // answer without source links.
  if ((error as { code?: string } | null | undefined)?.code === "AI_NO_SEARCH")
    return "validation";
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

// Job Queue

/**
 * A batch and the account that started it. The owner sits beside the batch, so
 * what the SSE stream and the status endpoint send stays exactly the contract
 * in `shared/aiSearchContract.ts`.
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

  /**
   * Whether this account can start research now. The run lock is global:
   * provider rate limits belong to the API key the instance shares. While this
   * account's batch runs, a new start joins it (`appendTo` names the batch).
   * Only another account's batch refuses, and `yours: false` lets the UI say
   * somebody else is researching.
   */
  canStartBatch(scope: Scope): {
    allowed: boolean;
    reason?: string;
    yours: boolean;
    retryAfterSeconds?: number;
    appendTo?: string;
  } {
    if (this.processing) {
      const own = this.getActiveBatches(scope)[0];
      if (own) return { allowed: true, yours: true, appendTo: own.id };
      return {
        allowed: false,
        reason:
          "Another account is enriching contacts right now. Try again in a minute.",
        yours: false,
        retryAfterSeconds: 60,
      };
    }
    return { allowed: true, yours: true };
  }

  /**
   * Add contacts to this account's running batch. The loop reads the job list
   * as it goes, so new jobs run after the queued ones. A contact already queued
   * or running is not added twice; a finished one can run again, as a second
   * round. Each job keeps its own depth and technique, so a SearXNG start can
   * join a batch that searches with the research model.
   *
   * @returns The batch and how many jobs joined it, or null when the batch is
   *   not this account's or has finished.
   */
  appendToBatch(
    scope: Scope,
    batchId: string,
    contacts: Array<{ id: string; name: string }>,
    depth: ResearchDepth = DEFAULT_RESEARCH_DEPTH,
    choice: ResearchChoice,
  ): { batch: AISearchBatch; added: number } | null {
    const batch = this.getBatch(scope, batchId);
    if (!batch || batch.status !== "processing") return null;
    const pending = new Set(
      batch.jobs
        .filter((job) =>
          ["queued", "searching", "merging"].includes(job.status),
        )
        .map((job) => job.contactId),
    );
    let added = 0;
    for (const contact of contacts) {
      if (pending.has(contact.id) || batch.jobs.length >= 100) continue;
      pending.add(contact.id);
      batch.jobs.push({
        id: crypto.randomUUID(),
        contactId: contact.id,
        contactName: contact.name,
        status: "queued",
        fieldsUpdated: 0,
        depth,
        ...jobChoice(choice),
      });
      added += 1;
    }
    log.info("AISearchQueue", `Batch ${batchId}: ${added} job(s) joined`);
    this.emit(batchId, batch);
    return { batch, added };
  }

  /**
   * Create a batch from the selected contacts, after a lazy cleanup that keeps
   * memory bounded.
   */
  createBatch(
    scope: Scope,
    contacts: Array<{ id: string; name: string }>,
    choice: ResearchChoice,
    depth: ResearchDepth = DEFAULT_RESEARCH_DEPTH,
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
      depth,
      ...jobChoice(choice),
    }));

    const batch: AISearchBatch = {
      id: batchId,
      strategy: strategyOf(choice),
      jobs,
      createdAt: new Date().toISOString(),
      status: "processing",
      totalTokens: 0,
    };

    this.batches.set(batchId, { batch, ownerId: scope.ownerId });
    log.info(
      "AISearchQueue",
      `Batch ${batchId} created: ${jobs.length} job(s), technique: ${choice.technique}, depth: ${depth}`,
    );
    return batch;
  }

  /**
   * Run a batch's jobs one contact at a time. One failure never blocks the
   * rest.
   */
  async processBatch(batchId: string, _adapter?: AIProvider): Promise<void> {
    if (this.processing)
      throw new Error("An AI Search batch is already in progress");
    const owned = this.batches.get(batchId);
    if (!owned || owned.batch.status !== "processing") return;
    // The whole run is in the starter's context, so every invocation row and
    // cache key names that account. The route returned long ago, so the job
    // carries its owner as an argument instead of inheriting one.
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
        let refused = false;
        try {
          const contact = enrichmentContact(scope, job.contactId);
          release = lockEnrichment(job.contactId);
          job.status = "searching";
          job.startedAt = new Date().toISOString();
          this.emit(batchId, batch);
          // A contact researched before gets a second round: the prompt
          // names what is known, the sites already read, and what is missing.
          const result = toAISearchResult(
            await research({
              scope,
              contact,
              depth: job.depth ?? DEFAULT_RESEARCH_DEPTH,
              history: researchHistory(contact),
              signal: controller.signal,
              technique: job.technique,
              webSearch: job.webSearch,
            }),
          );
          controller.signal.throwIfAborted();
          job.status = "merging";
          this.emit(batchId, batch);
          job.fieldsUpdated = mergeSearchResult(
            scope,
            job.contactId,
            contact,
            result.data,
            result,
          );
          job.models = result.models.slice(0, 4);
          job.outcome =
            result.outcome === "no-public-info"
              ? "no-public-info"
              : job.fieldsUpdated > 0
                ? "added"
                : "nothing-new";
          job.status = "success";
          batch.totalTokens += result.tokenCount ?? 0;
        } catch (error) {
          if (controller.signal.aborted) {
            job.status = "cancelled";
          } else {
            job.status = "error";
            job.errorType = classifyError(error);
            job.error = getErrorMessage(error);
            refused = isRefusal(error);
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
        // An AI switch said no. It says no for every contact of this account
        // until somebody turns it back on, so the batch stops here, and the
        // run lock is free for other accounts at once.
        if (refused) {
          this.refuseRest(batch, index, job);
          break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (this.controllers.get(batchId) === controller) {
        this.processing = false;
        this.controllers.delete(batchId);
      }
      batch.status = controller.signal.aborted ? "cancelled" : "complete";
      this.emit(batchId, batch);
    }
  }

  /**
   * Fail the jobs after `index` that have not started, with the refusal
   * `refused` failed with. They are not researched.
   */
  private refuseRest(
    batch: AISearchBatch,
    index: number,
    refused: AISearchJob,
  ) {
    const rest = batch.jobs
      .slice(index + 1)
      .filter((job) => job.status === "queued");
    for (const job of rest) {
      job.status = "error";
      job.errorType = refused.errorType;
      job.error = refused.error;
      job.completedAt = new Date().toISOString();
    }
    log.warn(
      "AISearchQueue",
      `Batch ${batch.id} stopped: ${refused.error}. ${rest.length} contact(s) not researched.`,
    );
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
   * One of this account's batches, or null. Another account's batch id gets the
   * same 404 as an id that never existed, so a leaked or shared id never
   * becomes a live view of somebody else's research.
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

  /** Whether the instance is running a batch, for anybody. */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Who is enriching and how much is left, across the instance, for the admin
   * health panel. There is no line: another account's batch is refused, not
   * booked.
   */
  instanceState(): {
    running: OwnerId | null;
    activeBatches: number;
    contactsRemaining: number;
  } {
    let running: OwnerId | null = null;
    let activeBatches = 0;
    let contactsRemaining = 0;
    for (const owned of this.batches.values()) {
      if (owned.batch.status !== "processing") continue;
      activeBatches += 1;
      running ??= owned.ownerId;
      contactsRemaining += owned.batch.jobs.filter(
        (job) =>
          job.status === "queued" ||
          job.status === "searching" ||
          job.status === "merging",
      ).length;
    }
    return { running, activeBatches, contactsRemaining };
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
  }
}

/** A job's fields for its choice: the technique, the web search, and the strategy that names both. */
function jobChoice(
  choice: ResearchChoice,
): Pick<AISearchJob, "technique" | "webSearch" | "strategy"> {
  return {
    technique: choice.technique,
    ...(choice.webSearch && { webSearch: choice.webSearch }),
    strategy: strategyOf(choice),
  };
}

// Singleton instance
export const jobQueue = new AISearchJobQueue();

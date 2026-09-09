// =============================================================================
// AI Layer — Optimistic Quota Tracker
// =============================================================================
// Maintains an in-memory sliding window of recent API usage per model.
// Answers the question: "If I send a request with ~N tokens to model X
// right now, will it fit within the current tier's capacity?"
//
// Key insight: By deducting quota synchronously BEFORE the network request
// fires, parallel requests see each other's reservations and won't all
// pile onto the same model — preventing burst 429 errors.
//
// Why in-memory? Contrack is a single-user, local-first app with one
// Node.js process. An in-memory tracker has zero latency and naturally
// resets on restart (quotas are time-windowed anyway).
// =============================================================================

import type { TierLimits } from "./registry.ts";

const quotaDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface UsageWindow {
  /** Timestamps of requests within the current 60s window */
  requests: { id: number; ts: number }[];

  /** Token usage entries within the current 60s window */
  tokens: { id: number; ts: number; count: number }[];

  /** Current Pacific date for the provider's daily reset. */
  dateKey: string;

  /** Requests made today (resets on dateKey change) */
  rpd: number;
}

// ---------------------------------------------------------------------------
// QuotaTracker
// ---------------------------------------------------------------------------

export class QuotaTracker {
  private usage = new Map<string, UsageWindow>();
  private nextReservationId = 0;

  // ── Grounding RPD Tracking ──────────────────────────────────────────
  // Grounding has its own daily limit, SEPARATE from generation RPD.
  // Flash and Flash-Lite share a single grounding pool on Gemini 2.5.
  private groundingUsage = { dateKey: "", rpd: 0 };
  private readonly groundingRPDLimit: number;

  constructor(groundingRPDLimit: number = 500) {
    this.groundingRPDLimit = groundingRPDLimit;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /** Gemini resets daily quotas at midnight Pacific, including daylight saving time. */
  private getTodayKey(timestamp = Date.now()): string {
    return quotaDate.format(timestamp);
  }

  // ── Token Estimation ────────────────────────────────────────────────

  /**
   * Fast local token estimation using BPE heuristics.
   *
   * ~4 chars ≈ 1 token for English text (well-established BPE approximation).
   * 10% safety buffer to account for tokenizer variance.
   * 1.5x multiplier because TPM = input + output combined, and typical
   * outputs are 30–80% of input length.
   * +50 token overhead for JSON schema instructions.
   *
   * This is intentionally conservative (overestimates). Under-counting
   * risks blowing past limits; over-counting only causes slightly
   * earlier model rotation — a safe tradeoff.
   */
  estimateTokens(
    prompt: string,
    systemPrompt?: string,
    isJson: boolean = false,
  ): number {
    const chars = (prompt?.length || 0) + (systemPrompt?.length || 0);
    const inputTokens = Math.ceil((chars / 4) * 1.1);
    // Multiply by 1.5 to account for output tokens (TPM = input + output)
    const totalEstimate = Math.ceil(inputTokens * 1.5);
    return totalEstimate + (isJson ? 50 : 0);
  }

  // ── Window Management ───────────────────────────────────────────────

  private getOrCreateWindow(modelId: string): UsageWindow {
    const today = this.getTodayKey();

    if (!this.usage.has(modelId)) {
      this.usage.set(modelId, {
        requests: [],
        tokens: [],
        dateKey: today,
        rpd: 0,
      });
    }

    const window = this.usage.get(modelId)!;

    // Reset daily counter on day boundary
    if (window.dateKey !== today) {
      window.dateKey = today;
      window.rpd = 0;
    }

    return window;
  }

  /** Prune entries older than 60 seconds from the sliding window. */
  private cleanup(window: UsageWindow, now: number): void {
    const cutoff = now - 60_000;
    window.requests = window.requests.filter((entry) => entry.ts > cutoff);
    window.tokens = window.tokens.filter((t) => t.ts > cutoff);
  }

  // ── Capacity Check ──────────────────────────────────────────────────

  /**
   * Check whether a model has capacity for an estimated request
   * against the provided tier-specific limits.
   *
   * This is a **read-only** check — does NOT reserve quota.
   * The caller must call `reserve()` separately after deciding to proceed.
   */
  hasCapacity(
    modelId: string,
    estimatedTokens: number,
    limits: TierLimits,
  ): boolean {
    const now = Date.now();
    const window = this.getOrCreateWindow(modelId);
    this.cleanup(window, now);

    const currentRpm = window.requests.length;
    const currentTpm = window.tokens.reduce((sum, t) => sum + t.count, 0);
    const currentRpd = window.rpd;

    return (
      currentRpm + 1 <= limits.rpm &&
      currentTpm + estimatedTokens <= limits.tpm &&
      currentRpd + 1 <= limits.rpd
    );
  }

  /**
   * Check whether there's remaining grounding RPD in the shared pool.
   *
   * The grounding pool is shared between flash + flash-lite on Gemini 2.5.
   * This is SEPARATE from generation RPD — a model can have generation
   * capacity remaining but no grounding capacity.
   */
  hasGroundingCapacity(): boolean {
    const today = this.getTodayKey();
    if (this.groundingUsage.dateKey !== today) {
      this.groundingUsage = { dateKey: today, rpd: 0 };
    }
    return this.groundingUsage.rpd < this.groundingRPDLimit;
  }

  // ── Optimistic Reservation ──────────────────────────────────────────

  /**
   * Reserve quota BEFORE the network request fires.
   *
   * This is the core concurrency safety mechanism: by deducting
   * synchronously from the in-memory ledger, parallel requests see
   * each other's reservations and won't all pile onto the same model.
   */
  reserve(modelId: string, estimatedTokens: number): number {
    const now = Date.now();
    const window = this.getOrCreateWindow(modelId);
    this.cleanup(window, now);

    const id = ++this.nextReservationId;
    window.requests.push({ id, ts: now });
    window.tokens.push({ id, ts: now, count: estimatedTokens });
    // Guard against NaN propagation — a corrupted rpd would silently
    // block all future capacity checks for this model.
    window.rpd = Math.max(0, (window.rpd || 0) + 1);
    return id;
  }

  /** Reserve one unit from the shared grounding RPD pool. */
  reserveGrounding(): string {
    const today = this.getTodayKey();
    if (this.groundingUsage.dateKey !== today) {
      this.groundingUsage = { dateKey: today, rpd: 0 };
    }
    this.groundingUsage.rpd += 1;
    return today;
  }

  // ── Post-Response Adjustments ───────────────────────────────────────

  /**
   * Reconcile estimated tokens with actual tokens from API response.
   * Adjusts the most recent token entry to reflect reality.
   *
   * This keeps the sliding window accurate over time, even though
   * individual estimates may drift. Over-estimation is harmless
   * (causes slightly earlier model rotation); under-estimation is
   * corrected here to prevent future capacity miscalculations.
   */
  reconcile(
    modelId: string,
    _estimated: number,
    actual: number,
    reservationId?: number,
  ): void {
    const window = this.usage.get(modelId);
    if (!window || window.tokens.length === 0) return;

    const lastEntry =
      reservationId === undefined
        ? window.tokens.at(-1)
        : window.tokens.find((entry) => entry.id === reservationId);
    if (!lastEntry || !Number.isFinite(actual)) return;
    // Clamp to zero — negative token counts corrupt TPM calculations.
    // This can happen if the estimate was wildly wrong or reconcile
    // is called multiple times for the same request.
    lastEntry.count = Math.max(0, actual);
  }

  /**
   * Rollback a reservation if the API call fails.
   * Removes the most recent request + token entry and decrements RPD.
   */
  rollback(modelId: string, reservationId?: number): void {
    const window = this.usage.get(modelId);
    if (!window) return;

    const entry =
      reservationId === undefined
        ? window.requests.at(-1)
        : window.requests.find((request) => request.id === reservationId);
    if (!entry) return;
    window.requests = window.requests.filter(
      (request) => request.id !== entry.id,
    );
    window.tokens = window.tokens.filter((token) => token.id !== entry.id);
    if (this.getTodayKey(entry.ts) === window.dateKey)
      window.rpd = Math.max(0, window.rpd - 1);
  }

  /** Rollback one unit from the shared grounding RPD pool. */
  rollbackGrounding(reservedDate = this.getTodayKey()): void {
    this.hasGroundingCapacity();
    if (reservedDate === this.groundingUsage.dateKey)
      this.groundingUsage.rpd = Math.max(0, this.groundingUsage.rpd - 1);
  }

  // ── Diagnostics ─────────────────────────────────────────────────────

  /**
   * Get a snapshot of current usage for all tracked models + grounding.
   * Used for logging and the /api/ai/diagnostics endpoint.
   */
  getSnapshot(): {
    models: Record<string, { rpm: number; tpm: number; rpd: number }>;
    grounding: { rpd: number; limit: number; remaining: number };
  } {
    const now = Date.now();
    const models: Record<string, { rpm: number; tpm: number; rpd: number }> =
      {};

    this.hasGroundingCapacity();
    for (const modelId of this.usage.keys()) {
      const window = this.getOrCreateWindow(modelId);
      this.cleanup(window, now);
      models[modelId] = {
        rpm: window.requests.length,
        tpm: window.tokens.reduce((sum, t) => sum + t.count, 0),
        rpd: window.rpd,
      };
    }

    return {
      models,
      grounding: {
        rpd: this.groundingUsage.rpd,
        limit: this.groundingRPDLimit,
        remaining: Math.max(
          0,
          this.groundingRPDLimit - this.groundingUsage.rpd,
        ),
      },
    };
  }
}

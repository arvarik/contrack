// =============================================================================
// AI Layer — Gemini Usage Meter
// =============================================================================
// An in-memory count of what this process has sent to each Gemini model: the
// requests and tokens of the last 60 seconds, the requests today, and the
// grounded requests today. The admin Health page and /api/ai/diagnostics read
// it.
//
// It used to gate requests too, against a free or paid limit per model. Those
// limits were guesses, because Google sets them per Cloud project, so the
// gate is gone and the meter only counts. A request is counted when it is
// sent, corrected to the real token count when it returns, and taken back
// when the provider refused it.
//
// Why in-memory? One Node.js process serves the instance, and the counts are
// time-windowed, so a restart losing them costs nothing.
// =============================================================================

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

  // ── Grounded requests today ─────────────────────────────────────────
  // Counted apart from generation, because Google bills grounded searches
  // apart from tokens.
  private groundingUsage = { dateKey: "", rpd: 0 };

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
   * It stands in for the real count only until the response arrives and
   * `reconcile` replaces it.
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

  /** Start a new grounding day when the Pacific date has moved on. */
  private rollGroundingDay(): void {
    const today = this.getTodayKey();
    if (this.groundingUsage.dateKey !== today) {
      this.groundingUsage = { dateKey: today, rpd: 0 };
    }
  }

  // ── Counting ────────────────────────────────────────────────────────

  /**
   * Count a request as it is sent, with its estimated tokens. Returns an id
   * that `reconcile` and `rollback` use to find this request again, so
   * responses arriving out of order adjust the right entry.
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

  /** Count one grounded request. Returns the day it was counted on. */
  reserveGrounding(): string {
    this.rollGroundingDay();
    this.groundingUsage.rpd += 1;
    return this.groundingUsage.dateKey;
  }

  // ── Post-Response Adjustments ───────────────────────────────────────

  /**
   * Reconcile estimated tokens with actual tokens from API response.
   * Adjusts the most recent token entry to reflect reality.
   *
   * This keeps the per-minute token count true to what was billed, even
   * though individual estimates drift.
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
   * Take back a request the provider refused, so it is not counted.
   * Removes its request and token entries and decrements the day's count.
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

  /** Take back a grounded request the provider refused. */
  rollbackGrounding(reservedDate = this.getTodayKey()): void {
    this.rollGroundingDay();
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
    grounding: { rpd: number };
  } {
    const now = Date.now();
    const models: Record<string, { rpm: number; tpm: number; rpd: number }> =
      {};

    this.rollGroundingDay();
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
      grounding: { rpd: this.groundingUsage.rpd },
    };
  }
}

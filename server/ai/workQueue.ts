import { AppError } from "../utils/AppError.ts";
import { currentScopeOrNull, getContext } from "../tenancy/requestContext.ts";

export type JobPriority = "interactive" | "background";

export interface QueueRunOptions {
  /** Account/owner ID for multitenant fair queuing. Defaults to ALS context or "default". */
  accountId?: string;
  /** Priority class. "interactive" takes precedence over "background", with anti-starvation. */
  priority?: JobPriority;
  /** Signal for caller cancellation. Aborted jobs are removed before starting. */
  signal?: AbortSignal;
}

export interface AccountQueueStats {
  accountId: string;
  interactive: number;
  background: number;
  total: number;
  active: number;
}

export interface QueueSnapshot {
  active: number;
  concurrency: number;
  waiting: number;
  capacity: number;
  consecutiveInteractiveDispatches: number;
  accounts: AccountQueueStats[];
}

interface QueuedJob {
  id: string;
  accountId: string;
  priority: JobPriority;
  enqueuedAt: number;
  start: () => void;
  reject: (err: unknown) => void;
  cleanup: () => void;
}

interface AccountQueue {
  accountId: string;
  interactive: QueuedJob[];
  background: QueuedJob[];
}

/**
 * Multitenant fair generation queue with priority scheduling and noisy-neighbor isolation.
 *
 * - Bounds total concurrency (default 2 active jobs) across the instance.
 * - Bounds total waiting capacity (default 16 waiting jobs).
 * - Rotates waiting work between accounts (Round-Robin fair share) to eliminate starvation.
 * - Gives interactive user requests priority while guaranteeing background work progresses (anti-starvation).
 * - Prevents any single account from monopolizing the waiting capacity under congestion (fair tail drop).
 * - Decouples cancellation so caller aborts cleanly remove waiting jobs without leaking state.
 */
export class GenerationQueue {
  private active = 0;
  private readonly activeByAccount = new Map<string, number>();
  private readonly accounts = new Map<string, AccountQueue>();
  private readonly accountOrder: string[] = [];
  private lastInteractiveAccountIndex = -1;
  private lastBackgroundAccountIndex = -1;
  private consecutiveInteractiveDispatches = 0;
  private waitingCount = 0;

  constructor(
    private readonly concurrency = 2,
    private readonly capacity = 16,
    private readonly maxConsecutiveInteractive = 3,
  ) {}

  run<T>(
    operation: () => Promise<T>,
    signalOrOptions?: AbortSignal | QueueRunOptions,
    legacyOptions?: QueueRunOptions,
  ): Promise<T> {
    let signal: AbortSignal | undefined;
    let options: QueueRunOptions | undefined;

    if (
      signalOrOptions instanceof AbortSignal ||
      (signalOrOptions && "aborted" in signalOrOptions)
    ) {
      signal = signalOrOptions as AbortSignal;
      options = legacyOptions;
    } else if (signalOrOptions) {
      options = signalOrOptions as QueueRunOptions;
      signal = options.signal;
    }

    signal?.throwIfAborted();

    const accountId = options?.accountId ?? this.resolveCurrentAccountId();
    const priority = options?.priority ?? this.resolveCurrentPriority();

    // If there is idle concurrency and no waiting jobs, run immediately
    if (this.active < this.concurrency && this.waitingCount === 0) {
      return this.executeImmediate(operation, accountId, signal);
    }

    return this.enqueue(operation, accountId, priority, signal);
  }

  private executeImmediate<T>(
    operation: () => Promise<T>,
    accountId: string,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    this.incrementActive(accountId);

    return new Promise<T>((resolve, reject) => {
      Promise.resolve()
        .then(() => {
          signal?.throwIfAborted();
          return operation();
        })
        .then(resolve, reject)
        .finally(() => {
          this.decrementActive(accountId);
          this.dispatchNext();
        });
    });
  }

  private enqueue<T>(
    operation: () => Promise<T>,
    accountId: string,
    priority: JobPriority,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.waitingCount >= this.capacity) {
      const admitted = this.makeRoomIfFair(accountId, priority);
      if (!admitted) {
        return Promise.reject(
          new AppError("AI is busy. Please try again shortly.", 429, {
            code: "AI_BUSY",
          }),
        );
      }
    }

    return new Promise<T>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        if (onAbort && signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const job: QueuedJob = {
        id: crypto.randomUUID(),
        accountId,
        priority,
        enqueuedAt: Date.now(),
        cleanup,
        reject,
        start: () => {
          cleanup();
          if (signal?.aborted) {
            reject(signal.reason);
            this.dispatchNext();
            return;
          }
          if (priority === "interactive") {
            if (this.hasWaitingInTier("background")) {
              this.consecutiveInteractiveDispatches++;
            } else {
              this.consecutiveInteractiveDispatches = 0;
            }
          } else {
            this.consecutiveInteractiveDispatches = 0;
          }
          this.incrementActive(accountId);
          Promise.resolve()
            .then(() => {
              signal?.throwIfAborted();
              return operation();
            })
            .then(resolve, reject)
            .finally(() => {
              this.decrementActive(accountId);
              this.dispatchNext();
            });
        },
      };

      if (signal) {
        onAbort = () => {
          this.removeJob(job);
          cleanup();
          reject(signal.reason);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      this.addJob(job);
    });
  }

  /**
   * Fair queue admission control:
   * 1. If an account has waiting background jobs and submits an interactive request,
   *    its own newest background job is evicted to admit the interactive request
   *    (preserving the account's existing queue position in the round-robin order).
   * 2. If any tenant has waiting background jobs, evict the newest background job
   *    from the tenant with the most background work:
   *    - An interactive request can evict background work from any tenant.
   *    - A background request can only evict from a tenant with strictly more background jobs.
   * 3. If no background jobs exist across the entire queue:
   *    - Background requests can never evict interactive user requests.
   *    - An interactive request can evict the newest interactive job from the heaviest
   *      interactive tenant if caller has fewer interactive jobs.
   * 4. Otherwise, the incoming request is rejected with 429 AI_BUSY.
   */
  private makeRoomIfFair(
    incomingAccountId: string,
    incomingPriority: JobPriority,
  ): boolean {
    const callerAccount = this.accounts.get(incomingAccountId);

    // Rule 1: Preempt caller's own waiting background work for an incoming interactive job
    if (
      incomingPriority === "interactive" &&
      callerAccount &&
      callerAccount.background.length > 0
    ) {
      const evicted = callerAccount.background.pop()!;
      this.waitingCount = Math.max(0, this.waitingCount - 1);
      // Note: do not removeAccount here since addJob will immediately insert into callerAccount
      evicted.cleanup();
      evicted.reject(
        new AppError("AI is busy. Please try again shortly.", 429, {
          code: "AI_BUSY",
        }),
      );
      return true;
    }

    // Rule 2: If any tenant has waiting background jobs, evict the newest background job
    // from the tenant with the most background work.
    let heaviestBgAccount: AccountQueue | null = null;
    let maxBgCount = 0;
    for (const acc of this.accounts.values()) {
      if (acc.background.length > maxBgCount) {
        maxBgCount = acc.background.length;
        heaviestBgAccount = acc;
      }
    }

    if (heaviestBgAccount && maxBgCount > 0) {
      const callerBgCount = callerAccount?.background.length ?? 0;
      if (incomingPriority === "interactive" || callerBgCount < maxBgCount) {
        const evicted = heaviestBgAccount.background.pop()!;
        this.waitingCount = Math.max(0, this.waitingCount - 1);
        if (
          heaviestBgAccount.interactive.length === 0 &&
          heaviestBgAccount.background.length === 0
        ) {
          this.removeAccount(heaviestBgAccount.accountId);
        }
        evicted.cleanup();
        evicted.reject(
          new AppError("AI is busy. Please try again shortly.", 429, {
            code: "AI_BUSY",
          }),
        );
        return true;
      }
    }

    // Rule 3: No background jobs exist in the entire queue.
    // Background requests can never evict interactive requests.
    // An interactive request can evict from the heaviest interactive tenant if caller is quieter.
    if (incomingPriority === "interactive") {
      let heaviestIntAccount: AccountQueue | null = null;
      let maxIntCount = 0;
      for (const acc of this.accounts.values()) {
        if (acc.interactive.length > maxIntCount) {
          maxIntCount = acc.interactive.length;
          heaviestIntAccount = acc;
        }
      }
      const callerIntCount = callerAccount?.interactive.length ?? 0;
      if (heaviestIntAccount && callerIntCount < maxIntCount) {
        const evicted = heaviestIntAccount.interactive.pop()!;
        this.waitingCount = Math.max(0, this.waitingCount - 1);
        if (
          heaviestIntAccount.interactive.length === 0 &&
          heaviestIntAccount.background.length === 0
        ) {
          this.removeAccount(heaviestIntAccount.accountId);
        }
        evicted.cleanup();
        evicted.reject(
          new AppError("AI is busy. Please try again shortly.", 429, {
            code: "AI_BUSY",
          }),
        );
        return true;
      }
    }

    return false;
  }

  private dispatchNext(): void {
    if (this.active >= this.concurrency || this.waitingCount === 0) {
      return;
    }

    const hasInteractive = this.hasWaitingInTier("interactive");
    const hasBackground = this.hasWaitingInTier("background");

    if (!hasInteractive && !hasBackground) {
      return;
    }

    let chosenTier: JobPriority;
    if (hasInteractive && !hasBackground) {
      chosenTier = "interactive";
    } else if (!hasInteractive && hasBackground) {
      chosenTier = "background";
    } else {
      // Both tiers are waiting: prioritize interactive, but ensure background progress
      if (
        this.consecutiveInteractiveDispatches >= this.maxConsecutiveInteractive
      ) {
        chosenTier = "background";
      } else {
        chosenTier = "interactive";
      }
    }

    const job = this.popNextJobInTier(chosenTier);
    if (!job) {
      return;
    }

    job.start();
  }

  private hasWaitingInTier(tier: JobPriority): boolean {
    for (const account of this.accounts.values()) {
      const queue =
        tier === "interactive" ? account.interactive : account.background;
      if (queue.length > 0) return true;
    }
    return false;
  }

  private popNextJobInTier(tier: JobPriority): QueuedJob | null {
    if (this.accountOrder.length === 0) return null;

    const totalAccounts = this.accountOrder.length;
    const lastIndex =
      tier === "interactive"
        ? this.lastInteractiveAccountIndex
        : this.lastBackgroundAccountIndex;

    for (let i = 1; i <= totalAccounts; i++) {
      const candidateIndex = (lastIndex + i) % totalAccounts;
      const accountId = this.accountOrder[candidateIndex];
      const account = this.accounts.get(accountId);
      if (!account) continue;

      const queue =
        tier === "interactive" ? account.interactive : account.background;
      if (queue.length > 0) {
        const job = queue.shift()!;
        this.waitingCount = Math.max(0, this.waitingCount - 1);

        if (tier === "interactive") {
          this.lastInteractiveAccountIndex = candidateIndex;
        } else {
          this.lastBackgroundAccountIndex = candidateIndex;
        }

        if (
          account.interactive.length === 0 &&
          account.background.length === 0
        ) {
          this.removeAccount(accountId);
        }

        return job;
      }
    }

    return null;
  }

  private addJob(job: QueuedJob): void {
    let account = this.accounts.get(job.accountId);
    if (!account) {
      account = {
        accountId: job.accountId,
        interactive: [],
        background: [],
      };
      this.accounts.set(job.accountId, account);
      this.accountOrder.push(job.accountId);
    }

    const queue =
      job.priority === "interactive" ? account.interactive : account.background;
    queue.push(job);
    this.waitingCount++;
  }

  private removeJob(job: QueuedJob): void {
    const account = this.accounts.get(job.accountId);
    if (!account) return;

    const queue =
      job.priority === "interactive" ? account.interactive : account.background;
    const index = queue.indexOf(job);
    if (index !== -1) {
      queue.splice(index, 1);
      this.waitingCount = Math.max(0, this.waitingCount - 1);
      if (account.interactive.length === 0 && account.background.length === 0) {
        this.removeAccount(job.accountId);
      }
    }
  }

  private removeAccount(accountId: string): void {
    this.accounts.delete(accountId);
    const idx = this.accountOrder.indexOf(accountId);
    if (idx !== -1) {
      this.accountOrder.splice(idx, 1);
      if (idx <= this.lastInteractiveAccountIndex) {
        this.lastInteractiveAccountIndex = Math.max(
          -1,
          this.lastInteractiveAccountIndex - 1,
        );
      }
      if (idx <= this.lastBackgroundAccountIndex) {
        this.lastBackgroundAccountIndex = Math.max(
          -1,
          this.lastBackgroundAccountIndex - 1,
        );
      }
    }
    if (this.accountOrder.length === 0) {
      this.lastInteractiveAccountIndex = -1;
      this.lastBackgroundAccountIndex = -1;
    }
  }

  private incrementActive(accountId: string): void {
    this.active++;
    this.activeByAccount.set(
      accountId,
      (this.activeByAccount.get(accountId) ?? 0) + 1,
    );
  }

  private decrementActive(accountId: string): void {
    this.active = Math.max(0, this.active - 1);
    const current = (this.activeByAccount.get(accountId) ?? 1) - 1;
    if (current <= 0) {
      this.activeByAccount.delete(accountId);
    } else {
      this.activeByAccount.set(accountId, current);
    }
  }

  private resolveCurrentAccountId(): string {
    try {
      const scope = currentScopeOrNull();
      if (scope?.ownerId) return scope.ownerId;
      const ctx = getContext();
      if (ctx?.principal?.kind === "user") return ctx.principal.user.id;
    } catch {
      // ignore
    }
    return "default";
  }

  private resolveCurrentPriority(): JobPriority {
    try {
      const ctx = getContext();
      if (ctx?.requestId && ctx.requestId.startsWith("job-")) {
        return "background";
      }
    } catch {
      // ignore
    }
    return "interactive";
  }

  getSnapshot(): QueueSnapshot {
    const allAccountIds = new Set<string>([
      ...this.accounts.keys(),
      ...this.activeByAccount.keys(),
    ]);

    const accounts: AccountQueueStats[] = [];
    for (const accountId of allAccountIds) {
      const acc = this.accounts.get(accountId);
      const interactive = acc?.interactive.length ?? 0;
      const background = acc?.background.length ?? 0;
      const active = this.activeByAccount.get(accountId) ?? 0;

      accounts.push({
        accountId,
        interactive,
        background,
        total: interactive + background,
        active,
      });
    }

    return {
      active: this.active,
      concurrency: this.concurrency,
      waiting: this.waitingCount,
      capacity: this.capacity,
      consecutiveInteractiveDispatches: this.consecutiveInteractiveDispatches,
      accounts,
    };
  }

  /** Reset internal state for isolated unit testing. */
  __resetForTests(): void {
    this.active = 0;
    this.activeByAccount.clear();
    this.accounts.clear();
    this.accountOrder.length = 0;
    this.lastInteractiveAccountIndex = -1;
    this.lastBackgroundAccountIndex = -1;
    this.consecutiveInteractiveDispatches = 0;
    this.waitingCount = 0;
  }
}

/** Share identical work. One caller cannot cancel work another caller still needs. */
export class SharedWork<T> {
  private entries = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >();

  async run(
    key: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.entries.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created = {
        controller,
        users: 0,
        promise: Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return operation(controller.signal);
        }),
      };
      entry = created;
      this.entries.set(key, created);
      const remove = () => {
        if (this.entries.get(key) === created) this.entries.delete(key);
      };
      created.promise.then(remove, remove);
    }
    const current = entry;
    current.users++;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([current.promise, cancelled]);
    } finally {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      current.users--;
      if (current.users === 0) {
        current.controller.abort();
        if (this.entries.get(key) === current) this.entries.delete(key);
      }
    }
  }
}

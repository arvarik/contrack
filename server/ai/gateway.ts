// The single entry point business code uses to run a generation. Callers say
// what kind of work it is ("quick", "deep", "research"), and the gateway
// resolves the provider and model from the capability configuration.

import type { AIGenerateOptions, AIGenerateResult } from "./types.ts";
export type { AIGenerateResult } from "./types.ts";
import type { AICapability } from "./capabilities.ts";
import { resolveCapability, type ResolvedCapability } from "./capabilities.ts";
import { getProviderConfigs } from "./providerRegistry.ts";
import { isAiOffForInstance } from "./instanceSwitch.ts";
import { AppError } from "../utils/AppError.ts";
import {
  GenerationQueue,
  type JobPriority,
  type QueueLane,
  type QueueSnapshot,
} from "./workQueue.ts";
import { withTimeout } from "./resilience.ts";

const generations = new GenerationQueue();

/** Options accepted by the gateway (model/routing are filled in for you). */
export type GatewayOptions = Omit<AIGenerateOptions, "routing"> & {
  /** Explicit account ID for multitenant fair scheduling. */
  accountId?: string;
  /** Explicit priority class. Defaults to context-inferred priority. */
  priority?: JobPriority;
  /**
   * "search" runs the call in the Ask lane, which has two slots of its own.
   * The planner, the reranker and the brief pass it. Everything else shares
   * the default two slots.
   */
  lane?: QueueLane;
  /**
   * Runs when the call gets its slot, just before it goes to the provider.
   * Throw to refuse it. A call can wait in the queue a while, so a caller whose
   * permission can change meanwhile checks it here: contact research reads the
   * account's AI switch.
   */
  beforeSend?: () => void;
};

/**
 * True when at least one provider has usable credentials and AI is on for
 * the instance. Every AI service reads "mock mode" from this, so while an
 * admin has AI off they answer as they do with no key at all.
 */
export function isAnyProviderConfigured(): boolean {
  if (isAiOffForInstance()) return false;
  return getProviderConfigs().length > 0;
}

/** The refusal for a generation asked for while AI is off for the instance. */
function aiOffError(): AppError {
  return new AppError("An admin turned AI off for this instance", 503, {
    code: "AI_OFF_FOR_INSTANCE",
  });
}

/**
 * Run a generation for a capability.
 *
 * @throws ServiceUnavailable-style AppError when no provider can serve the
 *         capability (no credentials, or the capability is disabled).
 */
export async function generateFor(
  capability: Exclude<AICapability, "embeddings">,
  options: GatewayOptions,
): Promise<AIGenerateResult> {
  return runQueued(capability, options, (resolved, request) =>
    resolved.provider.generate(request),
  );
}

/**
 * Run a text generation and hand each piece of it to `onDelta` as it
 * arrives, then resolve with the whole result.
 *
 * The same queue, lane and timeout rules as `generateFor`. An adapter with
 * no `generateStream` runs `generate`, and its text arrives as one piece.
 *
 * @throws the same errors as `generateFor`.
 */
export async function streamFor(
  capability: Exclude<AICapability, "embeddings">,
  options: GatewayOptions,
  onDelta: (text: string) => void,
): Promise<AIGenerateResult> {
  return runQueued(capability, options, async (resolved, request) => {
    if (resolved.provider.generateStream)
      return resolved.provider.generateStream(request, onDelta);
    const result = await resolved.provider.generate(request);
    if (result.text) onDelta(result.text);
    return result;
  });
}

/**
 * Resolve the capability, then run `call` in the queue under one timeout.
 * The timeout covers the wait for a slot as well as the call.
 */
function runQueued(
  capability: Exclude<AICapability, "embeddings">,
  options: GatewayOptions,
  call: (
    resolved: ResolvedCapability,
    request: AIGenerateOptions,
  ) => Promise<AIGenerateResult>,
): Promise<AIGenerateResult> {
  const { beforeSend, ...rest } = options;
  options.signal?.throwIfAborted();
  if (isAiOffForInstance()) throw aiOffError();
  const resolved = resolveCapability(capability);
  if (!resolved) {
    throw new AppError(
      `No AI provider is configured for the "${capability}" capability`,
      503,
      { code: "AI_CAPABILITY_UNAVAILABLE", details: { capability } },
    );
  }

  const overrideMs = Number(process.env.AI_GATEWAY_TIMEOUT_OVERRIDE);
  const requestedMs =
    Number.isFinite(overrideMs) && overrideMs > 0
      ? overrideMs
      : (options.timeoutMs ?? 60_000);
  // At most 150 s. Contact research asks for 120 (`ASK_TIMEOUT_MS`): one
  // search ask takes from 15 s to more than 80 s. No other caller asks for
  // more than 90.
  const timeoutMs =
    Number.isFinite(requestedMs) && requestedMs > 0
      ? Math.min(requestedMs, 150_000)
      : 60_000;
  return withTimeout(
    (signal) =>
      generations.run(
        () => {
          // Asked again when the slot comes up: a job can wait a while, and an
          // admin who turns AI off meanwhile expects waiting jobs to stop. The
          // caller's own check runs first, so its refusal is the one the caller
          // sees.
          beforeSend?.();
          if (isAiOffForInstance()) throw aiOffError();
          return call(resolved, {
            ...rest,
            signal,
            timeoutMs,
            maxOutputTokens: options.maxOutputTokens ?? 4_096,
            model: options.model ?? resolved.model,
            routing: { prefer: resolved.modelClass },
          });
        },
        {
          signal,
          accountId: options.accountId,
          priority: options.priority,
          lane: options.lane,
        },
      ),
    timeoutMs,
    options.signal,
  );
}

/** Which provider currently serves a capability (for logging/telemetry). */
export function providerIdFor(
  capability: Exclude<AICapability, "embeddings">,
): string | null {
  return resolveCapability(capability)?.providerId ?? null;
}

/** Snapshot of AI generation queue status for health monitoring and diagnostics. */
export function getAIQueueSnapshot(): QueueSnapshot {
  return generations.getSnapshot();
}

/** For tests: inspect or reset queue instance. */
export function __getGenerationQueueForTests(): GenerationQueue {
  return generations;
}

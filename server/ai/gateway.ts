// =============================================================================
// AI Layer — Capability Gateway
// =============================================================================
// The single entry point business logic uses to run a generation. Callers say
// *what kind of work* it is ("quick", "deep", "research") and the gateway
// resolves the provider and model from the user's capability configuration.
//
// This replaces the old pattern of calling a single shared provider with a
// `routing.prefer` class — that only ever worked when one provider served
// everything.
// =============================================================================

import type { AIGenerateOptions, AIGenerateResult } from "./types.ts";
import type { AICapability } from "./capabilities.ts";
import { resolveCapability } from "./capabilities.ts";
import { getProviderConfigs } from "./providerRegistry.ts";
import { AppError } from "../utils/AppError.ts";
import { GenerationQueue } from "./workQueue.ts";
import { withTimeout } from "./resilience.ts";

const generations = new GenerationQueue();

/** Options accepted by the gateway (model/routing are filled in for you). */
export type GatewayOptions = Omit<AIGenerateOptions, "routing">;

/** True when at least one provider has usable credentials. */
export function isAnyProviderConfigured(): boolean {
  return getProviderConfigs().length > 0;
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
  options.signal?.throwIfAborted();
  const resolved = resolveCapability(capability);
  if (!resolved) {
    throw new AppError(
      `No AI provider is configured for the "${capability}" capability`,
      503,
      { code: "AI_CAPABILITY_UNAVAILABLE", details: { capability } },
    );
  }

  const timeoutMs = Math.min(options.timeoutMs ?? 60_000, 90_000);
  return withTimeout(
    (signal) =>
      generations.run(
        () =>
          resolved.provider.generate({
            ...options,
            signal,
            timeoutMs,
            maxOutputTokens: options.maxOutputTokens ?? 4_096,
            model: options.model ?? resolved.model,
            routing: { prefer: resolved.modelClass },
          }),
        signal,
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

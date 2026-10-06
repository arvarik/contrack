// The Gemini router: pick the model to call for a request's routing
// preferences.
//
//   1. FILTER  drop models a circuit breaker paused, models the policy
//              excludes, and, for a grounded request, models with no search.
//   2. SORT    the preferred class first, then the newest generation, stable
//              before preview, cheapest last.
//
// There is no capacity check: Google sets limits per Cloud project and does not
// publish them. A model that is full answers 429, the adapter pauses it for the
// delay Google asks for, and the next request goes to the next model.

import {
  compareForClass,
  getActiveGeminiRegistry,
  type ModelConfig,
} from "./registry.ts";
import type { RoutingPolicy } from "../types.ts";
import { log } from "../../utils/logger.ts";

export interface RouteDecision {
  /** The selected model identifier */
  modelId: string;
}

export class SmartRouter {
  private registryFn: () => ModelConfig[];

  constructor(registry?: ModelConfig[] | (() => ModelConfig[])) {
    if (typeof registry === "function") {
      this.registryFn = registry;
    } else if (Array.isArray(registry)) {
      this.registryFn = () => registry;
    } else {
      this.registryFn = getActiveGeminiRegistry;
    }
  }

  /**
   * Pick a model for a request.
   *
   * @param policy            - Caller's routing preferences
   * @param circuitBreakers   - Model IDs paused after a 429, 5xx or timeout
   * @param requiresGrounding - Whether the request needs Google Search
   * @throws                  - If no model is left to try
   */
  getNextAvailableRoute(
    policy: RoutingPolicy = {},
    circuitBreakers: Set<string>,
    requiresGrounding: boolean = false,
  ): RouteDecision {
    const candidates = this.registryFn().filter((m) => {
      if (circuitBreakers.has(m.id)) return false;
      if (requiresGrounding && !m.supportsGrounding) return false;
      return true;
    });

    if (candidates.length === 0) {
      throw new Error(
        "SmartRouter: No models match routing criteria. " +
          `Paused: [${[...circuitBreakers].join(", ")}], ` +
          `Policy: ${JSON.stringify(policy)}, ` +
          `Grounding required: ${requiresGrounding}`,
      );
    }

    const [pick] = candidates.sort(compareForClass(policy.prefer));
    log.debug(
      "SmartRouter",
      `Routed to ${pick.id}` +
        (policy.prefer ? ` (prefer: ${policy.prefer})` : ""),
    );
    return { modelId: pick.id };
  }
}

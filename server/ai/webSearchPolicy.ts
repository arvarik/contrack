// The web search policy: two choices an admin makes about contact research in
// Settings → Administration → AI → Web search, kept in one app setting,
// `ai.webSearch`.
// - "Allow web search": off stops every web search, the web search model's and
//   SearXNG's, and research refuses to start (`isResearchOff`).
// - "Web search engine": what research uses when an account keeps "Instance
//   default": the web search model, SearXNG, or both.

import {
  getSetting,
  setSetting,
  SETTING_KEYS,
} from "../services/settingsService.ts";
import {
  DEFAULT_WEB_SEARCH_ENGINE,
  webSearchEngineSchema,
  type WebSearchEngine,
} from "../../shared/webSearchEngine.ts";
import { log } from "../utils/logger.ts";

/** The stored policy. Absent fields take their defaults. */
interface StoredPolicy {
  off?: boolean;
  engine?: WebSearchEngine;
}

/** The policy as the server uses it. */
export interface WebSearchPolicy {
  /** True when an admin turned web search off. */
  off: boolean;
  /** The engine an account that keeps "Instance default" searches with. */
  engine: WebSearchEngine;
}

/** The web search policy, with defaults filling every gap. */
export function getWebSearchPolicy(): WebSearchPolicy {
  const stored = getSetting<StoredPolicy>(SETTING_KEYS.aiWebSearch) ?? {};
  const engine = webSearchEngineSchema.safeParse(stored.engine);
  return {
    off: stored.off === true,
    engine: engine.success ? engine.data : DEFAULT_WEB_SEARCH_ENGINE,
  };
}

/** Change one or both choices, and keep the other. */
export function setWebSearchPolicy(patch: Partial<WebSearchPolicy>): void {
  const next = { ...getWebSearchPolicy(), ...patch };
  setSetting(SETTING_KEYS.aiWebSearch, next);
  log.info(
    "WebSearch",
    `Web search ${next.off ? "off" : "on"}, engine ${next.engine}`,
  );
}

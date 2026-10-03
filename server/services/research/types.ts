// =============================================================================
// Research — the request, the result, and the two ports
// =============================================================================
// A research run takes one ResearchRequest and gives one ResearchResult. Two
// ports keep the run apart from what it searches with:
//
//   Technique  how a run finds facts: the research model's own search, a web
//              search whose pages a model reads, or both. It returns evidence,
//              never contact fields.
//   WebSearch  a search service that answers a query with results, such as
//              SearXNG. A technique that searches the web itself uses the one
//              the request chose.
// =============================================================================

import type { HydratedContact } from "../../repositories/types.ts";
import type { Scope } from "../../tenancy/scope.ts";
import type { AIGenerateResult, GatewayOptions } from "../../ai/gateway.ts";
import type {
  ResearchFinding,
  ResearchRecord,
  ResearchUsage,
} from "../../../shared/researchRecord.ts";
import type { ResearchDepth } from "../../../shared/researchDepth.ts";
import type { Meter, SourceOutcome } from "./evidence.ts";

/** How a run searches: a technique, and the web search it uses, if any. */
export interface ResearchChoice {
  /** A registered technique name, such as "provider-search". */
  technique: string;
  /** A registered web search id, such as "searxng". */
  webSearch?: string;
}

/** One contact to research, and how. */
export interface ResearchRequest extends Partial<ResearchChoice> {
  /** The account that owns the contact. Its AI switch is read before every call. */
  scope: Scope;
  /** The contact as the records hold it now. */
  contact: HydratedContact;
  /** How thoroughly to research. */
  depth: ResearchDepth;
  /** The contact's research so far, which the prompts are built from. */
  history: ResearchRecord | null;
  /** Stops the run when the caller cancels. */
  signal?: AbortSignal;
  /** How long the whole run may take, in ms. RESEARCH_TIMEOUT_MS by depth when absent. */
  timeoutMs?: number;
}

/** What a run found. Every technique fills every field. */
export interface ResearchResult {
  /** "no-public-info" when a search ran and no page was about this person. */
  outcome: "found" | "no-public-info";
  /** The contact fields the extraction read from the facts. Empty for no-public-info. */
  data: Record<string, unknown>;
  /** Each fact, with the page or the site that states it. */
  findings: ResearchFinding[];
  /** The pages the facts came from, each once. */
  citations: Array<{ title: string; uri: string }>;
  /** The searches that ran. */
  queries: string[];
  /** The models that ran, the first search first, at most four. */
  models: string[];
  /** The depth the run researched at. */
  depth: ResearchDepth;
  /** What the run spent, over every call. */
  usage: ResearchUsage;
  /** The providers' token totals, over every call. */
  tokenCount: number;
  /** How long the run took. */
  latencyMs: number;
}

/** A model capability a technique calls. */
export type ModelCapability = "research" | "quick" | "deep";

/**
 * Something a technique needs set up before a start is accepted. A start
 * that lacks it answers 503 with `message`. A missing web search answers
 * with the web search's own words and code (`webSearchUnset`).
 */
export type Need =
  { what: ModelCapability; message: string } | { what: "web-search" };

/** What a technique runs with. Every call it makes goes through here. */
export interface TechniqueContext {
  /** Counts what the run spends. */
  meter: Meter;
  /**
   * A model call through the gateway. The AI switches are read first, and a
   * refusal ends the run.
   */
  generate(
    capability: ModelCapability,
    options: GatewayOptions,
  ): Promise<AIGenerateResult>;
  /**
   * The web search the request chose, behind the same switches. Null for a
   * technique that needs none.
   */
  webSearch: WebSearch | null;
}

/** One way to find facts about a contact. */
export interface Technique {
  /** The name a request chooses it by. */
  readonly name: string;
  /** What must be set up before a start is accepted, in the order it is checked. */
  needs(): Need[];
  /**
   * Find facts about the contact. It builds its own prompts. It throws only
   * when the run stops: cancelled, past its deadline, or refused by an AI
   * switch. Anything else it says in the outcome.
   */
  run(request: ResearchRequest, ctx: TechniqueContext): Promise<SourceOutcome>;
}

/** One result of a web search. */
export interface WebResult {
  url: string;
  title: string;
  /** The service's short excerpt of the page. */
  snippet: string;
  /** The page's text, when the service sends it. Without it, the page is fetched. */
  content?: string;
}

/** A web search service. */
export interface WebSearch {
  /** The id a request chooses it by, and the start of its error codes. */
  readonly id: string;
  /** Its name, as messages say it. */
  readonly label: string;
  /** True when an admin has set it up. */
  configured(): boolean;
  /**
   * The results for one query, at most `limit`. Throws an AppError that says
   * what the service answered when it fails, and one with the code
   * `<ID>_NOT_CONFIGURED` while it is not set up.
   */
  search(
    query: string,
    options: { limit: number; signal?: AbortSignal },
  ): Promise<WebResult[]>;
}

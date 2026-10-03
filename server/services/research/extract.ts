// =============================================================================
// Research — the extraction: fact lines into contact fields
// =============================================================================
// Every technique ends in fact lines, and this one step reads them into the
// output schema. No technique parses fields itself.
// =============================================================================

import { resolveCapability } from "../../ai/capabilities.ts";
import {
  buildExtractionPrompt,
  extractionJsonSchema,
  parseExtraction,
  tidyExtraction,
} from "../aiSearch/promptTemplate.ts";
import { recordInvocation } from "../aiStatsService.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";
import { CHARS_PER_TOKEN, contextWindowFor } from "./evidence.ts";
import type { ResearchRequest, TechniqueContext } from "./types.ts";

/**
 * Read fact lines into the output schema. No searching: the facts are
 * already on the page.
 *
 * The quick model reads them: it has read research since 2026-09-26. A stack
 * with a web search and one local model may have no quick model, and then
 * the deep one reads.
 *
 * Field by field: a value that fails its schema is left out, and the rest of
 * the answer is kept. The rules a model follows only some of the time are
 * applied in code (`tidyExtraction`).
 *
 * @param label - The technique's name, for the log.
 */
export async function extractFacts(
  request: ResearchRequest,
  facts: string,
  ctx: TechniqueContext,
  label: string,
): Promise<{
  data: Record<string, unknown>;
  model: string;
  latencyMs: number;
}> {
  const { contact, signal } = request;
  const startMs = Date.now();
  const capability = resolveCapability("quick") ? "quick" : "deep";
  const prompt = buildExtractionPrompt(contact, facts);
  // A small window holds the prompt and what is left for the answer. A
  // server such as vLLM refuses a call whose prompt and answer exceed it.
  const window = contextWindowFor(capability);
  const result = await ctx.generate(capability, {
    prompt,
    responseFormat: "json",
    jsonSchema: extractionJsonSchema,
    signal,
    timeoutMs: 30_000,
    maxOutputTokens: window
      ? Math.max(
          512,
          Math.min(6_000, window - Math.ceil(prompt.length / CHARS_PER_TOKEN)),
        )
      : 6_000,
  });
  signal?.throwIfAborted();
  ctx.meter.count(result);
  recordInvocation({
    operation: "aiSearchExtraction",
    model: result.model,
    tokenCount: result.tokenCount,
    latencyMs: Date.now() - startMs,
    cached: false,
    description: `AI Search extraction: ${contact.name}`,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(result.text || "{}");
  } catch (parseErr: unknown) {
    throw new Error(
      `JSON parse failed for extraction output: ${getErrorMessage(parseErr)}. `,
    );
  }
  const { data, dropped } = parseExtraction(raw);
  if (dropped.length > 0)
    log.warn(
      label,
      `${contact.name}: ${result.model} wrote values the schema refused; left out: ${dropped.join(", ")}`,
    );
  return {
    data: tidyExtraction(data, contact) as Record<string, unknown>,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

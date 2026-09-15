import type { AIProvider } from "../../server/ai/provider.ts";
import type { AIGenerateOptions } from "../../server/ai/types.ts";
import type { RecordedResponses } from "../../tests/eval/answer-harness.ts";

/** Identify the operation and complete query, including embedded quotes. */
export function identifyAnswerCall(
  options: Partial<Pick<AIGenerateOptions, "prompt" | "systemPrompt">>,
): { operation: keyof RecordedResponses; queryKey: string } | null {
  const prompt = options.prompt ?? "";
  const system = options.systemPrompt ?? "";
  let operation: keyof RecordedResponses;
  if (system.includes("query planner")) operation = "queryParse";
  else if (system.includes("data analyst")) operation = "rerank";
  else if (system.includes("executive brief")) operation = "synthesis";
  else return null;

  const query =
    prompt.match(
      /^<untrusted_data label="query">\n([\s\S]*?)\n<\/untrusted_data>/,
    )?.[1] ?? prompt.match(/^Query:\s*"([\s\S]*?)"\r?\n\r?\n/i)?.[1];
  if (!query?.trim()) return null;
  return { operation, queryKey: query.toLowerCase().trim() };
}

/** Record only fresh provider calls and audit failures that production catches. */
export function installAnswerRecorder(provider: AIProvider): {
  responses: RecordedResponses;
  models: Set<string>;
  assertComplete: () => void;
  restore: () => void;
} {
  const original = provider.generate;
  const responses: RecordedResponses = {
    queryParse: {},
    rerank: {},
    synthesis: {},
  };
  const models = new Set<string>();
  const failures: string[] = [];
  let pending = 0;
  provider.generate = async (options) => {
    const call = identifyAnswerCall(options);
    pending++;
    const onAbort = () =>
      failures.push(`${call?.operation ?? "unknown"}: provider call aborted`);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      options.signal?.throwIfAborted();
      if (!call)
        throw new Error("Unrecognized answer evaluation provider call");
      // Adapters already implement bounded retries. Extra retries here can
      // outlive the gateway timeout and overwrite a later recording.
      const result = await original.call(provider, options);
      options.signal?.throwIfAborted();
      if (!result.text?.trim())
        throw new Error("Empty answer evaluation provider response");
      const previous = responses[call.operation][call.queryKey];
      if (previous !== undefined && previous !== result.text) {
        throw new Error(
          `Conflicting recordings for ${call.operation}: ${call.queryKey}`,
        );
      }
      responses[call.operation][call.queryKey] = result.text;
      models.add(result.model);
      return result;
    } catch (error) {
      failures.push(`${call?.operation ?? "unknown"}: ${String(error)}`);
      throw error;
    } finally {
      pending--;
      options.signal?.removeEventListener("abort", onAbort);
    }
  };
  return {
    responses,
    models,
    assertComplete: () => {
      if (pending)
        throw new Error(
          `Answer evaluation has ${pending} unfinished provider calls`,
        );
      if (failures.length) {
        throw new Error(
          `Answer evaluation provider failures (${failures.length}):\n${failures.join("\n")}`,
        );
      }
      if (!models.size)
        throw new Error("Answer evaluation made no successful provider calls");
    },
    restore: () => {
      provider.generate = original;
    },
  };
}

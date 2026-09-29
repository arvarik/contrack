// =============================================================================
// Provider contract tests
// =============================================================================
// One block per provider, each asserting the things a mocked test cannot:
//
//   1. listModels() speaks the shape we parse
//   2. structured output actually returns parseable JSON matching the schema
//   3. embed() returns one vector per input, at a stable dimension
//   4. an array schema, a small budget and a grounded call each work
//   5. every chat model the catalog offers answers a request
//
// (2) is the important one. Both real provider bugs found in v1.4.0 were wire
// format mismatches — Anthropic's schema wrapper and Gemini's batch embedding
// shape — and both were invisible to mocked tests. (4) and (5) are the bugs
// found on 2026-09-26: OpenAI refused an array at the schema root, reasoning
// ate a small budget, research sent the wrong format to the Responses API,
// and the OpenAI catalog offered sixteen models that could not answer.
//
// Run with: npm run test:contract
// Providers without credentials skip themselves.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  geminiKey,
  openaiKey,
  anthropicKey,
  compatUrl,
  compatModel,
  modelFor,
  embedModelFor,
  announce,
  probeCredential,
  CONTRACT_TIMEOUT_MS,
  CONTACT_SCHEMA,
  EXTRACTION_PROMPT,
} from "./helpers.ts";
import { parseAIJson } from "../../server/ai/resilience.ts";
import { applyCatalogGuardrails } from "../../server/ai/modelFilter.ts";
import type { AIProvider, ModelInfo } from "../../server/ai/provider.ts";
import type { AIGenerateOptions } from "../../server/ai/types.ts";

// Probed once at load: a credential the provider rejects skips its block with
// an explanation, so a stale key in someone's shell cannot turn this red.
const { GeminiAdapter } = await import("../../server/ai/adapters/gemini.ts");
const { OpenAIAdapter } = await import("../../server/ai/adapters/openai.ts");
const { AnthropicAdapter } =
  await import("../../server/ai/adapters/anthropic.ts");
const { OpenAICompatibleAdapter } =
  await import("../../server/ai/adapters/openaiCompatible.ts");

const gemini = await probeCredential("gemini", geminiKey(), () =>
  new GeminiAdapter(geminiKey()!).listModels(),
);
const openai = await probeCredential("openai", openaiKey(), () =>
  new OpenAIAdapter(openaiKey()!).listModels(),
);
const anthropic = await probeCredential("anthropic", anthropicKey(), () =>
  new AnthropicAdapter(anthropicKey()!).listModels(),
);

/** A root the OpenAI wire format refuses unless it is wrapped. */
const LIST_SCHEMA = {
  type: "array" as const,
  items: { type: "string" as const },
};
const LIST_PROMPT =
  "Name three primary colours. Return a JSON array of strings.";

/** A grounded question no model can answer from memory. */
const SEARCH_PROMPT = `Search the web and name one headline published on ${new Date()
  .toISOString()
  .slice(0, 10)}, with its source. One sentence.`;

/**
 * Ask every chat model the catalog would offer, after the guardrails, for one
 * word. The failure names each model that could not answer.
 */
async function expectOfferedModelsAnswer(
  adapter: Pick<AIProvider, "generate"> & {
    listModels(): Promise<ModelInfo[]>;
  },
  options: Partial<AIGenerateOptions>,
) {
  const models = applyCatalogGuardrails(await adapter.listModels()).filter(
    (m) => m.capabilities.includes("chat"),
  );
  const failures = (
    await Promise.all(
      models.map(async (m) => {
        try {
          await adapter.generate({
            prompt: "Reply with the single word OK.",
            responseFormat: "text",
            model: m.id,
            ...options,
          });
          return null;
        } catch (err) {
          return `${m.id}: ${(err as Error).message.slice(0, 120)}`;
        }
      }),
    )
  ).filter(Boolean);
  expect(failures).toEqual([]);
}

/** A batch of three inputs must come back as three distinct vectors of one size. */
function expectOneVectorPerInput(vectors: number[][]) {
  expect(vectors).toHaveLength(3);
  expect(vectors[0].length).toBeGreaterThan(0);
  expect(new Set(vectors.map((v) => v.length)).size).toBe(1);
  expect(vectors[0]).not.toEqual(vectors[1]);
}

/** Assert a generate() result is JSON we can actually use. */
function expectUsableExtraction(text: string) {
  const parsed = parseAIJson<Record<string, unknown>>(text, "contract");
  expect(parsed).toBeTypeOf("object");
  // The model was given an unambiguous name; anything else means the request
  // was malformed rather than the model being creative.
  expect(String(parsed.name)).toMatch(/jane/i);
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

describe.skipIf(!gemini.usable)("Gemini", () => {
  it(
    "lists models with declared capabilities",
    async () => {
      const models = await new GeminiAdapter(geminiKey()!).listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.capabilities.includes("chat"))).toBe(true);
      expect(models.some((m) => m.capabilities.includes("embeddings"))).toBe(
        true,
      );
      // Gemini's REST list reports supportedGenerationMethods, so capability is
      // known rather than guessed from the model name.
      expect(models[0].capabilityConfidence).toBe("declared");
      // Model ids must not carry the "models/" prefix the REST API returns.
      expect(models.every((m) => !m.id.startsWith("models/"))).toBe(true);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "returns schema-conformant JSON",
    async () => {
      const result = await new GeminiAdapter(geminiKey()!).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: modelFor("gemini", "gemini-3.8-flash"),
        maxOutputTokens: 500,
        timeoutMs: 15_000,
      });
      expectUsableExtraction(result.text);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "grounds an answer with sources",
    async () => {
      const result = await new GeminiAdapter(geminiKey()!).generate({
        prompt: SEARCH_PROMPT,
        responseFormat: "text",
        enableSearchGrounding: true,
        routing: { prefer: "flash" },
        maxOutputTokens: 8_192,
        timeoutMs: 60_000,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.citations?.length).toBeGreaterThan(0);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it("offers only chat models that answer", async () => {
    await expectOfferedModelsAnswer(new GeminiAdapter(geminiKey()!), {
      maxOutputTokens: 256,
      timeoutMs: 60_000,
    });
  }, 180_000);

  it(
    "embeds one vector per input, not one per batch",
    async () => {
      // The v1.4.0 bug: `contents: string[]` reads as ONE Content with many
      // parts, so a batch collapsed to a single vector and the rest were
      // dropped. A batch of 3 is enough to catch a regression.
      const vectors = await new GeminiAdapter(geminiKey()!).embed(
        ["alpha one", "beta two", "gamma three"],
        embedModelFor("gemini", "gemini-embedding-2"),
      );
      expectOneVectorPerInput(vectors);
    },
    CONTRACT_TIMEOUT_MS,
  );
});

// ─── OpenAI ──────────────────────────────────────────────────────────────────

describe.skipIf(!openai.usable)("OpenAI", () => {
  it(
    "lists models, inferring capability from the id",
    async () => {
      const models = await new OpenAIAdapter(openaiKey()!).listModels();

      expect(models.length).toBeGreaterThan(0);
      // OpenAI returns bare ids, so capability is a guess and must be labelled
      // as one — the UI marks these differently.
      expect(models[0].capabilityConfidence).toBe("guessed");
      expect(models.some((m) => m.capabilities.includes("embeddings"))).toBe(
        true,
      );
      // Non-text models would break every dropdown they appeared in.
      expect(models.every((m) => !/whisper|tts|dall-e/i.test(m.id))).toBe(true);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "returns schema-conformant JSON",
    async () => {
      // The Anthropic-class bug: the response_format wrapper differs per
      // vendor, and getting it wrong fails only against the real API.
      const result = await new OpenAIAdapter(openaiKey()!).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: modelFor("openai", "gpt-6-luna"),
      });
      expectUsableExtraction(result.text);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "returns an array for an array schema",
    async () => {
      const result = await new OpenAIAdapter(openaiKey()!).generate({
        prompt: LIST_PROMPT,
        responseFormat: "json",
        jsonSchema: LIST_SCHEMA,
        model: modelFor("openai", "gpt-6-luna"),
      });
      expect(Array.isArray(JSON.parse(result.text))).toBe(true);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "answers inside a small budget",
    async () => {
      const result = await new OpenAIAdapter(openaiKey()!).generate({
        prompt: "Summarize in one sentence: the pilot starts in October.",
        responseFormat: "text",
        routing: { prefer: "lite" },
        maxOutputTokens: 200,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "grounds JSON through the Responses API, with sources",
    async () => {
      const result = await new OpenAIAdapter(openaiKey()!).generate({
        prompt: `${SEARCH_PROMPT} Return JSON with "headline" and "source".`,
        responseFormat: "json",
        jsonSchema: {
          type: "object",
          properties: {
            headline: { type: "string" },
            source: { type: "string" },
          },
        },
        enableSearchGrounding: true,
        routing: { prefer: "flash" },
        timeoutMs: 90_000,
      });
      expect(() => parseAIJson(result.text, "contract")).not.toThrow();
      expect(result.citations?.length).toBeGreaterThan(0);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it("offers only chat models that answer", async () => {
    await expectOfferedModelsAnswer(new OpenAIAdapter(openaiKey()!), {
      maxOutputTokens: 16,
      timeoutMs: 60_000,
    });
  }, 180_000);

  it(
    "embeds one vector per input",
    async () => {
      const vectors = await new OpenAIAdapter(openaiKey()!).embed(
        ["alpha one", "beta two", "gamma three"],
        embedModelFor("openai", "text-embedding-3-small"),
      );
      expectOneVectorPerInput(vectors);
    },
    CONTRACT_TIMEOUT_MS,
  );
});

// ─── Anthropic ───────────────────────────────────────────────────────────────

describe.skipIf(!anthropic.usable)("Anthropic", () => {
  it(
    "lists models with declared capabilities",
    async () => {
      const models = await new AnthropicAdapter(anthropicKey()!).listModels();

      expect(models.length).toBeGreaterThan(0);
      expect(models[0].capabilityConfidence).toBe("declared");
      // Anthropic has no embeddings endpoint; claiming otherwise would let the
      // UI offer an assignment that can never work.
      expect(models.every((m) => !m.capabilities.includes("embeddings"))).toBe(
        true,
      );
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "returns schema-conformant JSON via output_config.format",
    async () => {
      // Regression guard for the v1.4.0 bug: Contrack sent OpenAI's nested
      // `json_schema: { name, schema }` wrapper, which Anthropic rejects with a
      // 400. Every JSON operation failed while the mocked test stayed green.
      const result = await new AnthropicAdapter(anthropicKey()!).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: modelFor("anthropic", "claude-sonnet-5"),
      });
      expectUsableExtraction(result.text);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "returns JSON for a schema wider than Claude's parameter cap",
    async () => {
      // Claude caps a schema at 24 optional parameters and Contrack's research
      // schema exceeds it, so the degradation path is load-bearing, not
      // theoretical.
      const wide = {
        type: "object" as const,
        properties: Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `field${i}`,
            { type: "string" as const },
          ]),
        ),
        required: ["field0"],
      };
      const result = await new AnthropicAdapter(anthropicKey()!).generate({
        prompt: "Return JSON with field0 set to the string 'ok'.",
        responseFormat: "json",
        jsonSchema: wide,
        model: modelFor("anthropic", "claude-sonnet-5"),
      });

      expect(() => parseAIJson(result.text, "contract")).not.toThrow();
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "grounds an answer with sources",
    async () => {
      const result = await new AnthropicAdapter(anthropicKey()!).generate({
        prompt: SEARCH_PROMPT,
        responseFormat: "text",
        enableSearchGrounding: true,
        model: modelFor("anthropic", "claude-sonnet-5"),
        routing: { prefer: "flash" },
        timeoutMs: 90_000,
      });
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(result.citations?.length).toBeGreaterThan(0);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it("offers only chat models that answer", async () => {
    await expectOfferedModelsAnswer(new AnthropicAdapter(anthropicKey()!), {
      maxOutputTokens: 64,
      routing: { prefer: "flash" },
    });
  }, 180_000);
});

// ─── OpenAI-compatible (Ollama / vLLM / LM Studio / llama.cpp) ────────────────

describe.skipIf(!compatUrl())("OpenAI-compatible endpoint", () => {
  if (!compatUrl())
    announce("OpenAI-compatible", "CONTRACT_COMPAT_URL not set");

  it(
    "lists models",
    async () => {
      const models = await new OpenAICompatibleAdapter({
        baseUrl: compatUrl()!,
      }).listModels();

      expect(models.length).toBeGreaterThan(0);
      // Compat servers return bare ids — never claim more than we know.
      expect(models[0].capabilityConfidence).toBe("guessed");
    },
    CONTRACT_TIMEOUT_MS,
  );

  // Skipped, not passed, without a model: an early return here reported a
  // green test that had asserted nothing.
  it.skipIf(!compatModel())(
    "negotiates structured output down to something that parses",
    async () => {
      // Local servers vary: some honor json_schema, some only json_object, some
      // neither. The adapter walks down the ladder; all that matters here is
      // that the body it finally returns is usable.
      const result = await new OpenAICompatibleAdapter({
        baseUrl: compatUrl()!,
      }).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: compatModel()!,
      });

      expect(() => parseAIJson(result.text, "contract")).not.toThrow();
    },
    CONTRACT_TIMEOUT_MS,
  );
});

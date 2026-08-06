// =============================================================================
// Provider contract tests
// =============================================================================
// One block per provider, each asserting the three things a mocked test cannot:
//
//   1. listModels() speaks the shape we parse
//   2. structured output actually returns parseable JSON matching the schema
//   3. embed() returns one vector per input, at a stable dimension
//
// (2) is the important one. Both real provider bugs found in v1.4.0 were wire
// format mismatches — Anthropic's schema wrapper and Gemini's batch embedding
// shape — and both were invisible to mocked tests.
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
  CONTRACT_TIMEOUT_MS,
  CONTACT_SCHEMA,
  EXTRACTION_PROMPT,
} from "./helpers.ts";
import { parseAIJson } from "../../server/ai/resilience.ts";

/** Assert a generate() result is JSON we can actually use. */
function expectUsableExtraction(text: string) {
  const parsed = parseAIJson<Record<string, unknown>>(text, "contract");
  expect(parsed).toBeTypeOf("object");
  // The model was given an unambiguous name; anything else means the request
  // was malformed rather than the model being creative.
  expect(String(parsed.name)).toMatch(/jane/i);
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

describe.skipIf(!geminiKey())("Gemini", () => {
  if (!geminiKey()) announce("Gemini", "GEMINI_API_KEY not set");

  it(
    "lists models with declared capabilities",
    async () => {
      const { GeminiAdapter } =
        await import("../../server/ai/adapters/gemini.ts");
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
      const { GeminiAdapter } =
        await import("../../server/ai/adapters/gemini.ts");
      const result = await new GeminiAdapter(geminiKey()!).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: modelFor("gemini", "gemini-2.5-flash"),
      });
      expectUsableExtraction(result.text);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "embeds one vector per input, not one per batch",
    async () => {
      // The v1.4.0 bug: `contents: string[]` reads as ONE Content with many
      // parts, so a batch collapsed to a single vector and the rest were
      // dropped. A batch of 3 is enough to catch a regression.
      const { GeminiAdapter } =
        await import("../../server/ai/adapters/gemini.ts");
      const vectors = await new GeminiAdapter(geminiKey()!).embed(
        ["alpha one", "beta two", "gamma three"],
        embedModelFor("gemini", "gemini-embedding-2"),
      );

      expect(vectors).toHaveLength(3);
      expect(vectors[0].length).toBeGreaterThan(0);
      expect(new Set(vectors.map((v) => v.length)).size).toBe(1);
      expect(vectors[0]).not.toEqual(vectors[1]);
    },
    CONTRACT_TIMEOUT_MS,
  );
});

// ─── OpenAI ──────────────────────────────────────────────────────────────────

describe.skipIf(!openaiKey())("OpenAI", () => {
  if (!openaiKey()) announce("OpenAI", "OPENAI_API_KEY not set");

  it(
    "lists models, inferring capability from the id",
    async () => {
      const { OpenAIAdapter } =
        await import("../../server/ai/adapters/openai.ts");
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
      const { OpenAIAdapter } =
        await import("../../server/ai/adapters/openai.ts");
      const result = await new OpenAIAdapter(openaiKey()!).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model: modelFor("openai", "gpt-4o-mini"),
      });
      expectUsableExtraction(result.text);
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "embeds one vector per input",
    async () => {
      const { OpenAIAdapter } =
        await import("../../server/ai/adapters/openai.ts");
      const vectors = await new OpenAIAdapter(openaiKey()!).embed(
        ["alpha one", "beta two", "gamma three"],
        embedModelFor("openai", "text-embedding-3-small"),
      );

      expect(vectors).toHaveLength(3);
      expect(new Set(vectors.map((v) => v.length)).size).toBe(1);
      expect(vectors[0]).not.toEqual(vectors[1]);
    },
    CONTRACT_TIMEOUT_MS,
  );
});

// ─── Anthropic ───────────────────────────────────────────────────────────────

describe.skipIf(!anthropicKey())("Anthropic", () => {
  if (!anthropicKey()) announce("Anthropic", "ANTHROPIC_API_KEY not set");

  it(
    "lists models with declared capabilities",
    async () => {
      const { AnthropicAdapter } =
        await import("../../server/ai/adapters/anthropic.ts");
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
      const { AnthropicAdapter } =
        await import("../../server/ai/adapters/anthropic.ts");
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
    "falls back to prompt-guided JSON on an over-wide schema",
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
      const { AnthropicAdapter } =
        await import("../../server/ai/adapters/anthropic.ts");
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
});

// ─── OpenAI-compatible (Ollama / vLLM / LM Studio / llama.cpp) ────────────────

describe.skipIf(!compatUrl())("OpenAI-compatible endpoint", () => {
  if (!compatUrl())
    announce("OpenAI-compatible", "CONTRACT_COMPAT_URL not set");

  it(
    "lists models",
    async () => {
      const { OpenAICompatibleAdapter } =
        await import("../../server/ai/adapters/openaiCompatible.ts");
      const models = await new OpenAICompatibleAdapter({
        baseUrl: compatUrl()!,
      }).listModels();

      expect(models.length).toBeGreaterThan(0);
      // Compat servers return bare ids — never claim more than we know.
      expect(models[0].capabilityConfidence).toBe("guessed");
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "negotiates structured output down to something that parses",
    async () => {
      // Local servers vary: some honor json_schema, some only json_object, some
      // neither. The adapter walks down the ladder; all that matters here is
      // that the body it finally returns is usable.
      const model = compatModel();
      if (!model) {
        announce("OpenAI-compatible", "CONTRACT_COMPAT_MODEL not set");
        return;
      }
      const { OpenAICompatibleAdapter } =
        await import("../../server/ai/adapters/openaiCompatible.ts");
      const result = await new OpenAICompatibleAdapter({
        baseUrl: compatUrl()!,
      }).generate({
        prompt: EXTRACTION_PROMPT,
        responseFormat: "json",
        jsonSchema: CONTACT_SCHEMA,
        model,
      });

      expect(() => parseAIJson(result.text, "contract")).not.toThrow();
    },
    CONTRACT_TIMEOUT_MS,
  );

  it(
    "never claims search grounding",
    async () => {
      const { OpenAICompatibleAdapter } =
        await import("../../server/ai/adapters/openaiCompatible.ts");
      // No standard grounding API exists in the compat surface, so research
      // must never resolve to one of these.
      expect(
        new OpenAICompatibleAdapter({ baseUrl: compatUrl()! })
          .supportsSearchGrounding,
      ).toBe(false);
    },
    CONTRACT_TIMEOUT_MS,
  );
});

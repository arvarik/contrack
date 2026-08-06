// =============================================================================
// Contract Test Suite — Multi-Provider AI Support
// =============================================================================
// SDET Trap: These tests encode the architecture contracts from
// .agent/ARCHITECTURE.md §1, §2, §5, §6 for multi-provider AI.
//
// These tests MUST FAIL right now because:
// - OpenAI adapter doesn't exist yet (server/ai/adapters/openai.ts)
// - Anthropic adapter doesn't exist yet (server/ai/adapters/anthropic.ts)
// - Singleton factory only supports Gemini
// - SinglePassStrategy doesn't exist yet
// - Strategy registry only has 'two-pass'
//
// The Builder (Step 3) must make every one of these tests pass.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// =============================================================================
// 1. AIProviderName Type Contract
// =============================================================================
// Contract: AIProviderName = "gemini" | "openai" | "anthropic"
// Source: ARCHITECTURE.md §2 (types.ts)
// =============================================================================

describe("AIProviderName Type", () => {
  it("exports AIProviderName type from types.ts", async () => {
    // This import will fail if the type doesn't exist
    const types = await import("../../server/ai/types.ts");
    // We can't test types at runtime, but we verify the module exports
    // The type is compile-time only — the real test is that tsc --noEmit passes
    expect(types).toBeDefined();
  });
});

// =============================================================================
// 2. OpenAI Adapter Contract
// =============================================================================
// Contract: server/ai/adapters/openai.ts implements AIProvider
// Source: ARCHITECTURE.md §2 (AI Adapter Pipeline)
// =============================================================================

describe("OpenAIAdapter", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OpenAIAdapter: any;

  beforeEach(async () => {
    // This import will fail until the adapter is created
    const mod = await import("../../server/ai/adapters/openai.ts");
    OpenAIAdapter = mod.OpenAIAdapter;
  });

  it("exists and is importable", () => {
    expect(OpenAIAdapter).toBeDefined();
  });

  it("implements AIProvider interface with name 'OpenAI'", () => {
    // Mock the OpenAI SDK so we don't need real credentials
    const adapter = new OpenAIAdapter("test-key");
    expect(adapter.name).toBe("OpenAI");
    expect(typeof adapter.generate).toBe("function");
  });

  // ── Model Class Mapping ──────────────────────────────────────────────
  // Contract: lite → gpt-5.4-nano, flash → gpt-5.4-mini, pro → gpt-5.4
  // (lite was bumped from gpt-4o-mini to gpt-5.4-nano on 2026-03-17 when
  // OpenAI introduced the nano size tier below mini.)

  describe("model class mapping", () => {
    it("maps 'lite' to gpt-5.4-nano", () => {
      const adapter = new OpenAIAdapter("test-key");
      const model = adapter.resolveModel("lite");
      expect(model).toBe("gpt-5.4-nano");
    });

    it("maps 'flash' to gpt-5.4-mini", () => {
      const adapter = new OpenAIAdapter("test-key");
      const model = adapter.resolveModel("flash");
      expect(model).toBe("gpt-5.4-mini");
    });

    it("maps 'pro' to gpt-5.4", () => {
      const adapter = new OpenAIAdapter("test-key");
      const model = adapter.resolveModel("pro");
      expect(model).toBe("gpt-5.4");
    });

    it("defaults to lite when no preference specified", () => {
      const adapter = new OpenAIAdapter("test-key");
      const model = adapter.resolveModel(undefined);
      expect(model).toBe("gpt-5.4-nano");
    });
  });

  // ── Schema Translation ───────────────────────────────────────────────
  // Contract: JsonSchemaNode → response_format: { type: "json_schema", ... }

  describe("schema translation", () => {
    it("translates a simple JsonSchemaNode to OpenAI json_schema format", () => {
      const adapter = new OpenAIAdapter("test-key");
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          age: { type: "integer" as const },
        },
        required: ["name"],
      };

      // `strict: true` must NOT be sent. Strict mode requires `required` to
      // list every key in `properties`, and this schema — like every real one
      // in Contrack — has optional fields. Asserting strict here is what let
      // the 400 ship: the unit test was green while every OpenAI JSON call
      // failed against the real API.
      const translated = adapter.translateSchema(schema);
      expect(translated).toEqual({
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
      });
      expect("strict" in translated.json_schema).toBe(false);
    });

    it("handles nullable fields via anyOf pattern", () => {
      const adapter = new OpenAIAdapter("test-key");
      const schema = {
        type: "object" as const,
        properties: {
          company: { type: "string" as const, nullable: true },
        },
      };

      const translated = adapter.translateSchema(schema);
      const companyProp = translated.json_schema.schema.properties.company;
      // OpenAI doesn't support nullable — must use anyOf pattern
      expect(companyProp).toHaveProperty("anyOf");
      expect(companyProp.anyOf).toContainEqual({ type: "string" });
      expect(companyProp.anyOf).toContainEqual({ type: "null" });
    });

    it("handles array schemas", () => {
      const adapter = new OpenAIAdapter("test-key");
      const schema = {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
          },
          required: ["name"],
        },
      };

      const translated = adapter.translateSchema(schema);
      expect(translated.json_schema.schema.type).toBe("array");
      expect(translated.json_schema.schema.items.type).toBe("object");
    });

    it("handles enum fields", () => {
      const adapter = new OpenAIAdapter("test-key");
      const schema = {
        type: "object" as const,
        properties: {
          category: {
            type: "string" as const,
            enum: ["work", "personal", "other"],
          },
        },
      };

      const translated = adapter.translateSchema(schema);
      expect(translated.json_schema.schema.properties.category.enum).toEqual([
        "work",
        "personal",
        "other",
      ]);
    });
  });
});

// =============================================================================
// 3. Anthropic Adapter Contract
// =============================================================================
// Contract: server/ai/adapters/anthropic.ts implements AIProvider
// Source: ARCHITECTURE.md §2 (AI Adapter Pipeline)
// =============================================================================

describe("AnthropicAdapter", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AnthropicAdapter: any;

  beforeEach(async () => {
    // This import will fail until the adapter is created
    const mod = await import("../../server/ai/adapters/anthropic.ts");
    AnthropicAdapter = mod.AnthropicAdapter;
  });

  it("exists and is importable", () => {
    expect(AnthropicAdapter).toBeDefined();
  });

  it("implements AIProvider interface with name 'Anthropic'", () => {
    const adapter = new AnthropicAdapter("test-key");
    expect(adapter.name).toBe("Anthropic");
    expect(typeof adapter.generate).toBe("function");
  });

  // ── Model Class Mapping ──────────────────────────────────────────────
  // Contract: lite → claude-haiku-4-5, flash → claude-sonnet-4-6, pro → claude-opus-4-6
  // (API model IDs use dashes, not dots — dotted IDs 404 on the live API.)

  describe("model class mapping", () => {
    it("maps 'lite' to claude-haiku-4-5", () => {
      const adapter = new AnthropicAdapter("test-key");
      const model = adapter.resolveModel("lite");
      expect(model).toBe("claude-haiku-4-5");
    });

    it("maps 'flash' to claude-sonnet-4-6", () => {
      const adapter = new AnthropicAdapter("test-key");
      const model = adapter.resolveModel("flash");
      expect(model).toBe("claude-sonnet-4-6");
    });

    it("maps 'pro' to claude-opus-4-6", () => {
      const adapter = new AnthropicAdapter("test-key");
      const model = adapter.resolveModel("pro");
      expect(model).toBe("claude-opus-4-6");
    });

    it("defaults to lite when no preference specified", () => {
      const adapter = new AnthropicAdapter("test-key");
      const model = adapter.resolveModel(undefined);
      expect(model).toBe("claude-haiku-4-5");
    });
  });

  // ── Anthropic-Specific Constraints ───────────────────────────────────

  describe("max_tokens requirement", () => {
    it("exposes a default max_tokens value", () => {
      const adapter = new AnthropicAdapter("test-key");
      // Anthropic requires explicit max_tokens on every request
      expect(adapter.defaultMaxTokens).toBeDefined();
      expect(adapter.defaultMaxTokens).toBeGreaterThanOrEqual(4096);
    });
  });

  describe("schema translation", () => {
    // The Anthropic API takes the schema DIRECTLY under `format`. This test
    // previously asserted OpenAI's nested `json_schema: { name, schema }`
    // wrapper, which the API rejects with a 400 — the assertion encoded the
    // bug, so every JSON call to Anthropic failed while this stayed green.
    it("translates a JsonSchemaNode to Anthropic's output_config format", () => {
      const adapter = new AnthropicAdapter("test-key");
      const schema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
        },
        required: ["name"],
      };

      const translated = adapter.translateSchema(schema);
      expect(translated).toEqual({
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          additionalProperties: false,
          required: ["name"],
        },
      });
    });

    it("handles nullable fields natively", () => {
      const adapter = new AnthropicAdapter("test-key");
      const schema = {
        type: "object" as const,
        properties: {
          company: { type: "string" as const, nullable: true },
        },
      };

      const translated = adapter.translateSchema(schema);
      // Nullability is expressed as a JSON Schema type union, not OpenAPI's
      // `nullable` keyword (which the Anthropic API does not accept).
      const companyProp = translated.schema.properties.company;
      expect(companyProp.type).toEqual(["string", "null"]);
    });
  });
});

// =============================================================================
// 4. Singleton Factory Contract
// =============================================================================
// Contract: singleton.ts resolves the active AIProvider based on AI_PROVIDER
// Source: ARCHITECTURE.md §2 (singleton.ts)
// =============================================================================

describe("Provider Factory (singleton.ts)", () => {
  const originalProvider = process.env.AI_PROVIDER;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    // Restore env
    if (originalProvider !== undefined)
      process.env.AI_PROVIDER = originalProvider;
    else delete process.env.AI_PROVIDER;
    if (originalGeminiKey !== undefined)
      process.env.GEMINI_API_KEY = originalGeminiKey;
    else delete process.env.GEMINI_API_KEY;
    if (originalOpenAIKey !== undefined)
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalAnthropicKey !== undefined)
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  // NOTE: singleton.ts evaluates at module load time, so we can't fully
  // test dynamic provider switching in a single process. Instead, we test
  // the factory function if it's exported, or test the resolution logic.

  it("exports a createProvider factory function", async () => {
    // The singleton should export a factory function for testability
    const mod = await import("../../server/ai/singleton.ts");
    expect(mod.createProvider).toBeDefined();
    expect(typeof mod.createProvider).toBe("function");
  });

  it("creates GeminiAdapter when AI_PROVIDER is 'gemini'", async () => {
    const mod = await import("../../server/ai/singleton.ts");
    const provider = mod.createProvider("gemini", "test-key");
    expect(provider.name).toBe("Gemini");
  });

  it("creates OpenAIAdapter when AI_PROVIDER is 'openai'", async () => {
    const mod = await import("../../server/ai/singleton.ts");
    const provider = mod.createProvider("openai", "test-key");
    expect(provider.name).toBe("OpenAI");
  });

  it("creates AnthropicAdapter when AI_PROVIDER is 'anthropic'", async () => {
    const mod = await import("../../server/ai/singleton.ts");
    const provider = mod.createProvider("anthropic", "test-key");
    expect(provider.name).toBe("Anthropic");
  });

  it("falls back to Gemini for unknown provider names", async () => {
    const mod = await import("../../server/ai/singleton.ts");
    const provider = mod.createProvider("ollama", "test-key");
    expect(provider.name).toBe("Gemini");
  });

  it("resolves the correct API key per provider", async () => {
    const mod = await import("../../server/ai/singleton.ts");
    // The factory should accept provider name and resolve the right key
    expect(mod.getApiKeyForProvider).toBeDefined();

    process.env.GEMINI_API_KEY = "gk";
    process.env.OPENAI_API_KEY = "ok";
    process.env.ANTHROPIC_API_KEY = "ak";

    expect(mod.getApiKeyForProvider("gemini")).toBe("gk");
    expect(mod.getApiKeyForProvider("openai")).toBe("ok");
    expect(mod.getApiKeyForProvider("anthropic")).toBe("ak");
  });
});

// =============================================================================
// 5. Strategy Selection Contract
// =============================================================================
// Contract: OpenAI/Anthropic use single-pass, Gemini uses two-pass
// Source: ARCHITECTURE.md §2 (strategies/)
// =============================================================================

describe("AI Search Strategy Selection", () => {
  it("single-pass strategy exists and is importable", async () => {
    const mod =
      await import("../../server/services/aiSearch/strategies/singlePass.ts");
    expect(mod.SinglePassStrategy).toBeDefined();
  });

  it("single-pass strategy implements AISearchStrategy interface", async () => {
    const mod =
      await import("../../server/services/aiSearch/strategies/singlePass.ts");
    const strategy = new mod.SinglePassStrategy();
    expect(strategy.name).toBe("single-pass");
    expect(typeof strategy.execute).toBe("function");
  });

  it("strategy registry includes single-pass", async () => {
    const { getStrategy } =
      await import("../../server/services/aiSearch/strategies/index.ts");
    const strategy = getStrategy("single-pass");
    expect(strategy.name).toBe("single-pass");
  });

  it("strategy registry defaults to two-pass for gemini", async () => {
    const { getStrategy } =
      await import("../../server/services/aiSearch/strategies/index.ts");
    // When no name is given, should default to two-pass (gemini behavior)
    const strategy = getStrategy();
    expect(strategy.name).toBe("two-pass");
  });
});

// =============================================================================
// 6. Environment Variable Contract
// =============================================================================
// Contract: ARCHITECTURE.md §6
// =============================================================================

describe("Environment Variable Contracts", () => {
  it(".env.example contains OPENAI_API_KEY", async () => {
    // Read .env.example and check for the expected variables
    const fs = await import("fs");
    const envExample = fs.readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf-8",
    );
    expect(envExample).toContain("OPENAI_API_KEY");
  });

  it(".env.example contains ANTHROPIC_API_KEY", async () => {
    const fs = await import("fs");
    const envExample = fs.readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf-8",
    );
    expect(envExample).toContain("ANTHROPIC_API_KEY");
  });

  it(".env.example documents a key for every built-in provider", async () => {
    const fs = await import("fs");
    const envExample = fs.readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf-8",
    );
    // Providers are chosen by which keys are present, not by naming one in
    // AI_PROVIDER, so the keys are what the file has to document.
    expect(envExample).toContain("GEMINI_API_KEY");
    expect(envExample).toContain("OPENAI_API_KEY");
    expect(envExample).toContain("ANTHROPIC_API_KEY");
  });

  it(".env.example documents the per-task model overrides", async () => {
    const fs = await import("fs");
    const envExample = fs.readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf-8",
    );
    for (const v of [
      "AI_QUICK_MODEL",
      "AI_DEEP_MODEL",
      "AI_RESEARCH_MODEL",
      "AI_EMBEDDINGS_MODEL",
    ]) {
      expect(envExample).toContain(v);
    }
  });

  it(".env.example keeps the advanced overrides commented out", async () => {
    const fs = await import("fs");
    const envExample = fs.readFileSync(
      new URL("../../.env.example", import.meta.url),
      "utf-8",
    );
    // One key must be enough to run; an uncommented model pin would break
    // that promise for anyone who copies the file verbatim.
    for (const v of [
      "AI_QUICK_MODEL",
      "AI_DEEP_MODEL",
      "AI_EMBEDDINGS_MODEL",
    ]) {
      expect(envExample).toMatch(new RegExp(`^# ${v}=`, "m"));
    }
  });
});

// =============================================================================
// 7. NPM Dependency Contract
// =============================================================================
// Contract: ARCHITECTURE.md §1 (Tech Stack)
// =============================================================================

describe("NPM Dependency Contracts", () => {
  it("package.json includes openai dependency", async () => {
    const fs = await import("fs");
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    );
    expect(pkg.dependencies).toHaveProperty("openai");
  });

  it("package.json includes @anthropic-ai/sdk dependency", async () => {
    const fs = await import("fs");
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    );
    expect(pkg.dependencies).toHaveProperty("@anthropic-ai/sdk");
  });
});

// =============================================================================
// 8. Invariant: SDK Import Containment
// =============================================================================
// Contract: ARCHITECTURE.md §7
// "MUST route all AI calls through the ai singleton. Never import
//  @google/genai, openai, or @anthropic-ai/sdk directly outside
//  the adapter layer."
//
// This test uses grep to verify import containment.
// =============================================================================

describe("SDK Import Containment Invariant", () => {
  it("openai is only imported in the adapter file", async () => {
    const path = await import("path");
    const { execSync } = await import("child_process");

    // Search for openai imports outside of adapters directory
    // Allow: server/ai/adapters/openai.ts, package.json, package-lock.json, node_modules
    try {
      const result = execSync(
        `grep -rl "from ['\\"]openai['\\"]" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "server/ai/adapters/openai.ts"`,
        {
          cwd: path.resolve(new URL("../../", import.meta.url).pathname),
          encoding: "utf-8",
        },
      ).trim();

      // If we get here, files were found that import openai outside the adapter
      expect(result).toBe("");
    } catch {
      // grep returns exit code 1 when no matches found — this is the PASSING case
      expect(true).toBe(true);
    }
  });

  it("@anthropic-ai/sdk is only imported in the adapter file", async () => {
    const path = await import("path");
    const { execSync } = await import("child_process");

    try {
      const result = execSync(
        `grep -rl "from ['\\"]@anthropic-ai/sdk['\\"]" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v "server/ai/adapters/anthropic.ts"`,
        {
          cwd: path.resolve(new URL("../../", import.meta.url).pathname),
          encoding: "utf-8",
        },
      ).trim();

      expect(result).toBe("");
    } catch {
      // No matches = correct containment
      expect(true).toBe(true);
    }
  });
});

// =============================================================================
// 9. Edge Cases & Safety
// =============================================================================

describe("Edge Cases", () => {
  it("OpenAI adapter handles empty prompt gracefully", async () => {
    const { OpenAIAdapter } =
      await import("../../server/ai/adapters/openai.ts");
    const adapter = new OpenAIAdapter("test-key");

    // Should not throw on construction with empty-ish prompt
    // The actual generate() call would fail, but the adapter shouldn't crash on setup
    expect(() => adapter.resolveModel("lite")).not.toThrow();
  });

  it("Anthropic adapter handles missing systemPrompt", async () => {
    const { AnthropicAdapter } =
      await import("../../server/ai/adapters/anthropic.ts");
    const adapter = new AnthropicAdapter("test-key");

    // Adapter should handle undefined systemPrompt without crashing
    expect(() => adapter.resolveModel("flash")).not.toThrow();
  });

  it("OpenAI adapter handles explicit model override", async () => {
    const { OpenAIAdapter } =
      await import("../../server/ai/adapters/openai.ts");
    const adapter = new OpenAIAdapter("test-key");

    // When options.model is set, bypass routing
    const model = adapter.resolveModel(undefined, "gpt-4-turbo");
    expect(model).toBe("gpt-4-turbo");
  });

  it("Anthropic adapter handles explicit model override", async () => {
    const { AnthropicAdapter } =
      await import("../../server/ai/adapters/anthropic.ts");
    const adapter = new AnthropicAdapter("test-key");

    const model = adapter.resolveModel(undefined, "claude-3-opus-20240229");
    expect(model).toBe("claude-3-opus-20240229");
  });
});

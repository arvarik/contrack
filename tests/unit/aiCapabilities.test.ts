// =============================================================================
// Capability-based AI routing — resolution rules
// =============================================================================
// The critical invariant: with a single provider configured and no explicit
// settings, resolution must reproduce the pre-capability behavior exactly
// (fast→lite, smart→flash, research→pro on the AI_PROVIDER provider).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Settings are DB-backed; unit tests drive them through this mock.
const settingsStore = new Map<string, unknown>();
vi.mock("../../server/services/settingsService.ts", () => ({
  getSetting: (key: string) => settingsStore.get(key) ?? null,
  setSetting: (key: string, value: unknown) => settingsStore.set(key, value),
  deleteSetting: (key: string) => settingsStore.delete(key),
  clearSettingsCache: () => {},
  SETTING_KEYS: {
    aiCapabilities: "ai.capabilities",
    aiProviderKeys: "ai.providerKeys",
    aiCustomEndpoints: "ai.customEndpoints",
    aiModelCache: "ai.modelCache",
    aiSearxng: "ai.searxng",
    embeddingsState: "ai.embeddingsState",
  },
}));

const { resolveCapability, capabilityAvailability } =
  await import("../../server/ai/capabilities.ts");
const { getProviderConfigs, invalidateProviderCache } =
  await import("../../server/ai/providerRegistry.ts");

/**
 * Connect a custom endpoint the way saving one in Settings does: the endpoint
 * itself *and* the model catalog discovered from it. Tests that set only the
 * endpoint describe a state the app never reaches, because `PUT /endpoints`
 * refuses to save an endpoint it cannot list models from.
 */
function connectOllama(
  models: Array<{
    id: string;
    label: string;
    capabilities: string[];
    capabilityConfidence: string;
  }> = [
    {
      id: "llama3.2",
      label: "llama3.2",
      capabilities: ["chat"],
      capabilityConfidence: "guessed",
    },
  ],
): void {
  settingsStore.set("ai.customEndpoints", [
    { id: "homelab", label: "Ollama", baseUrl: "http://alpha:11434/v1" },
  ]);
  settingsStore.set("ai.modelCache", {
    "custom:homelab": { models, fetchedAt: new Date().toISOString() },
  });
}

const ENV_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_PROVIDER",
  "AI_QUICK_MODEL",
  "AI_DEEP_MODEL",
  "AI_RESEARCH_MODEL",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  settingsStore.clear();
  invalidateProviderCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  settingsStore.clear();
  invalidateProviderCache();
});

describe("provider registry", () => {
  it("reports no providers when nothing is configured", () => {
    expect(getProviderConfigs()).toEqual([]);
  });

  it("detects env-configured providers", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";
    const ids = getProviderConfigs().map((c) => c.id);
    expect(ids).toContain("gemini");
    expect(ids).toContain("anthropic");
    expect(ids).not.toContain("openai");
  });

  it("ignores the dummy_key sentinel", () => {
    process.env.GEMINI_API_KEY = "dummy_key";
    expect(getProviderConfigs()).toEqual([]);
  });

  it("picks up keys stored via settings, marking their source", () => {
    settingsStore.set("ai.providerKeys", { openai: "stored-key" });
    const configs = getProviderConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("openai");
    expect(configs[0].source).toBe("settings");
  });

  it("prefers env keys over stored keys for the same provider", () => {
    process.env.GEMINI_API_KEY = "env-key";
    settingsStore.set("ai.providerKeys", { gemini: "stored-key" });
    const config = getProviderConfigs().find((c) => c.id === "gemini")!;
    expect(config.apiKey).toBe("env-key");
    expect(config.source).toBe("env");
  });

  it("registers custom OpenAI-compatible endpoints", () => {
    settingsStore.set("ai.customEndpoints", [
      {
        id: "homelab",
        label: "Homelab Ollama",
        baseUrl: "http://alpha:11434/v1",
      },
    ]);
    const configs = getProviderConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("custom:homelab");
    expect(configs[0].kind).toBe("openai-compatible");
  });
});

describe("capability resolution — backward compatibility", () => {
  it("maps capabilities to the historical model classes", () => {
    process.env.GEMINI_API_KEY = "g-key";
    expect(resolveCapability("quick")?.modelClass).toBe("lite");
    expect(resolveCapability("deep")?.modelClass).toBe("flash");
    expect(resolveCapability("research")?.modelClass).toBe("pro");
  });

  it("routes everything to the single configured provider", () => {
    process.env.GEMINI_API_KEY = "g-key";
    for (const cap of ["quick", "deep", "research"] as const) {
      expect(resolveCapability(cap)?.providerId).toBe("gemini");
      // No pinned model → the adapter's own router picks, as before.
      expect(resolveCapability(cap)?.model).toBeUndefined();
    }
  });

  it("honors AI_PROVIDER ahead of the auto preference order", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";
    process.env.AI_PROVIDER = "anthropic";
    expect(resolveCapability("quick")?.providerId).toBe("anthropic");
    expect(resolveCapability("deep")?.providerId).toBe("anthropic");
  });

  it("returns null for every capability when nothing is configured", () => {
    expect(resolveCapability("quick")).toBeNull();
    expect(capabilityAvailability()).toEqual({
      quick: false,
      deep: false,
      research: false,
    });
  });
});

describe("capability resolution — explicit configuration", () => {
  it("uses a pinned provider + model", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";
    settingsStore.set("ai.capabilities", {
      deep: {
        mode: "pinned",
        providerId: "anthropic",
        model: "claude-sonnet-5",
      },
    });
    const resolved = resolveCapability("deep");
    expect(resolved?.providerId).toBe("anthropic");
    expect(resolved?.model).toBe("claude-sonnet-5");
  });

  it("falls back to auto when a pinned provider loses its credentials", () => {
    process.env.GEMINI_API_KEY = "g-key";
    settingsStore.set("ai.capabilities", {
      quick: { mode: "pinned", providerId: "openai", model: "gpt-5.6-luna" },
    });
    expect(resolveCapability("quick")?.providerId).toBe("gemini");
  });

  it("treats a disabled capability as unavailable", () => {
    process.env.GEMINI_API_KEY = "g-key";
    settingsStore.set("ai.capabilities", { research: { mode: "disabled" } });
    expect(resolveCapability("research")).toBeNull();
    expect(resolveCapability("quick")).not.toBeNull();
  });

  it("applies env model overrides (bare model uses the default provider)", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.AI_QUICK_MODEL = "gemini-3.5-flash-lite";
    const resolved = resolveCapability("quick");
    expect(resolved?.providerId).toBe("gemini");
    expect(resolved?.model).toBe("gemini-3.5-flash-lite");
  });

  it("applies env overrides in provider:model form", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.ANTHROPIC_API_KEY = "a-key";
    process.env.AI_DEEP_MODEL = "anthropic:claude-opus-5";
    const resolved = resolveCapability("deep");
    expect(resolved?.providerId).toBe("anthropic");
    expect(resolved?.model).toBe("claude-opus-5");
  });

  it("settings pins beat env overrides", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.AI_QUICK_MODEL = "gemini-2.5-flash-lite";
    settingsStore.set("ai.capabilities", {
      quick: {
        mode: "pinned",
        providerId: "gemini",
        model: "gemini-3.6-flash",
      },
    });
    expect(resolveCapability("quick")?.model).toBe("gemini-3.6-flash");
  });
});

describe("capability resolution — research grounding constraint", () => {
  it("never selects an OpenAI-compatible endpoint for research", () => {
    connectOllama();
    // The compat endpoint can serve chat…
    expect(resolveCapability("quick")?.providerId).toBe("custom:homelab");
    // …but cannot ground research.
    expect(resolveCapability("research")).toBeNull();
  });

  it("prefers a grounding-capable provider for research when both exist", () => {
    process.env.ANTHROPIC_API_KEY = "a-key";
    connectOllama();
    expect(resolveCapability("research")?.providerId).toBe("anthropic");
  });
});

/**
 * An Ollama-only install leaves every capability on "Automatic", so auto mode
 * has to produce a *model*, not just a provider. It previously produced only
 * the provider, and the compat adapter refuses to be called without a model —
 * so a correctly connected endpoint failed every AI request.
 */
describe("capability resolution — OpenAI-compatible endpoints in auto mode", () => {
  it("names a discovered chat model instead of leaving the model unset", () => {
    connectOllama();
    const resolved = resolveCapability("quick");
    expect(resolved?.providerId).toBe("custom:homelab");
    expect(resolved?.model).toBe("llama3.2");
  });

  it("never picks an embedding-only model for a chat capability", () => {
    connectOllama([
      {
        id: "nomic-embed-text",
        label: "nomic-embed-text",
        capabilities: ["embeddings"],
        capabilityConfidence: "guessed",
      },
      {
        id: "qwen3:8b",
        label: "qwen3:8b",
        capabilities: ["chat"],
        capabilityConfidence: "guessed",
      },
    ]);
    expect(resolveCapability("deep")?.model).toBe("qwen3:8b");
  });

  it("resolves the same model on every call", () => {
    connectOllama([
      {
        id: "llama3.2",
        label: "llama3.2",
        capabilities: ["chat"],
        capabilityConfidence: "guessed",
      },
      {
        id: "qwen3:8b",
        label: "qwen3:8b",
        capabilities: ["chat"],
        capabilityConfidence: "guessed",
      },
    ]);
    expect(resolveCapability("quick")?.model).toBe(
      resolveCapability("quick")?.model,
    );
    // Quick and deep share the model: nothing in a compat catalog ranks them.
    expect(resolveCapability("deep")?.model).toBe(
      resolveCapability("quick")?.model,
    );
  });

  it("reports the capability unavailable when no chat model was discovered", () => {
    // Endpoint saved while unreachable: the catalog is empty, so there is no
    // model to call. Failing here beats calling the adapter with no model.
    connectOllama([]);
    expect(resolveCapability("quick")).toBeNull();
    expect(capabilityAvailability()).toEqual({
      quick: false,
      deep: false,
      research: false,
    });
  });

  it("falls through to a native provider when the endpoint has no models", () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.AI_PROVIDER = "custom:homelab";
    connectOllama([]);
    expect(resolveCapability("quick")?.providerId).toBe("gemini");
  });

  it("still honors an explicit pin, which carries its own model", () => {
    connectOllama();
    settingsStore.set("ai.capabilities", {
      deep: {
        mode: "pinned",
        providerId: "custom:homelab",
        model: "qwen3:32b",
      },
    });
    expect(resolveCapability("deep")?.model).toBe("qwen3:32b");
  });
});

describe("embeddings capability", () => {
  it("defaults to the built-in local model with no configuration", async () => {
    const { resolveEmbeddings } = await import("../../server/ai/embeddings.ts");
    const resolved = resolveEmbeddings();
    expect(resolved.kind).toBe("builtin");
    // The built-in model is the whole point of local-first: no key, offline.
    expect(resolved.dimension).toBe(384);
  });

  it("honors AI_EMBEDDINGS_MODEL, matching the other capabilities", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.AI_EMBEDDINGS_MODEL = "gemini:gemini-embedding-2";
    const { resolveEmbeddings } = await import("../../server/ai/embeddings.ts");
    const resolved = resolveEmbeddings();
    expect(resolved.kind).toBe("provider");
    expect(resolved.providerId).toBe("gemini");
    expect(resolved.model).toBe("gemini-embedding-2");
    delete process.env.AI_EMBEDDINGS_MODEL;
  });

  it("lets a Settings pin beat the env override", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.AI_EMBEDDINGS_MODEL = "gemini:gemini-embedding-001";
    settingsStore.set("ai.capabilities", {
      embeddings: {
        mode: "pinned",
        providerId: "gemini",
        model: "gemini-embedding-2",
      },
    });
    const { resolveEmbeddings } = await import("../../server/ai/embeddings.ts");
    expect(resolveEmbeddings().model).toBe("gemini-embedding-2");
    delete process.env.AI_EMBEDDINGS_MODEL;
  });
});

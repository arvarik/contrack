import { describe, it, expect } from "vitest";
import {
  isChatModel,
  isWithinRecencyWindow,
  dedupeAliases,
  baseAliasOf,
  applyCatalogGuardrails,
  inferModelFamily,
  extractGeneration,
  isPreviewVariant,
  keepLatestPerFamily,
  familyToModelClass,
  getLatestModelForClass,
  prettyModelName,
  RECENCY_WINDOW_MS,
} from "../../server/ai/modelFilter.ts";

const NOW = Date.parse("2026-08-16T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("modality guardrails (isChatModel)", () => {
  it("keeps chat and reasoning models", () => {
    const chatModels = [
      "gpt-5.1",
      "gpt-5.1-mini",
      "o4-mini",
      "chatgpt-4o-latest",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "gemini-3.8-flash",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "llama3.2:3b",
      "qwen2.5-coder",
    ];
    for (const id of chatModels) {
      expect(isChatModel(id), id).toBe(true);
    }
  });

  it("drops embedding models", () => {
    expect(isChatModel("text-embedding-3-large")).toBe(false);
    expect(isChatModel("gemini-embedding-001")).toBe(false);
    expect(isChatModel("gemini-embedding-2")).toBe(false);
    expect(isChatModel("nomic-embed-text")).toBe(false);
  });

  it("drops audio, transcription, and speech models", () => {
    expect(isChatModel("whisper-1")).toBe(false);
    expect(isChatModel("gpt-4o-transcribe")).toBe(false);
    expect(isChatModel("gpt-4o-mini-tts")).toBe(false);
    expect(isChatModel("gpt-4o-audio-preview")).toBe(false);
    expect(isChatModel("gpt-4o-realtime-preview")).toBe(false);
    expect(isChatModel("gemini-2.5-flash-preview-tts")).toBe(false);
    expect(isChatModel("gemini-3.5-transcribe")).toBe(false);
  });

  it("drops image and video generation models", () => {
    expect(isChatModel("dall-e-3")).toBe(false);
    expect(isChatModel("gpt-image-1")).toBe(false);
    expect(isChatModel("imagen-4.0-generate-001")).toBe(false);
    expect(isChatModel("veo-3.1-generate-preview")).toBe(false);
    expect(isChatModel("gemini-2.5-flash-image")).toBe(false);
    expect(isChatModel("nano-banana-pro-preview")).toBe(false);
  });

  it("drops moderation and legacy completion models", () => {
    expect(isChatModel("omni-moderation-latest")).toBe(false);
    expect(isChatModel("text-moderation-007")).toBe(false);
    expect(isChatModel("babbage-002")).toBe(false);
    expect(isChatModel("davinci-002")).toBe(false);
    expect(isChatModel("gpt-3.5-turbo-instruct")).toBe(false);
  });

  it("drops robotics, deep-research, and internal preview models", () => {
    expect(isChatModel("gemini-robotics-er-2-preview")).toBe(false);
    expect(isChatModel("deep-research-pro-preview-12-2025")).toBe(false);
    expect(isChatModel("deep-research-max-preview-04-2026")).toBe(false);
    expect(isChatModel("antigravity-preview-05-2026")).toBe(false);
    expect(isChatModel("lyria-3.5")).toBe(false);
  });

  it("handles empty input", () => {
    expect(isChatModel("")).toBe(false);
    expect(isChatModel(undefined)).toBe(false);
    expect(isChatModel(null)).toBe(false);
  });
});

describe("recency guardrail (isWithinRecencyWindow)", () => {
  it("keeps models released within the last year", () => {
    expect(isWithinRecencyWindow(NOW - 30 * DAY, NOW)).toBe(true);
    expect(isWithinRecencyWindow(NOW - 364 * DAY, NOW)).toBe(true);
  });

  it("drops models released over a year ago", () => {
    expect(isWithinRecencyWindow(NOW - 366 * DAY, NOW)).toBe(false);
    expect(isWithinRecencyWindow(NOW - 3 * 365 * DAY, NOW)).toBe(false);
  });

  it("keeps the exact boundary", () => {
    expect(isWithinRecencyWindow(NOW - RECENCY_WINDOW_MS, NOW)).toBe(true);
  });

  it("keeps models without a release timestamp", () => {
    expect(isWithinRecencyWindow(null, NOW)).toBe(true);
    expect(isWithinRecencyWindow(undefined, NOW)).toBe(true);
  });
});

describe("alias dedupe (dedupeAliases / baseAliasOf)", () => {
  it("strips snapshot suffixes", () => {
    expect(baseAliasOf("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(baseAliasOf("claude-3-5-haiku-20241022")).toBe("claude-3-5-haiku");
    expect(baseAliasOf("gpt-4-0613")).toBe("gpt-4");
    expect(baseAliasOf("gpt-5.1")).toBe("gpt-5.1");
  });

  it("drops pinned snapshots when the floating alias exists", () => {
    const result = dedupeAliases([
      { id: "gpt-4o" },
      { id: "gpt-4o-2024-08-06" },
      { id: "gpt-4o-2024-11-20" },
      { id: "o4-mini" },
    ]);
    expect(result.map((m) => m.id)).toEqual(["gpt-4o", "o4-mini"]);
  });

  it("keeps a snapshot when no floating alias exists", () => {
    const result = dedupeAliases([{ id: "claude-sonnet-4-6-20251001" }]);
    expect(result.map((m) => m.id)).toEqual(["claude-sonnet-4-6-20251001"]);
  });

  it("collapses exact duplicate IDs", () => {
    const result = dedupeAliases([{ id: "gpt-5.1" }, { id: "gpt-5.1" }]);
    expect(result).toHaveLength(1);
  });
});

describe("applyCatalogGuardrails (all passes combined)", () => {
  it("filters modality, recency, and aliases in one pass", () => {
    const raw = [
      { id: "gpt-5.1", releasedAt: NOW - 10 * DAY },
      { id: "gpt-5.1-2026-08-01", releasedAt: NOW - 15 * DAY },
      { id: "gpt-4-0613", releasedAt: NOW - 3 * 365 * DAY },
      { id: "text-embedding-3-large", releasedAt: NOW - 5 * DAY },
      { id: "whisper-1", releasedAt: NOW - 5 * DAY },
      { id: "gemini-3.8-flash", releasedAt: null },
    ];
    const result = applyCatalogGuardrails(raw, NOW);
    expect(result.map((m) => m.id)).toEqual(["gpt-5.1", "gemini-3.8-flash"]);
  });

  it("preserves embedding models if capabilities declares embeddings", () => {
    const raw = [
      {
        id: "gemini-embedding-2",
        capabilities: ["embeddings"],
        releasedAt: null,
      },
      {
        id: "nano-banana-pro-preview",
        capabilities: ["chat"],
        releasedAt: null,
      },
      { id: "gemini-3.8-flash", capabilities: ["chat"], releasedAt: null },
    ];
    const result = applyCatalogGuardrails(raw, NOW);
    expect(result.map((m) => m.id)).toEqual([
      "gemini-embedding-2",
      "gemini-3.8-flash",
    ]);
  });
});

describe("family inference", () => {
  it("classifies Gemini families", () => {
    expect(inferModelFamily("gemini", "gemini-3.8-flash")).toBe("Flash");
    expect(inferModelFamily("gemini", "gemini-3.5-flash")).toBe("Flash");
    expect(inferModelFamily("gemini", "gemini-3.1-pro")).toBe("Pro");
    expect(inferModelFamily("gemini", "gemini-3.5-flash-lite")).toBe(
      "Flash-Lite",
    );
  });

  it("classifies Claude families", () => {
    expect(inferModelFamily("claude", "claude-sonnet-4-6")).toBe("Sonnet");
    expect(inferModelFamily("claude", "claude-haiku-4-5")).toBe("Haiku");
    expect(inferModelFamily("claude", "claude-opus-4-8")).toBe("Opus");
  });

  it("classifies OpenAI families including GPT-5.6 tier names", () => {
    expect(inferModelFamily("openai", "gpt-5.6-sol")).toBe("Flagship");
    expect(inferModelFamily("openai", "gpt-5.6-terra")).toBe("Balanced");
    expect(inferModelFamily("openai", "gpt-5.6-luna")).toBe("Fast");
    expect(inferModelFamily("openai", "gpt-5.2")).toBe("Flagship");
    expect(inferModelFamily("openai", "gpt-5.2-mini")).toBe("Mini");
    expect(inferModelFamily("openai", "gpt-5.2-nano")).toBe("Nano");
    expect(inferModelFamily("openai", "o3")).toBe("Reasoning");
  });
});

describe("generation extraction (extractGeneration)", () => {
  it("reads dotted and dashed version numbers", () => {
    expect(extractGeneration("gemini-3.8-flash")).toBe(3.8);
    expect(extractGeneration("gemini-3.6-flash")).toBe(3.6);
    expect(extractGeneration("gemini-3.5-flash-lite")).toBe(3.5);
    expect(extractGeneration("gpt-5.6-sol")).toBe(5.6);
    expect(extractGeneration("claude-opus-4-8")).toBe(4.8);
    expect(extractGeneration("claude-opus-5")).toBe(5);
    expect(extractGeneration("claude-haiku-4-5")).toBe(4.5);
    expect(extractGeneration("o4-mini")).toBe(4);
  });

  it("ignores snapshot date suffixes", () => {
    expect(extractGeneration("claude-opus-4-5-20251101")).toBe(4.5);
  });

  it("returns null when no version exists", () => {
    expect(extractGeneration("gemini-flash-latest")).toBe(null);
    expect(extractGeneration("")).toBe(null);
  });
});

describe("latest-per-family reduction (keepLatestPerFamily)", () => {
  it("keeps newest generation of each Gemini family including gemini-3.8-flash", () => {
    const raw = [
      { id: "gemini-2.5-flash" },
      { id: "gemini-3.5-flash" },
      { id: "gemini-3.6-flash" },
      { id: "gemini-3.8-flash" },
      { id: "gemini-flash-latest" },
      { id: "gemini-2.5-pro" },
      { id: "gemini-3.1-pro" },
      { id: "gemini-pro-latest" },
      { id: "gemini-2.5-flash-lite" },
      { id: "gemini-3.5-flash-lite" },
      { id: "gemini-flash-lite-latest" },
    ];
    const result = keepLatestPerFamily("gemini", raw).map((m) => m.id);
    expect(result).toEqual([
      "gemini-3.1-pro",
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite",
    ]);
  });

  it("resolves model class to newest generation model", () => {
    const raw = [
      { id: "gemini-2.5-flash" },
      { id: "gemini-3.6-flash" },
      { id: "gemini-3.8-flash" },
      { id: "gemini-2.5-flash-lite" },
      { id: "gemini-3.5-flash-lite" },
      { id: "gemini-3.1-pro-preview" },
    ];
    expect(getLatestModelForClass("gemini", "flash", raw)).toBe(
      "gemini-3.8-flash",
    );
    expect(getLatestModelForClass("gemini", "lite", raw)).toBe(
      "gemini-3.5-flash-lite",
    );
    expect(getLatestModelForClass("gemini", "pro", raw)).toBe(
      "gemini-3.1-pro-preview",
    );
  });
});

describe("preview variant detection (isPreviewVariant)", () => {
  it("flags preview, experimental, and latest aliases", () => {
    expect(isPreviewVariant("gemini-3.6-flash-preview-06-17")).toBe(true);
    expect(isPreviewVariant("gemini-exp-1206")).toBe(true);
    expect(isPreviewVariant("gemini-flash-latest")).toBe(true);
    expect(isPreviewVariant("chatgpt-4o-latest")).toBe(true);
  });

  it("passes stable releases", () => {
    expect(isPreviewVariant("gemini-3.8-flash")).toBe(false);
    expect(isPreviewVariant("claude-opus-5")).toBe(false);
    expect(isPreviewVariant("gpt-5.6-sol")).toBe(false);
  });
});

describe("family to model class mapping", () => {
  it("maps Gemini families correctly", () => {
    expect(familyToModelClass("gemini", "Flash-Lite")).toBe("lite");
    expect(familyToModelClass("gemini", "Flash")).toBe("flash");
    expect(familyToModelClass("gemini", "Pro")).toBe("pro");
  });

  it("maps Anthropic and OpenAI families correctly", () => {
    expect(familyToModelClass("anthropic", "Haiku")).toBe("lite");
    expect(familyToModelClass("anthropic", "Sonnet")).toBe("flash");
    expect(familyToModelClass("anthropic", "Opus")).toBe("pro");
    expect(familyToModelClass("openai", "Nano")).toBe("lite");
    expect(familyToModelClass("openai", "Mini")).toBe("flash");
    expect(familyToModelClass("openai", "Flagship")).toBe("pro");
  });

  it("returns null for unknown family", () => {
    expect(familyToModelClass("gemini", null)).toBe(null);
  });
});

describe("prettyModelName", () => {
  it("formats model names cleanly", () => {
    expect(prettyModelName("models/gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(prettyModelName("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
    expect(prettyModelName("")).toBe("");
  });
});

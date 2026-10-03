// =============================================================================
// Unit: what each AI feature uses, and whether it works now
// =============================================================================
// One table maps the models, chosen by role, to the features people know.
// The "What each feature uses" list, its read-only copy on Privacy and AI,
// and each model's "Used by" line all read it, so they never disagree.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { AISettings } from "../../../../src/api/aiSettings";
import {
  AI_FEATURES,
  engineThatRuns,
  featureParts,
  featureStatus,
  featuresUsing,
} from "../../../../src/lib/aiFeatures";
import type {
  EngineNeed,
  WebSearchEngine,
} from "../../../../shared/webSearchEngine";

const feature = (id: string) => AI_FEATURES.find((f) => f.id === id)!;

/** A model served by Gemini. */
const served = { providerId: "gemini", providerLabel: "Google Gemini" };

/** The settings view: what is served, the engines that can run, and the switches. */
function settings({
  fast = true,
  strong = true,
  research = true,
  allowed = true,
  engine = "provider" as WebSearchEngine,
  missing = {} as Partial<Record<WebSearchEngine, EngineNeed[]>>,
  searxng = false,
  aiOff = false,
} = {}): AISettings {
  const state = (name: WebSearchEngine) => {
    const lacks = [
      ...(allowed ? [] : (["off"] as EngineNeed[])),
      ...(missing[name] ?? []),
    ];
    return { available: lacks.length === 0, missing: lacks };
  };
  return {
    providers: [{ id: "gemini" }],
    capabilities: {
      quick: { resolved: fast ? served : null },
      deep: { resolved: strong ? served : null },
      research: { resolved: research ? served : null },
      embeddings: {
        resolved: { providerId: "builtin", providerLabel: "Built-in" },
      },
    },
    webSearch: {
      allowed,
      engine,
      engines: {
        provider: state("provider"),
        searxng: state("searxng"),
        combined: state("combined"),
      },
      searxng: { configured: searxng, source: searxng ? "setting" : "none" },
    },
    reranker: { model: "Xenova/ms-marco-TinyBERT-L-2-v2", source: "default" },
    multipleAccounts: false,
    instance: { aiOff, lockedByEnv: false },
  } as unknown as AISettings;
}

describe("the feature table", () => {
  it("says which features each model serves", () => {
    expect(featuresUsing("fast")).toEqual([
      "Ask Contrack",
      "Contact research",
      "Briefings and insights",
      "Add from text and notes",
      "Email summaries",
    ]);
    expect(featuresUsing("strong")).toEqual([
      "Contact research",
      "Duplicates",
      "Email summaries",
    ]);
    expect(featuresUsing("embedding")).toEqual(["Ask Contrack", "Duplicates"]);
    expect(featuresUsing("webSearch")).toEqual(["Contact research"]);
  });

  it("shows research's Strong model only when SearXNG reads pages", () => {
    const roles = (engine: WebSearchEngine) =>
      featureParts(feature("research"), settings({ engine })).map(
        (part) => part.role,
      );
    expect(roles("provider")).toEqual(["webSearch", "fast"]);
    expect(roles("searxng")).toEqual(["webSearch", "strong", "fast"]);
  });

  it("names what runs each part", () => {
    const parts = featureParts(feature("ask"), settings({ fast: false })).map(
      (part) => `${part.name}: ${part.runs}`,
    );
    expect(parts).toEqual([
      "Embedding model: Built-in",
      "Reranker: Built-in",
      "Fast model: Not set",
    ]);
    expect(
      featureParts(feature("research"), settings({ engine: "combined" }))[0]
        .runs,
    ).toBe("Google Gemini and SearXNG");
  });
});

describe("whether a feature works now", () => {
  it("is ready with every model served", () => {
    for (const each of AI_FEATURES)
      expect(featureStatus(each, settings()).state, each.id).toBe("ready");
  });

  it("keeps the local parts while AI is off, and links the switch for an admin", () => {
    const off = settings({ aiOff: true });
    expect(featureStatus(feature("ask"), off)).toEqual({
      state: "limited",
      reason: "Local search only. AI is off on this instance",
      fix: { label: "Turn AI on", anchor: "ai-instance" },
    });
    expect(featureStatus(feature("duplicates"), off).reason).toBe(
      "Exact scan only. AI is off on this instance",
    );
    expect(featureStatus(feature("briefings"), off).state).toBe("off");
    // An account's own switch is on its own page: no link.
    const account = featureStatus(feature("briefings"), settings(), {
      accountAiOn: false,
    });
    expect(account).toEqual({
      state: "off",
      reason: "AI is off for your account",
      fix: undefined,
    });
  });

  it("names the model a feature lacks, and the row that sets it", () => {
    expect(
      featureStatus(feature("briefings"), settings({ fast: false })),
    ).toEqual({
      state: "setup",
      reason: "Needs a Fast model",
      fix: { label: "Choose a Fast model", anchor: "fast-model" },
    });
    expect(
      featureStatus(feature("duplicates"), settings({ strong: false })).state,
    ).toBe("limited");
    expect(
      featureStatus(feature("mail"), settings({ strong: false })).reason,
    ).toBe("Email files need a Strong model");
  });

  it("says research is off while web search is", () => {
    expect(
      featureStatus(feature("research"), settings({ allowed: false })),
    ).toEqual({
      state: "off",
      reason: "Web search is off",
      fix: { label: "Turn web search on", anchor: "allow-web-search" },
    });
  });

  it("says which engine research gives way to, and what the chosen one lacks", () => {
    const status = featureStatus(
      feature("research"),
      settings({
        missing: { searxng: ["web-search"], combined: ["web-search"] },
      }),
      { engineChoice: "searxng" },
    );
    expect(status).toEqual({
      state: "limited",
      reason:
        "SearXNG needs a SearXNG address, so research searches with Google Gemini",
      fix: { label: "Add a SearXNG address", anchor: "searxng" },
    });
  });

  it("names a SearXNG stack's own need when no engine can run", () => {
    const status = featureStatus(
      feature("research"),
      settings({
        research: false,
        searxng: true,
        missing: {
          provider: ["research", "quick"],
          searxng: ["deep"],
          combined: ["research", "deep", "quick"],
        },
      }),
    );
    expect(status).toEqual({
      state: "setup",
      reason: "Needs a Strong model",
      fix: { label: "Choose a Strong model", anchor: "strong-model" },
    });
  });
});

describe("the engine a start runs", () => {
  it("is the chosen one, else the first that can run, else none", () => {
    const some = settings({
      missing: { searxng: ["deep"], combined: ["deep"] },
    });
    expect(engineThatRuns(some, "provider")).toBe("provider");
    expect(engineThatRuns(some, "searxng")).toBe("provider");
    const none = settings({
      missing: {
        provider: ["research"],
        searxng: ["deep"],
        combined: ["research"],
      },
    });
    expect(engineThatRuns(none, "combined")).toBeNull();
  });
});

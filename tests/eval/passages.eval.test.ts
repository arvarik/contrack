// Replay real MiniLM vectors and Gemini responses through the real passage index.
// Refresh with: node scripts/benchmark-passages.ts --contacts 100 --record
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  passageCases,
  passageNegatives,
} from "../fixtures/passage-eval/cases.ts";
import { seedPassageCorpus } from "../fixtures/passage-eval/seed.ts";
import { identifyAnswerCall } from "../../scripts/answer-eval/recording.ts";
import type { RecordedResponses } from "./answer-harness.ts";
import { splitVectors } from "./seeding.ts";

const replay = vi.hoisted(() => ({
  vectors: new Map<string, number[]>(),
  responses: {} as RecordedResponses,
  missing: [] as string[],
}));
vi.mock("../../server/ai/embeddings.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/embeddings.ts")>()),
  resolveEmbeddings: () => ({
    kind: "provider",
    providerId: "fixture",
    model: "minilm",
    dimension: 384,
    signature: "fixture/minilm",
  }),
  embedWithProvider: async (
    _provider: string,
    _model: string,
    texts: string[],
  ) =>
    texts.map((text) => {
      const vector = replay.vectors.get(text);
      if (!vector) {
        replay.missing.push(text);
        throw new Error(`Missing recorded vector: ${text}`);
      }
      return vector;
    }),
}));
vi.mock("../../server/ai/capabilities.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/capabilities.ts")>()),
  resolveCapability: () => ({
    providerId: "fixture",
    model: "gemini-recorded",
    modelClass: "lite",
    provider: {},
  }),
}));
vi.mock("../../server/ai/services/shared.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/services/shared.ts")>()),
  isMockMode: () => false,
}));
vi.mock("../../server/ai/gateway.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/gateway.ts")>()),
  generateFor: async (
    _capability: string,
    options: { prompt?: string; systemPrompt?: string },
  ) => {
    const call = identifyAnswerCall(options);
    const text = call
      ? replay.responses[call.operation]?.[call.queryKey]
      : undefined;
    if (text === undefined) {
      replay.missing.push(call?.queryKey ?? "Unknown model call");
      throw new Error("Missing recorded model response");
    }
    return { text, model: "gemini-recorded", latencyMs: 1 };
  },
}));

import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { backfillSearchEmbeddings } from "../../server/services/search/vectorIndex.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { searchService } from "../../server/services/searchService.ts";
import { aiCache, invalidateSearchCache } from "../../server/utils/aiCache.ts";
import { currentPassage } from "../../server/services/search/passages.ts";

const scope = scopeForOwnerId(ensureLocalOwner());
beforeAll(async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../fixtures/passage-eval/vectors.json", import.meta.url),
      "utf8",
    ),
  ) as { dimension: number; model: string; inputs: string[] };
  const bytes = readFileSync(
    new URL("../fixtures/passage-eval/vectors.bin", import.meta.url),
  );
  expect(manifest.dimension).toBe(384);
  expect(manifest.model).toBe("builtin/Xenova/all-MiniLM-L6-v2");
  expect(bytes.length).toBe(manifest.inputs.length * 384 * 4);
  splitVectors(bytes, manifest.inputs.length, 384).forEach((vector, i) =>
    replay.vectors.set(manifest.inputs[i], Array.from(vector)),
  );
  replay.responses = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/passage-eval/recorded-responses.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  seedPassageCorpus(sqlite, scope.ownerId, 100);
  expect(await backfillSearchEmbeddings()).toBe(100);
});

// Each question must reach the pipeline, not an answer cached from the last.
beforeEach(() => {
  aiCache.invalidateAll();
  invalidateSearchCache();
});

describe("passage answer quality gate", () => {
  it.each(passageCases)("finds the late $field fact for $id", async (item) => {
    const result = await searchService.semanticSearch(
      scope,
      item.query,
      "passage-eval",
    );
    expect(replay.missing).toEqual([]);
    expect(result.fallback).toBe(false);
    expect(result.matches.map((contact) => contact.id)).toEqual([item.id]);
    const evidence = result.matches[0].aiEvidence as {
      contactId: string;
      passageId: string;
      quote: string;
    };
    expect(evidence.contactId).toBe(item.id);
    expect(
      currentPassage(scope, item.id, evidence.passageId, evidence.quote),
    ).not.toBeNull();
  });
  it.each(passageNegatives)(
    "returns no unsupported answer for %s",
    async (query) => {
      const result = await searchService.semanticSearch(
        scope,
        query,
        "passage-eval",
      );
      expect(replay.missing).toEqual([]);
      expect(result.fallback).toBe(false);
      expect(result.matches).toEqual([]);
    },
  );
});

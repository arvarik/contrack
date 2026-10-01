// =============================================================================
// Integration Tests — the embedder and reranker ports
// =============================================================================
// Search and dedupe reach a model only through `currentEmbedder()` and
// `currentReranker()`. A recording embedder stands in for the model here, so
// the test sees what each real caller asks for: the search index and the
// duplicate index embed documents, through the same port, and Ask embeds the
// question. A model that is not local never reads the question of an account
// with AI off, whether it embeds it or reranks for it.
// =============================================================================

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { searchService } from "../../server/services/searchService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import { resolveEmbeddings } from "../../server/ai/embeddings.ts";
import {
  builtinEmbedder,
  currentEmbedder,
  setEmbedder,
  type Embedder,
  type EmbedUse,
} from "../../server/ai/embedder.ts";
import { setReranker, type Reranker } from "../../server/ai/reranker.ts";
import { backfillSearchEmbeddings } from "../../server/services/search/localEmbeddings.ts";
import {
  backfillEmbeddings,
  rebuildDedupeEmbeddingTable,
} from "../../server/services/dedupe/embeddings.ts";

/** A question, the only kind the rerank stage reads. */
const QUESTION = "who are the startup founders in Berlin";
const calls: { use: EmbedUse; texts: string[] }[] = [];
/** What the two backfills asked for. */
let indexed: typeof calls = [];

/** An embedder that records calls, as wide as a new database's stores. */
const recording = (local: boolean): Embedder => ({
  id: local ? "test/local" : "test/hosted",
  local,
  ready: () => true,
  async embed(texts, use) {
    calls.push({ use, texts });
    return texts.map((text) => {
      const vector = new Float32Array(384);
      vector[text.length % 384] = 1;
      return vector;
    });
  },
});

const scope = () => scopeForOwnerId(ensureLocalOwner());
/** One search, never answered from a cache: the key holds no AI switch. */
const ask = (aiAllowed: boolean) => {
  aiCache.invalidateAll();
  return searchService.semanticSearch(scope(), QUESTION, "ports", undefined, {
    aiAllowed,
  });
};

beforeAll(async () => {
  await contactService.bulkCreateContacts(scope(), [
    {
      name: "Ada Okafor",
      role: "Founder",
      location: "Berlin, Germany",
      about: "Started two companies and mentors first-time founders.",
    },
    { name: "Bea Marsh", role: "Founder", location: "Berlin, Germany" },
  ]);
  setEmbedder(recording(true));
  expect(await backfillSearchEmbeddings()).toBe(2);
  rebuildDedupeEmbeddingTable(384);
  expect(await backfillEmbeddings()).toBe(2);
  indexed = calls.splice(0);
  setEmbedder(null);
});

afterEach(() => {
  setEmbedder(null);
  setReranker(null);
  calls.length = 0;
});

describe("the embedder", () => {
  it("names the built-in model by the signature the stores were built with", () => {
    expect(currentEmbedder()).toBe(builtinEmbedder);
    expect(builtinEmbedder.id).toBe(resolveEmbeddings().signature);
  });

  it("embeds documents for both indexes", () => {
    expect(indexed.map((call) => call.use)).not.toContain("query");
    const texts = indexed.flatMap((call) => call.texts);
    // Ada's text once per index, and her about passage.
    expect(texts.filter((text) => text.includes("Ada Okafor"))).toHaveLength(2);
    expect(texts.some((text) => text.includes("mentors first-time"))).toBe(
      true,
    );
  });

  it("embeds the question locally, and with a provider only where AI is allowed", async () => {
    setEmbedder(recording(true));
    await ask(false);
    expect(calls).toEqual([{ use: "query", texts: [QUESTION] }]);

    calls.length = 0;
    setEmbedder(recording(false));
    await ask(false);
    expect(calls).toEqual([]);
    await ask(true);
    expect(calls).toEqual([{ use: "query", texts: [QUESTION] }]);
  });
});

describe("the reranker", () => {
  it("reads the question of an account with AI off only when it is local", async () => {
    setEmbedder(recording(true));
    const asked: string[] = [];
    const reranker = (local: boolean): Reranker => ({
      id: local ? "test/local" : "test/hosted",
      local,
      ready: () => true,
      async score(query, docs) {
        asked.push(query);
        return docs.map((_, index) => -index);
      },
    });
    setReranker(reranker(false));
    await ask(false);
    // The search ran and embedded the question, with no reranker.
    expect(calls).toEqual([{ use: "query", texts: [QUESTION] }]);
    expect(asked).toEqual([]);
    await ask(true);
    expect(asked).toEqual([QUESTION]);

    asked.length = 0;
    setReranker(reranker(true));
    await ask(false);
    expect(asked).toEqual([QUESTION]);
  });
});

// =============================================================================
// Integration Tests — the embedder and reranker ports
// =============================================================================
// Search and dedupe reach a model only through `currentEmbedder()` and
// `currentReranker()`. A recording embedder stands in for the model here, so
// the test sees what each real caller asks for: the search index and the
// duplicate index embed documents, through the same port, and Ask embeds the
// question. A model that is not local never reads the question of an account
// with AI off, whether it embeds it or reranks for it, and a model pinned
// during a backfill reads nothing of the round already under way. The stores
// rebuild for an embedder with a new id.
// =============================================================================

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { searchService } from "../../server/services/searchService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import {
  getEmbeddingsState,
  resolveEmbeddings,
  setEmbeddingsState,
} from "../../server/ai/embeddings.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import {
  builtinEmbedder,
  currentEmbedder,
  setEmbedder,
  type Embedder,
  type EmbedUse,
} from "../../server/ai/embedder.ts";
import { setReranker, type Reranker } from "../../server/ai/reranker.ts";
import {
  backfillSearchEmbeddings,
  embedContact,
  ensureEmbeddingStore,
} from "../../server/services/search/vectorIndex.ts";
import {
  backfillEmbeddings,
  backfillOwnerEmbeddings,
  ensureDedupeEmbeddingStore,
  generateAndStoreBulkEmbeddings,
  generateAndStoreEmbedding,
  generateBatchEmbeddings,
  rebuildDedupeEmbeddingTable,
  reEmbedStaleContacts,
  storeEmbedding,
} from "../../server/services/dedupe/embeddings.ts";

/** A question, the only kind the rerank stage reads. */
const QUESTION = "who are the startup founders in Berlin";
const calls: { use: EmbedUse; texts: string[] }[] = [];
/** What the two backfills asked for. */
let indexed: typeof calls = [];

/** An embedder that records calls, as wide as a new database's stores. */
const recording = (
  local: boolean,
  id = local ? "test/local" : "test/hosted",
): Embedder => ({
  id,
  local,
  ready: () => true,
  dimension: async () => 384,
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

  it("embeds documents for search, and texts to compare for dedupe", () => {
    const uses = (prefix: string) =>
      new Set(
        indexed
          .filter((call) => call.texts.some((text) => text.startsWith(prefix)))
          .map((call) => call.use),
      );
    expect(uses("Ada Okafor")).toEqual(new Set(["document"]));
    expect(uses("about |")).toEqual(new Set(["document"]));
    expect(uses("task: clustering")).toEqual(new Set(["similarity"]));
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

describe("a change during a run", () => {
  /** A hosted model that keeps what it is sent. */
  const hostedTexts: string[] = [];
  const hosted: Embedder = {
    ...recording(false),
    async embed(texts) {
      hostedTexts.push(...texts);
      return texts.map(() => new Float32Array(384));
    },
  };
  /** `base`, whose first call makes `change`, as an admin or an owner would. */
  const changesOnFirstCall = (change: () => void, base = recording(true)) => {
    let first = true;
    return {
      ...base,
      async embed(texts: string[], use: EmbedUse) {
        if (first) change();
        first = false;
        return base.embed(texts, use);
      },
    } satisfies Embedder;
  };
  const pinHosted = () => setEmbedder(hosted);
  const aiOff = () => setPreferences(ensureLocalOwner(), { aiAssist: false });
  let ids: string[] = [];
  const pending = async (count = 1) =>
    ({ createdIds: ids } = await contactService.bulkCreateContacts(
      scope(),
      Array.from({ length: count }, (_, i) => ({
        name: `Pending ${i}`,
        about: `Keeps bees, hive ${i}.`,
      })),
    )).createdIds;

  afterEach(() => {
    hostedTexts.length = 0;
    setPreferences(ensureLocalOwner(), { aiAssist: true });
    sqlite
      .prepare(
        "DELETE FROM contacts WHERE id IN (SELECT value FROM json_each(?))",
      )
      .run(JSON.stringify(ids));
  });

  it("a model pinned mid-run reads nothing of an account with AI off", async () => {
    aiOff();
    const [id] = await pending();
    // The contact and its passage are two calls. Both use the run's model.
    setEmbedder(changesOnFirstCall(pinHosted));
    expect(await backfillSearchEmbeddings()).toBe(0);
    setEmbedder(changesOnFirstCall(pinHosted));
    expect(await embedContact(id)).toMatchObject({ status: "outdated" });
    // Two dedupe batches of 64 and 1, with the embedder the caller allowed.
    const allowed = changesOnFirstCall(pinHosted);
    setEmbedder(allowed);
    const items = Array.from({ length: 65 }, (_, i) => ({
      id: `${i}`,
      text: `t${i}`,
    }));
    await generateBatchEmbeddings(items, allowed);
    expect(hostedTexts).toEqual([]);
  });

  it.each([
    ["one contact", (id: string) => generateAndStoreEmbedding(id)],
    ["a bulk import", (id: string) => generateAndStoreBulkEmbeddings([id])],
    ["an account's backlog", () => backfillOwnerEmbeddings(scope())],
    ["the boot sweep", () => backfillEmbeddings()],
    [
      "a stale contact",
      (id: string) => {
        storeEmbedding(id, new Float32Array(384).fill(0.05));
        sqlite
          .prepare(
            "UPDATE dedupe_embedding_meta SET embeddedAt = '2000' WHERE contactId = ?",
          )
          .run(id);
        return reEmbedStaleContacts(scope());
      },
    ],
  ])("dedupe stores nothing from %s once the model changed", async (_, run) => {
    const [id] = await pending();
    setEmbedder(changesOnFirstCall(pinHosted));
    expect(Number(await run(id))).toBe(0);
    expect(calls).toEqual([{ use: "similarity", texts: [expect.any(String)] }]);
    expect(hostedTexts).toEqual([]);
  });

  it("sends nothing more of an account that turns AI off during a run", async () => {
    const created = await pending(65);
    const contactTexts = () =>
      hostedTexts.filter((text) => text.startsWith("Pending"));
    // Search: the contacts' call turns AI off, so their passages never leave.
    setEmbedder(changesOnFirstCall(aiOff, hosted));
    expect(await backfillSearchEmbeddings()).toBe(0);
    expect(contactTexts()).toHaveLength(64);
    expect(hostedTexts).toHaveLength(64);
    setPreferences(ensureLocalOwner(), { aiAssist: true });
    hostedTexts.length = 0;
    setEmbedder(changesOnFirstCall(aiOff, hosted));
    expect(await embedContact(created[0])).toEqual({
      status: "skipped",
      reason: "ai_off",
    });
    expect(hostedTexts).toHaveLength(1);
  });

  it.each([
    [
      "a bulk import",
      (created: string[]) => generateAndStoreBulkEmbeddings(created),
    ],
    ["an account's backlog", () => backfillOwnerEmbeddings(scope())],
    ["the boot sweep", () => backfillEmbeddings()],
    [
      "stale contacts",
      (created: string[]) => {
        for (const id of created) storeEmbedding(id, new Float32Array(384));
        sqlite
          .prepare("UPDATE dedupe_embedding_meta SET embeddedAt = '2000'")
          .run();
        return reEmbedStaleContacts(scope());
      },
    ],
  ])(
    "dedupe sends %s's first batch of 64, and no more, once AI goes off",
    async (_, run) => {
      const created = await pending(65);
      setEmbedder(changesOnFirstCall(aiOff, hosted));
      await run(created);
      expect(hostedTexts).toHaveLength(64);
    },
  );
});

describe("the stores", () => {
  it("take no vector from an embedder they were not built for", async () => {
    const {
      createdIds: [id],
    } = await contactService.bulkCreateContacts(scope(), [{ name: "Di New" }]);
    setEmbedder(recording(true));
    setEmbeddingsState({ signature: "test/other", dimension: 384 });
    setEmbeddingsState({ signature: "test/other", dimension: 384 }, "dedupe");
    expect(await backfillSearchEmbeddings()).toBe(0);
    expect(await embedContact(id)).toMatchObject({ status: "outdated" });
    expect(await generateAndStoreEmbedding(id)).toBe(false);
    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(id);
  });

  it("keep their record when the model changes during the probe", async () => {
    setEmbedder({
      ...recording(true, "test/probing"),
      dimension: async () => {
        setEmbedder(recording(true, "test/after"));
        return 384;
      },
    });
    expect(await ensureEmbeddingStore()).toBe(0);
    setEmbedder({
      ...recording(true, "test/probing"),
      dimension: async () => {
        setEmbedder(recording(true, "test/after"));
        return 384;
      },
    });
    expect(await ensureDedupeEmbeddingStore()).toBe(0);
    expect(getEmbeddingsState()?.signature).toBe("test/other");
    expect(getEmbeddingsState("dedupe")?.signature).toBe("test/other");
  });

  it("rebuild for an embedder with a new id, record it, and rebuild only once", async () => {
    setEmbedder(recording(true, "test/next"));
    expect(await ensureEmbeddingStore()).toBe(2);
    expect(getEmbeddingsState()?.signature).toBe("test/next");
    expect(await ensureDedupeEmbeddingStore()).toBe(2);
    expect(getEmbeddingsState("dedupe")?.signature).toBe("test/next");
    expect(await ensureEmbeddingStore()).toBe(0);
    expect(await ensureDedupeEmbeddingStore()).toBe(0);
  });
});

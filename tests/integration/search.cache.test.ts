// =============================================================================
// Integration: the two Ask cache tiers
// =============================================================================
// L1 answers the same words twice. L2, the semantic cache, answers the same
// question in other words, with no model call. Both must drop an answer once
// a contact changes or two contacts merge, both must keep one account's
// answers from another, and L2 must never mistake a question about Munich
// for one about Berlin, however close their vectors are.
//
// The real pipeline and database run here. The provider is scripted at the
// gateway, and each question's vector is chosen by the test, so "close" and
// "far" are exact numbers rather than whatever a model happens to return.
// Hits are read from the answer's `cached` flag: the planner's own cache
// keys on the question's text, so a count of planner calls cannot show an
// L1 miss after an edit.
// =============================================================================

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

vi.mock("../../server/ai/gateway.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/gateway.ts")>()),
  generateFor: vi.fn(),
  isAnyProviderConfigured: () => true,
}));
vi.mock("../../server/ai/services/shared.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/ai/services/shared.ts")
  >()),
  isMockMode: () => false,
}));

// A contact edit and a merge start a dedupe embedding in the background.
// The dedupe store is not what this file tests. One that finished after
// the last test logged while Vitest closed the worker ("Closing rpc while
// onUserConsoleLog was pending"), and that error fails the whole run.
vi.mock(
  "../../server/services/dedupe/embeddings.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../server/services/dedupe/embeddings.ts")
    >()),
    generateAndStoreEmbedding: async () => false,
  }),
);

const questions = vi.hoisted(() => new Map<string, Float32Array>());
vi.mock(
  "../../server/services/search/localEmbeddings.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../server/services/search/localEmbeddings.ts")
    >()),
    isSearchEmbeddingReady: () => true,
    embedText: vi.fn(async (text: string) => questions.get(text) ?? null),
  }),
);

import { generateFor, type GatewayOptions } from "../../server/ai/gateway.ts";
import type { QueryPlan } from "../../server/ai/types.ts";
import { resolveEmbeddings } from "../../server/ai/embeddings.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import { searchService } from "../../server/services/searchService.ts";
import {
  embedText,
  upsertSearchEmbeddings,
} from "../../server/services/search/localEmbeddings.ts";
import {
  SEMANTIC_THRESHOLD,
  entityKey,
  constraintKey,
  semanticEntryCount,
} from "../../server/services/search/semanticCache.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import { setPairScorer } from "../../server/services/search/crossEncoder.ts";
import { makeTestApp } from "./helpers.ts";
import { createActor, localOwnerId, resetAccounts } from "./tenancy/helpers.ts";

const app = makeTestApp();

/** A 384-wide vector with the given components set. */
function vector(parts: Record<number, number>): Float32Array {
  const v = new Float32Array(384);
  for (const [index, value] of Object.entries(parts)) v[Number(index)] = value;
  return v;
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
};

// No "in", "at" or "near" before the city, so neither question has an
// implicit facet, and their facets are equal.
const ASKED = "Berlin startup founders";
/** The same question in other words, at cosine 0.995. */
const REWORDED = "Who are Berlin startup founders?";
questions.set(ASKED, vector({ 0: 1 }));
questions.set(REWORDED, vector({ 0: 1, 1: 0.1 }));

const FOUNDERS = [
  { name: "Ada Okafor", role: "Founder", location: "Berlin, Germany" },
  { name: "Bea Okafor", role: "Founder", location: "Berlin, Germany" },
  { name: "Cy Marsh", role: "Engineer", location: "Berlin, Germany" },
  { name: "Dov Katz", role: "Founder", location: "Munich, Germany" },
];

/** Every provider call, for the checks that a hit makes none. */
const modelCalls = () => vi.mocked(generateFor).mock.calls.length;

/** The planner answers with a plan the database proves: founders in Berlin. */
function scriptPlanner(verifyEmpty = false): void {
  vi.mocked(generateFor).mockImplementation(
    async (_capability, options: GatewayOptions) => {
      if (
        verifyEmpty &&
        options.systemPrompt?.includes("precise CRM data analyst")
      )
        return { text: "[]", model: "fixture", latencyMs: 1 };
      if (!options.systemPrompt?.includes("query planner"))
        throw new Error("Only the planner is scripted");
      const plan: QueryPlan = {
        must: {
          roleMatchers: ["Founder"],
          locationMatchers: ["Berlin"],
        },
        should: {},
        confidence: "high",
        rationale: "",
      };
      return { text: JSON.stringify(plan), model: "fixture", latencyMs: 1 };
    },
  );
}

/** Write `people` for the local owner through the API, with a vector each. */
async function seedLocal(people = FOUNDERS): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const person of people) {
    const res = await request(app).post("/api/contacts").send(person);
    expect(res.status).toBe(201);
    ids.set(person.name, res.body.id);
  }
  upsertSearchEmbeddings(
    [...ids.values()].map((id, i) => ({
      contactId: id,
      embedding: vector({ [10 + i]: 1 }),
    })),
  );
  return ids;
}

const scope = () => scopeForOwnerId(localOwnerId());
const ask = (question: string, as: Scope = scope()) =>
  searchService.semanticSearch(as, question, "cache-test");
const names = (result: { matches: { name: string }[] }) =>
  result.matches.map((match) => match.name).sort();

beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  sqlite.prepare("DELETE FROM search_embeddings").run();
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
  scriptPlanner();
  vi.mocked(embedText)
    .mockReset()
    .mockImplementation(async (text: string) => questions.get(text) ?? null);
});

afterEach(() => {
  vi.useRealTimers();
  setPairScorer(null);
});

describe("the setup", () => {
  it("uses the built-in embedding model, the only one L2 serves", () => {
    expect(resolveEmbeddings().kind).toBe("builtin");
  });

  it("puts the reworded question above the threshold", () => {
    expect(
      cosine(questions.get(ASKED)!, questions.get(REWORDED)!),
    ).toBeGreaterThanOrEqual(SEMANTIC_THRESHOLD);
  });
});

describe("L1 and L2 answer a repeated question", () => {
  it("answers the same words from L1 and other words from L2, with no model call", async () => {
    await seedLocal();
    const first = await ask(ASKED);
    expect(first.cached).toBeFalsy();
    expect(first.fallback).toBe(false);
    expect(names(first)).toEqual(["Ada Okafor", "Bea Okafor"]);
    const calls = modelCalls();
    expect(calls).toBeGreaterThan(0);

    const again = await ask(ASKED);
    expect(again.cached).toBe(true);

    const reworded = await ask(REWORDED);
    expect(reworded.cached).toBe(true);
    expect(names(reworded)).toEqual(["Ada Okafor", "Bea Okafor"]);
    expect(modelCalls()).toBe(calls);
  });

  it("keeps only answers a model or the database verified", async () => {
    await seedLocal();
    vi.mocked(generateFor).mockRejectedValue(new Error("Provider unavailable"));
    const first = await ask(ASKED);
    // The local list stands in, unverified, and is not kept.
    expect(first.fallback).toBe(true);
    expect(semanticEntryCount(localOwnerId())).toBe(0);

    scriptPlanner();
    expect((await ask(REWORDED)).cached).toBeFalsy();
  });

  it("forgets an answer after five minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await seedLocal();
    await ask(ASKED);
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect((await ask(REWORDED)).cached).toBeFalsy();
  });
});

describe("a contact edit", () => {
  it("refreshes the AI-off list after a deletion during local scoring", async () => {
    const ids = await seedLocal();
    let started!: () => void;
    let release!: () => void;
    const scoring = new Promise<void>((resolve) => {
      started = resolve;
    });
    setPairScorer(async ({ docs }) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return docs.map((_, index) => -index);
    });
    const pending = searchService.semanticSearch(
      scope(),
      "who are the startup founders in Berlin",
      "edited-list",
      undefined,
      { aiAllowed: false },
    );
    await scoring;
    sqlite
      .prepare("DELETE FROM contacts WHERE id = ?")
      .run(ids.get("Ada Okafor"));
    release();
    const result = await pending;
    expect(result.fallback).toBe(true);
    expect(names(result)).not.toContain("Ada Okafor");
    expect(names(result)).toContain("Bea Okafor");
  });

  it("makes L1 miss", async () => {
    const ids = await seedLocal();
    await ask(ASKED);
    expect((await ask(ASKED)).cached).toBe(true);

    const res = await request(app)
      .put(`/api/contacts/${ids.get("Cy Marsh")}`)
      .send({ role: "Founder" });
    expect(res.status).toBe(200);

    const after = await ask(ASKED);
    expect(after.cached).toBeFalsy();
    // And the fresh answer has the edit in it.
    expect(names(after)).toEqual(["Ada Okafor", "Bea Okafor", "Cy Marsh"]);
  });

  it("makes L2 miss", async () => {
    const ids = await seedLocal();
    await ask(ASKED);
    expect((await ask(REWORDED)).cached).toBe(true);

    const res = await request(app)
      .put(`/api/contacts/${ids.get("Cy Marsh")}`)
      .send({ role: "Founder" });
    expect(res.status).toBe(200);

    const after = await ask(REWORDED);
    expect(after.cached).toBeFalsy();
    expect(names(after)).toEqual(["Ada Okafor", "Bea Okafor", "Cy Marsh"]);
  });
});

describe("a note", () => {
  it("makes both tiers miss when it is added, edited or deleted", async () => {
    const ids = await seedLocal();
    const contact = ids.get("Cy Marsh");
    let note = "";
    // A note moves no searched column, so the search revision stays and only
    // the notes stamp can tell. A miss on the same words is an L1 miss and
    // an L2 miss: L2 would serve the question's own entry.
    for (const [change, status] of [
      [
        async () => {
          const res = await request(app)
            .post(`/api/contacts/${contact}/interactions`)
            .send({ type: "call", title: "Catch up", content: "<p>Hi</p>" });
          note = res.body.id;
          return res;
        },
        201,
      ],
      [
        () =>
          request(app)
            .patch(`/api/interactions/${note}`)
            .send({ title: "Caught up" }),
        200,
      ],
      [() => request(app).delete(`/api/interactions/${note}`), 200],
    ] as const) {
      await ask(ASKED);
      expect((await ask(ASKED)).cached).toBe(true);
      expect((await change()).status).toBe(status);
      expect((await ask(ASKED)).cached).toBeFalsy();
    }
  });
});

describe("a merge", () => {
  async function merge(ids: Map<string, string>) {
    const res = await request(app)
      .post("/api/contacts/merge")
      .send({
        primaryId: ids.get("Ada Okafor"),
        duplicateId: ids.get("Bea Okafor"),
      });
    expect(res.status).toBe(200);
  }

  it("makes L1 miss", async () => {
    const ids = await seedLocal();
    await ask(ASKED);
    expect((await ask(ASKED)).cached).toBe(true);

    await merge(ids);

    const after = await ask(ASKED);
    expect(after.cached).toBeFalsy();
    // The duplicate is gone from the answer, not served from before.
    expect(names(after)).toEqual(["Ada Okafor"]);
  });

  it("makes L2 miss", async () => {
    const ids = await seedLocal();
    await ask(ASKED);
    expect((await ask(REWORDED)).cached).toBe(true);

    await merge(ids);

    const after = await ask(REWORDED);
    expect(after.cached).toBeFalsy();
    expect(names(after)).toEqual(["Ada Okafor"]);
  });
});

describe("the entity guard", () => {
  it.each([
    [
      "people interested in ai and machine learning",
      "people interested in ai or machine learning",
    ],
    ["engineers who became founders", "founders who became engineers"],
    ["berlin startup founders", "munich startup founders"],
    ["people who like climbing", "people who do not like climbing"],
    [
      "founders with > 10 years of experience",
      "founders with < 10 years of experience",
    ],
  ])(
    "does not reuse an answer when constraints change: %s",
    async (firstQuery, nextQuery) => {
      await seedLocal();
      scriptPlanner(true);
      questions.set(firstQuery, vector({ 0: 1 }));
      questions.set(nextQuery, vector({ 0: 1, 1: 0.1 }));
      expect((await ask(firstQuery)).fallback).toBe(false);
      expect(semanticEntryCount(localOwnerId())).toBe(1);
      const calls = modelCalls();
      expect((await ask(nextQuery)).cached).toBeFalsy();
      expect(modelCalls()).toBeGreaterThan(calls);
    },
  );

  it("keeps constraint order and logical operators in the cache key", () => {
    expect(constraintKey("Please show me Berlin startup founders?")).toBe(
      constraintKey("Who are Berlin startup founders"),
    );
    expect(constraintKey("engineers who became founders")).not.toBe(
      constraintKey("founders who became engineers"),
    );
    expect(constraintKey("ai and machine learning")).not.toBe(
      constraintKey("ai or machine learning"),
    );
  });

  it("reuses a safe rewording when a proven place facet moves", async () => {
    await seedLocal();
    const first = "who in Berlin are startup founders";
    const second = "who are startup founders in Berlin";
    questions.set(first, vector({ 0: 1 }));
    questions.set(second, vector({ 0: 1, 1: 0.1 }));
    await ask(first);
    const calls = modelCalls();
    expect((await ask(second)).cached).toBe(true);
    expect(modelCalls()).toBe(calls);
  });

  it("does not serve a cached contact deleted while the query vector waits", async () => {
    const ids = await seedLocal();
    await ask(ASKED);
    let release!: (vector: Float32Array) => void;
    vi.mocked(embedText).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = ask(REWORDED);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    sqlite
      .prepare("DELETE FROM contacts WHERE id = ?")
      .run(ids.get("Ada Okafor"));
    release(questions.get(REWORDED)!);
    const result = await pending;
    expect(result.cached).toBeFalsy();
    expect(names(result)).not.toContain("Ada Okafor");
  });

  it("continues with keyword search when the local embedding worker stalls", async () => {
    await seedLocal();
    vi.mocked(embedText).mockImplementation(() => new Promise(() => {}));
    const result = await ask(ASKED);
    expect(result.fallback).toBe(false);
    expect(names(result)).toEqual(["Ada Okafor", "Bea Okafor"]);
    // The shared failure must not start another embedding from retrieval.
    expect(embedText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedText).mock.calls[0][1]?.aborted).toBe(true);
  });

  it("stops a cancelled search while the local embedding worker stalls", async () => {
    await seedLocal();
    const controller = new AbortController();
    vi.mocked(embedText).mockImplementation(() => new Promise(() => {}));
    const pending = searchService.semanticSearch(
      scope(),
      ASKED,
      "cancel",
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("Stopped by caller");
    await vi.waitFor(() => expect(embedText).toHaveBeenCalledOnce());
    controller.abort(new Error("Stopped by caller"));
    await rejected;
    expect(modelCalls()).toBe(0);
    expect(semanticEntryCount(localOwnerId())).toBe(0);
  });

  it("keys a question by its names, numbers, quotes and emails", () => {
    expect(entityKey("founders in Berlin")).toBe("berlin");
    expect(entityKey("Berlin founders")).toBe("berlin");
    expect(entityKey("founders in Munich")).toBe("munich");
    // A capital that only starts the question is not a name.
    expect(entityKey("Who works at Northwind Logistics?")).toBe(
      entityKey("people who work at Northwind Logistics"),
    );
    expect(entityKey("people I haven't talked to in 3 months")).toBe("3");
    expect(entityKey('notes that say "cedar table"')).toBe("cedar table");
    expect(entityKey("email ada@example.com about Zürich")).toBe(
      "ada@example.com|zurich",
    );
    expect(entityKey("someone who knows about beekeeping")).toBe("");
  });
});

describe("owner isolation", () => {
  // Fresh accounts. The first account created on an instance claims the
  // local owner's rows, so the local owner cannot be one of them.
  let first: Scope;
  let second: Scope;
  let third: Scope;

  beforeAll(async () => {
    resetAccounts();
    first = (await createActor(app, { username: "cachefirst" })).scope;
    second = (await createActor(app, { username: "cachesecond" })).scope;
    third = (await createActor(app, { username: "cachethird" })).scope;
  });

  afterAll(() => resetAccounts());

  /** One founder in Berlin for `owner`, with a vector. */
  function founder(owner: Scope, id: string, name: string, axis: number) {
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, role, location, ownerId) VALUES (?, ?, 'Founder', 'Berlin, Germany', ?)",
      )
      .run(id, name, owner.ownerId);
    upsertSearchEmbeddings([
      { contactId: id, embedding: vector({ [axis]: 1 }) },
    ]);
  }

  it("never answers one account from another account's entry", async () => {
    founder(first, "first-founder", "Ada Okafor", 10);
    founder(second, "second-founder", "Olu Mensah", 11);
    founder(third, "third-founder", "Tove Lund", 12);
    // The same revision for all three, so only the owner in the key keeps
    // them apart.
    const revision = (
      sqlite
        .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
        .get(first.ownerId) as { revision: number }
    ).revision;
    for (const other of [second, third])
      sqlite
        .prepare("UPDATE search_revision SET revision = ? WHERE ownerId = ?")
        .run(revision, other.ownerId);

    expect(names(await ask(ASKED, first))).toEqual(["Ada Okafor"]);
    expect((await ask(REWORDED, first)).cached).toBe(true);

    // Other words: L2 holds only the first account's answer.
    const reworded = await ask(REWORDED, second);
    expect(reworded.cached).toBeFalsy();
    expect(names(reworded)).toEqual(["Olu Mensah"]);
    // The same words: L1 holds only the first account's answer.
    const same = await ask(ASKED, third);
    expect(same.cached).toBeFalsy();
    expect(names(same)).toEqual(["Tove Lund"]);
  });
});

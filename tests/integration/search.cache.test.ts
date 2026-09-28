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
    embedText: async (text: string) => questions.get(text) ?? null,
  }),
);

import { generateFor, type GatewayOptions } from "../../server/ai/gateway.ts";
import type { QueryPlan } from "../../server/ai/types.ts";
import { resolveEmbeddings } from "../../server/ai/embeddings.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import { searchService } from "../../server/services/searchService.ts";
import { upsertSearchEmbeddings } from "../../server/services/search/localEmbeddings.ts";
import {
  SEMANTIC_THRESHOLD,
  entityKey,
  semanticEntryCount,
} from "../../server/services/search/semanticCache.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
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

// No "in", "at" or "near" before a city, so neither question has an
// implicit facet, and their facets are equal. Only the entity key can keep
// Munich apart from Berlin.
const ASKED = "Berlin startup founders";
/** The same question in other words, at cosine 0.995. */
const REWORDED = "founders of Berlin startups";
/** Another city at the same cosine. Only the entity key tells them apart. */
const OTHER_CITY = "Munich startup founders";
questions.set(ASKED, vector({ 0: 1 }));
questions.set(REWORDED, vector({ 0: 1, 1: 0.1 }));
questions.set(OTHER_CITY, vector({ 0: 1, 2: 0.1 }));

const FOUNDERS = [
  { name: "Ada Okafor", role: "Founder", location: "Berlin, Germany" },
  { name: "Bea Okafor", role: "Founder", location: "Berlin, Germany" },
  { name: "Cy Marsh", role: "Engineer", location: "Berlin, Germany" },
  { name: "Dov Katz", role: "Founder", location: "Munich, Germany" },
];

/** Every provider call, for the checks that a hit makes none. */
const modelCalls = () => vi.mocked(generateFor).mock.calls.length;

/**
 * The planner answers with a plan the database proves: founders in the city
 * the question names.
 */
function scriptPlanner(): void {
  vi.mocked(generateFor).mockImplementation(
    async (_capability, options: GatewayOptions) => {
      if (!options.systemPrompt?.includes("query planner"))
        throw new Error("Only the planner is scripted");
      const plan: QueryPlan = {
        must: {
          roleMatchers: ["Founder"],
          locationMatchers: [
            JSON.stringify(options).includes("Munich") ? "Munich" : "Berlin",
          ],
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the setup", () => {
  it("uses the built-in embedding model, the only one L2 serves", () => {
    expect(resolveEmbeddings().kind).toBe("builtin");
  });

  it("puts the reworded question above the threshold and the other city too", () => {
    const asked = questions.get(ASKED)!;
    expect(cosine(asked, questions.get(REWORDED)!)).toBeGreaterThanOrEqual(
      SEMANTIC_THRESHOLD,
    );
    // The vectors alone would let Munich answer for Berlin.
    expect(cosine(asked, questions.get(OTHER_CITY)!)).toBeGreaterThanOrEqual(
      SEMANTIC_THRESHOLD,
    );
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
  it("does not answer a question about Munich from one about Berlin", async () => {
    await seedLocal();
    await ask(ASKED);
    const calls = modelCalls();

    const munich = await ask(OTHER_CITY);
    expect(munich.cached).toBeFalsy();
    // The question went to the model, as a new question must.
    expect(modelCalls()).toBeGreaterThan(calls);
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

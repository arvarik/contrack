// =============================================================================
// Integration Tests — the embedding backfills run one account at a time
// =============================================================================
// Both backfills are sweeps: they run at boot, with no request behind them and
// no scope in the async context. Before sub-phase 2h each was one pass over
// every contact on the instance, which had two consequences.
//
//   • The provider bill landed on the primary admin. `recordInvocation` reads
//     `currentOwnerId()`, which falls back to that account when there is no
//     context, so an instance of ten people showed one person paying for all
//     of them.
//   • A large account finished before a small account started. The sweep was
//     one queue in table order, so a new account's search stayed empty until
//     every older account was embedded.
//
// This file proves both are fixed: the owner named at the moment of the
// provider call is the owner whose contact is being embedded, and accounts
// take turns rather than draining one at a time.
//
// The seam is `server/ai/embeddings.ts`. Mocking it makes the resolved
// capability a provider model, which is what both `isSearchEmbeddingReady`
// and `isEmbeddingAvailable` check, and replaces the provider call itself.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "crypto";

/** The vector width the fake provider answers with, per store. */
let width = 384;
/** One entry per text the fake provider embedded, in call order. */
const embedded: { text: string; owner: string | null }[] = [];

vi.mock("../../server/ai/embeddings.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../../server/ai/embeddings.ts")>();
  const { currentScopeOrNull } =
    await import("../../server/tenancy/requestContext.ts");
  const { recordInvocation } =
    await import("../../server/services/aiStatsService.ts");
  return {
    ...actual,
    resolveEmbeddings: () => ({
      kind: "provider" as const,
      providerId: "mock",
      model: "mock-embed",
      dimension: width,
      signature: "mock/mock-embed",
    }),
    embedWithProvider: async (
      _providerId: string,
      _model: string,
      texts: string[],
    ) => {
      // The owner the async context names right now is the owner
      // recordInvocation would stamp. Capturing it here is the assertion.
      const owner = currentScopeOrNull()?.ownerId ?? null;
      for (const text of texts) embedded.push({ text, owner });
      // A real generation adapter records the call here, so this writes a
      // real row through the real function rather than asserting on the
      // captured owner alone. `searchExpansion` stands in for the operation
      // name: `AI_OPERATIONS` has no embedding kind, because the embedding
      // path records nothing today. That is a separate gap, and the owner it
      // would stamp is the owner this row proves.
      recordInvocation({
        operation: "searchExpansion",
        model: "mock-embed",
        tokenCount: texts.length,
        latencyMs: 1,
        cached: false,
        description: "stands in for an embedding call",
      });
      return texts.map(() => Array.from({ length: width }, () => 0.1));
    },
  };
});

import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId, resetAccounts } from "./tenancy/helpers.ts";
import {
  backfillEmbeddings,
  backfillOwnerEmbeddings,
} from "../../server/services/dedupe/embeddings.ts";
import { backfillSearchEmbeddings } from "../../server/services/search/localEmbeddings.ts";

/**
 * More than one round each, so "took turns" is a claim the order can carry.
 * The round size is 200, so 250 contacts means a full round and a part round
 * per account.
 */
const PER_OWNER = 250;

let ownerA: string;
let ownerB: string;

function seedOwner(label: string): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, displayName, passwordHash, role)
       VALUES (?, ?, ?, ?, 'none$', 'member')`,
    )
    .run(id, `${label}@backfill.test`, label, label);

  const insert = sqlite.prepare(
    `INSERT INTO contacts (id, name, company, ownerId) VALUES (?, ?, ?, ?)`,
  );
  sqlite.transaction(() => {
    for (let i = 0; i < PER_OWNER; i++) {
      insert.run(crypto.randomUUID(), `${label} Person ${i}`, "Acme", id);
    }
  })();
  return id;
}

/** Which accounts appear, in the order the provider first saw each of them. */
function ownerSequence(): string[] {
  const out: string[] = [];
  for (const call of embedded) {
    const owner = call.owner ?? "none";
    if (out[out.length - 1] !== owner) out.push(owner);
  }
  return out;
}

function vectorCount(table: string, owner: string): number {
  return (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId = ?`)
      .get(owner) as { n: number }
  ).n;
}

beforeAll(() => {
  resetAccounts();
  ownerA = seedOwner("alpha");
  ownerB = seedOwner("beta");
});

afterAll(() => {
  resetAccounts();
  vi.restoreAllMocks();
});

describe("the dedupe embedding backfill", () => {
  beforeAll(async () => {
    width = 768; // contact_embeddings is built at 768.
    embedded.length = 0;
    sqlite.prepare("DELETE FROM ai_invocations").run();
    await backfillEmbeddings();
  });

  it("embeds every account's contacts", () => {
    expect(vectorCount("contact_embeddings", ownerA)).toBe(PER_OWNER);
    expect(vectorCount("contact_embeddings", ownerB)).toBe(PER_OWNER);
  });

  it("names the owning account at the moment of the provider call", () => {
    expect(embedded.length).toBeGreaterThan(0);
    for (const call of embedded) {
      const expected = call.text.includes("alpha Person") ? ownerA : ownerB;
      expect(call.owner, call.text).toBe(expected);
    }
  });

  it("bills each account for its own contacts", () => {
    const rows = sqlite
      .prepare(
        `SELECT ownerId, COUNT(*) AS n FROM ai_invocations
          WHERE operation = 'searchExpansion' GROUP BY ownerId`,
      )
      .all() as { ownerId: string; n: number }[];
    const byOwner = Object.fromEntries(rows.map((r) => [r.ownerId, r.n]));

    expect(byOwner[ownerA]).toBeGreaterThan(0);
    expect(byOwner[ownerB]).toBeGreaterThan(0);
    // The account the fallback would have charged. Every row it holds is a row
    // that ran outside a context.
    expect(byOwner[localOwnerId()] ?? 0).toBe(0);
  });

  it("lets the accounts take turns instead of draining one at a time", () => {
    // 250 contacts each in rounds of 200 gives alpha, beta, alpha, beta.
    // The property is that an account comes back after the other one ran.
    const sequence = ownerSequence();
    expect(sequence.length).toBeGreaterThan(2);
    expect(new Set(sequence).size).toBe(2);
    expect(sequence[0]).not.toBe(sequence[1]);
  });
});

describe("the dedupe backfill for one account", () => {
  beforeAll(async () => {
    width = 768;
    embedded.length = 0;
    sqlite.prepare("DELETE FROM contact_embeddings").run();
    sqlite.prepare("DELETE FROM dedupe_embedding_meta").run();
    await backfillOwnerEmbeddings(scopeForOwnerId(ownerA));
  });

  it("embeds that account and leaves the other one alone", () => {
    expect(vectorCount("contact_embeddings", ownerA)).toBe(PER_OWNER);
    expect(vectorCount("contact_embeddings", ownerB)).toBe(0);
  });

  it("never asks the provider about the other account", () => {
    expect(embedded.length).toBeGreaterThan(0);
    for (const call of embedded) {
      expect(call.owner).toBe(ownerA);
      expect(call.text.includes("alpha Person")).toBe(true);
    }
  });
});

describe("the search embedding backfill", () => {
  beforeAll(async () => {
    width = 384; // search_embeddings is built at 384.
    embedded.length = 0;
    sqlite.prepare("DELETE FROM search_embeddings").run();
    await backfillSearchEmbeddings();
  });

  it("embeds every account's contacts", () => {
    expect(vectorCount("search_embeddings", ownerA)).toBe(PER_OWNER);
    expect(vectorCount("search_embeddings", ownerB)).toBe(PER_OWNER);
  });

  it("names the owning account at the moment of the provider call", () => {
    expect(embedded.length).toBeGreaterThan(0);
    for (const call of embedded) {
      const expected = call.text.includes("alpha Person") ? ownerA : ownerB;
      expect(call.owner, call.text).toBe(expected);
    }
  });

  it("lets the accounts take turns instead of draining one at a time", () => {
    const sequence = ownerSequence();
    expect(sequence.length).toBeGreaterThan(2);
    expect(new Set(sequence).size).toBe(2);
    expect(sequence[0]).not.toBe(sequence[1]);
  });
});

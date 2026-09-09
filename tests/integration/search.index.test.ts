import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { sqlite } from "../../server/db.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { installSearchIndex } from "../../server/services/search/ftsIndex.ts";
import {
  embedContact,
  findSearchNeighbors,
  upsertSearchEmbedding,
} from "../../server/services/search/localEmbeddings.ts";
import * as embeddings from "../../server/ai/embeddings.ts";

const app = makeTestApp();
const insert = (id: string, name = "Alice", role = "Designer") =>
  sqlite
    .prepare(
      "INSERT INTO contacts(id, name, role, ownerId) VALUES (?, ?, ?, ?)",
    )
    .run(id, name, role, localOwnerId());
const vector = (n = 0) => {
  const v = new Float32Array(384);
  v[0] = n;
  return v;
};
/** The owner every row here belongs to. Read late: the account is recreated. */
const scope = () => scopeForOwnerId(localOwnerId());

beforeEach(() => sqlite.prepare("DELETE FROM contacts").run());
afterEach(() => vi.restoreAllMocks());

describe("search index lifecycle", () => {
  it("matches words across fields and treats punctuation as literal input", async () => {
    insert("alice");
    expect(lexicalSearch(scope(), "alice des").map((r) => r.contactId)).toEqual(
      ["alice"],
    );
    for (const q of ['"', "* () :", "   ", '" OR * -']) {
      expect((await request(app).get("/api/search").query({ q })).status).toBe(
        200,
      );
    }
    expect((await request(app).get("/api/search?q=a&q=b")).status).toBe(400);
  });

  it("excludes inactive contacts on insert, update, and index rebuild", () => {
    insert("active");
    for (const [id, update] of [
      ["archived", "isArchived = 1"],
      ["ghost", "isGhost = 1"],
      ["merged", "canonicalId = 'active'"],
      ["trash", "deletedAt = datetime('now')"],
    ]) {
      insert(id);
      sqlite.prepare(`UPDATE contacts SET ${update} WHERE id = ?`).run(id);
    }
    expect(lexicalSearch(scope(), "Alice").map((r) => r.contactId)).toEqual([
      "active",
    ]);
    sqlite.pragma("user_version = 1");
    installSearchIndex(sqlite);
    expect(lexicalSearch(scope(), "Alice").map((r) => r.contactId)).toEqual([
      "active",
    ]);
    sqlite
      .prepare("UPDATE contacts SET isArchived = 0 WHERE id = 'archived'")
      .run();
    expect(lexicalSearch(scope(), "Alice")).toHaveLength(2);
  });

  it("refreshes edited and reparented child values without duplicate index entries", () => {
    insert("one");
    insert("two", "Bob");
    sqlite
      .prepare(
        "INSERT INTO contact_emails(id,contactId,email) VALUES ('email','one','first@example.com')",
      )
      .run();
    expect(lexicalSearch(scope(), "first")[0].contactId).toBe("one");
    sqlite
      .prepare(
        "UPDATE contact_emails SET email='second@example.com', contactId='two' WHERE id='email'",
      )
      .run();
    expect(lexicalSearch(scope(), "first")).toEqual([]);
    expect(lexicalSearch(scope(), "second")[0].contactId).toBe("two");
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM contacts_fts").get(),
    ).toEqual({ n: 2 });
  });

  it("keeps keyword and vector changes inside a rolled back contact transaction", () => {
    insert("one");
    upsertSearchEmbedding("one", vector());
    expect(() =>
      sqlite.transaction(() => {
        sqlite
          .prepare("UPDATE contacts SET name='Changed' WHERE id='one'")
          .run();
        throw new Error("rollback");
      })(),
    ).toThrow("rollback");
    expect(lexicalSearch(scope(), "Alice")).toHaveLength(1);
    expect(lexicalSearch(scope(), "Changed")).toEqual([]);
    expect(findSearchNeighbors(scope(), vector(), 1)).toHaveLength(1);
  });

  it("applies FTS filters before the top-k limit", () => {
    sqlite.transaction(() => {
      for (let i = 0; i < 130; i++) insert(`other-${i}`, "Needle");
      insert("wanted", "Long Profile With A Needle");
    })();
    expect(lexicalSearch(scope(), "Needle", 1, new Set(["wanted"]))).toEqual([
      { contactId: "wanted" },
    ]);
  });

  it("weights contact names above the same keyword in a company", () => {
    insert("name", "Needle");
    insert("company", "Someone");
    sqlite
      .prepare("UPDATE contacts SET company='Needle' WHERE id='company'")
      .run();
    expect(lexicalSearch(scope(), "Needle")[0].contactId).toBe("name");
  });

  it("uses stable contact rowids after migration and repeated installation", () => {
    insert("one");
    insert("two");
    sqlite.pragma("user_version = 1");
    installSearchIndex(sqlite);
    installSearchIndex(sqlite);
    const rows = sqlite
      .prepare(
        "SELECT f.rowid = c.rowid AS same FROM contacts_fts f JOIN contacts c ON c.id=f.contactId",
      )
      .all();
    expect(rows).toEqual([{ same: 1 }, { same: 1 }]);
    sqlite.prepare("DELETE FROM contacts WHERE id='one'").run();
    expect(lexicalSearch(scope(), "Alice").map((r) => r.contactId)).toEqual([
      "two",
    ]);
  });
});

describe("vector retrieval and asynchronous writes", () => {
  it("filters before KNN and honors typed-array slice boundaries", () => {
    insert("nearest");
    insert("wanted");
    upsertSearchEmbedding("nearest", vector());
    const backing = new Float32Array(386);
    backing[1] = 10;
    upsertSearchEmbedding("wanted", backing.subarray(1, 385));
    expect(
      findSearchNeighbors(scope(), vector(), 1, new Set(["wanted"]))[0]
        .contactId,
    ).toBe("wanted");
    expect(findSearchNeighbors(scope(), vector(), 10, new Set())).toEqual([]);
    sqlite.prepare("UPDATE contacts SET isArchived=1 WHERE id='nearest'").run();
    expect(findSearchNeighbors(scope(), vector(), 1)[0].contactId).toBe(
      "wanted",
    );
  });

  it("deletes stale vectors when searchable fields or tags change", () => {
    insert("one");
    upsertSearchEmbedding("one", vector());
    sqlite.prepare("UPDATE contacts SET role='Engineer' WHERE id='one'").run();
    expect(findSearchNeighbors(scope(), vector(), 1)).toEqual([]);
    upsertSearchEmbedding("one", vector());
    sqlite
      .prepare(
        "INSERT INTO contact_tags(id,contactId,tag) VALUES ('tag','one','New')",
      )
      .run();
    expect(findSearchNeighbors(scope(), vector(), 1)).toEqual([]);
  });

  it.each(["edit", "delete", "model"])(
    "rejects a late embedding after a %s",
    async (change) => {
      insert("one");
      const resolve = vi
        .spyOn(embeddings, "resolveEmbeddings")
        .mockReturnValue({
          kind: "provider",
          providerId: "test",
          model: "test",
          dimension: 384,
          signature: "test/test",
        });
      let finish!: (value: number[][]) => void;
      vi.spyOn(embeddings, "embedWithProvider").mockImplementation(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      );
      const pending = embedContact("one");
      if (change === "edit")
        sqlite.prepare("UPDATE contacts SET name='New' WHERE id='one'").run();
      if (change === "delete")
        sqlite.prepare("DELETE FROM contacts WHERE id='one'").run();
      if (change === "model")
        resolve.mockReturnValue({
          kind: "builtin",
          dimension: 384,
          signature: "builtin/new",
        });
      finish([Array.from(vector())]);
      await pending;
      expect(findSearchNeighbors(scope(), vector(), 1)).toEqual([]);
    },
  );
});

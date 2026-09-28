import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import * as embeddings from "../../server/ai/embeddings.ts";
import {
  embedContact,
  findPassageNeighbors,
  ensureEmbeddingStore,
  rebuildSearchEmbeddingTable,
  backfillSearchEmbeddings,
} from "../../server/services/search/localEmbeddings.ts";
import {
  passageSnapshot,
  splitPassage,
  findPassages,
  selectPassages,
  currentPassage,
} from "../../server/services/search/passages.ts";
import { PASSAGE_VERSION } from "../../server/services/search/passageIndex.ts";
import {
  drainIndexQueue,
  initSearchIndexQueue,
  getSearchCoverage,
  _resetIndexQueueStateForTest,
} from "../../server/services/search/indexQueue.ts";
import { compileFacets } from "../../server/services/search/facetSql.ts";
import { buildFullExport } from "../../server/services/exportService.ts";
import { contactRepo } from "../../server/repositories/contactRepository.ts";
import { deleteSetting } from "../../server/services/settingsService.ts";
import { contactService } from "../../server/services/contactService.ts";
import { mergeContacts } from "../../server/services/dedupe/merging.ts";
import { runBackup, BACKUPS_DIR } from "../../server/services/backupService.ts";

makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());
const vector = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
const longBio =
  "I coordinate technical projects and support the team. ".repeat(35) +
  "I restore medieval astronomical clocks.";
function contact(id = "one", about = longBio, ownerId = localOwnerId()) {
  sqlite
    .prepare(
      "INSERT INTO contacts (id, ownerId, name, company, about) VALUES (?, ?, ?, 'CurrentCo', ?)",
    )
    .run(id, ownerId, `Person ${id}`, about);
}
function history(contactId = "one") {
  sqlite
    .prepare(
      `INSERT INTO contact_experience (id, contactId, company, role, isCurrent, endDate, description, source)
    VALUES (?, ?, 'FormerCo', 'Engineer', 0, '2020-01', 'Designed acoustic navigation systems.', 'import')`,
    )
    .run(`job-${contactId}`, contactId);
}

beforeEach(() => {
  _resetIndexQueueStateForTest();
  sqlite.prepare("DELETE FROM contacts").run();
  sqlite.prepare("DELETE FROM search_index_queue").run();
  vi.spyOn(embeddings, "resolveEmbeddings").mockReturnValue({
    kind: "provider",
    providerId: "test",
    model: "test",
    dimension: 384,
    signature: "test/test",
  });
  vi.spyOn(embeddings, "embedWithProvider").mockImplementation(
    async (_provider, _model, texts) => texts.map(vector),
  );
  embeddings.setEmbeddingsState({
    signature: "test/test",
    dimension: 384,
    representationVersion: PASSAGE_VERSION,
    generation: "test-generation",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("complete and addressable search evidence", () => {
  it("preserves every character, stable ids and exact Unicode offsets", () => {
    const text = "🧭 café\n".repeat(160);
    contact("one", text);
    const chunks = splitPassage(text);
    const covered = new Set<number>();
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.text.length).toBeLessThanOrEqual(480);
      for (let i = chunk.startOffset; i < chunk.endOffset; i++) covered.add(i);
    }
    expect(covered.size).toBe(text.length);
    expect(passageSnapshot("one")).toEqual(passageSnapshot("one"));
    expect(splitPassage(" ")).toEqual([]);
    expect(splitPassage("x".repeat(2000)).at(-1)?.endOffset).toBe(2000);
  });

  it("retrieves a late fact and binds it to the current source revision", async () => {
    contact();
    const revision = (
      sqlite
        .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
        .get(localOwnerId()) as { revision: number }
    ).revision;
    expect(await embedContact("one")).toEqual({ status: "indexed" });
    expect(
      (
        sqlite
          .prepare("SELECT revision FROM search_revision WHERE ownerId = ?")
          .get(localOwnerId()) as { revision: number }
      ).revision,
    ).toBeGreaterThan(revision);
    const passage = findPassages(scope(), "medieval astronomical clocks")[0];
    expect(passage.startOffset).toBeGreaterThan(500);
    expect(passage.text).toContain("restore medieval astronomical clocks");
    expect(
      selectPassages(scope(), "medieval astronomical clocks", ["one"]).get(
        "one",
      )?.[0].id,
    ).toBe(passage.id);
    expect(
      currentPassage(scope(), "one", passage.id, "astronomical clocks"),
    ).not.toBeNull();
    sqlite
      .prepare("UPDATE contacts SET about = ? WHERE id = 'one'")
      .run(longBio.replace("astronomical clocks", "wooden boats"));
    expect(
      currentPassage(scope(), "one", passage.id, "astronomical clocks"),
    ).toBeNull();
    expect(findPassages(scope(), "astronomical clocks")).toEqual([]);
    await embedContact("one");
    expect(findPassages(scope(), "wooden boats")[0].sourceHash).not.toBe(
      passage.sourceHash,
    );
  });

  it("preserves employment status and invalidates both contacts when a history row moves", async () => {
    contact();
    contact("two");
    history();
    await embedContact("one");
    await embedContact("two");
    const former = findPassages(scope(), "acoustic navigation")[0];
    expect(former.field).toBe("experience");
    expect(former.sourceId).toBe("job-one");
    expect(former.context).toContain("Former employment");
    expect(former.context).toContain("FormerCo");
    sqlite
      .prepare(
        "UPDATE contact_experience SET contactId = 'two' WHERE id = 'job-one'",
      )
      .run();
    expect(findPassages(scope(), "acoustic navigation")).toEqual([]);
    expect(getSearchCoverage(scope()).evidenceIndexed).toBe(0);
    await embedContact("two");
    expect(findPassages(scope(), "acoustic navigation")[0].contactId).toBe(
      "two",
    );
    sqlite
      .prepare(
        "UPDATE contact_experience SET endDate = NULL, isCurrent = 0 WHERE id = 'job-one'",
      )
      .run();
    expect(
      passageSnapshot("two")?.passages.find((p) => p.field === "experience")
        ?.context,
    ).toContain("status unknown");
  });

  it("applies ownership, active state, candidate filters and facets to both indexes", async () => {
    sqlite
      .prepare(
        "INSERT INTO users (id, email, username, displayName, passwordHash, role) VALUES ('other', 'other@example.test', 'other', 'Other', 'x', 'member')",
      )
      .run();
    contact();
    contact("two");
    contact("foreign", longBio, "other");
    for (const id of ["one", "two", "foreign"]) await embedContact(id);
    const q = new Float32Array(vector());
    expect(
      new Set(findPassages(scope(), "astronomical").map((p) => p.contactId)),
    ).toEqual(new Set(["one", "two"]));
    expect(
      new Set(findPassageNeighbors(scope(), q).map((p) => p.contactId)),
    ).toEqual(new Set(["one", "two"]));
    expect(findPassageNeighbors(scope(), q, new Set())).toEqual([]);
    expect(
      new Set(
        findPassageNeighbors(scope(), q, new Set(["two"])).map(
          (p) => p.contactId,
        ),
      ),
    ).toEqual(new Set(["two"]));
    const facets = compileFacets(scope(), [
      { field: "company", value: "OtherCo" },
    ]);
    expect(findPassages(scope(), "astronomical", null, facets)).toEqual([]);
    expect(findPassageNeighbors(scope(), q, null, facets)).toEqual([]);
    for (const assignment of [
      "isArchived = 1",
      "isGhost = 1",
      "deletedAt = '2026-01-01'",
      "canonicalId = 'two'",
    ]) {
      sqlite
        .prepare(`UPDATE contacts SET ${assignment} WHERE id = 'one'`)
        .run();
      expect(
        findPassages(scope(), "astronomical").every(
          (p) => p.contactId === "two",
        ),
      ).toBe(true);
      expect(
        findPassageNeighbors(scope(), q).every((p) => p.contactId === "two"),
      ).toBe(true);
      sqlite
        .prepare(
          "UPDATE contacts SET isArchived = 0, isGhost = 0, deletedAt = NULL, canonicalId = NULL WHERE id = 'one'",
        )
        .run();
    }
    sqlite
      .prepare("UPDATE contacts SET ownerId = 'other' WHERE id = 'one'")
      .run();
    expect(
      findPassages(scope(), "astronomical").every((p) => p.contactId === "two"),
    ).toBe(true);
    sqlite.prepare("DELETE FROM contacts WHERE id = 'two'").run();
    expect(findPassageNeighbors(scope(), q)).toEqual([]);
  });
});

describe("rebuild and source retention", () => {
  it("repairs a different physical vector width when build metadata is missing", async () => {
    contact();
    rebuildSearchEmbeddingTable(16);
    deleteSetting("ai.embeddingsState");
    expect(await ensureEmbeddingStore()).toBe(1);
    expect(
      findPassageNeighbors(scope(), new Float32Array(vector())),
    ).not.toHaveLength(0);
    expect(getSearchCoverage(scope()).indexed).toBe(1);
  });

  it("retains imported source text and rebuilds history evidence after a merge", async () => {
    const imported = contactService.createContact(
      scope(),
      {
        name: "Imported Person",
        about: longBio,
        sources: [
          {
            platform: "archive",
            rawData: JSON.stringify({ biography: longBio }),
            externalId: "original-profile",
          },
        ],
        experience: [
          {
            company: "FormerCo",
            role: "Engineer",
            endDate: "2020-01",
            description: "Designed acoustic navigation systems.",
          },
        ],
      },
      "archive",
    );
    if (!imported) throw new Error("Import did not return a contact");
    contact("survivor", "Primary profile.");
    await embedContact(imported.id);
    const old = findPassages(scope(), "acoustic navigation")[0];
    mergeContacts(scope(), "survivor", imported.id, "passage-test");
    expect(
      currentPassage(scope(), imported.id, old.id, "acoustic navigation"),
    ).toBeNull();
    await embedContact("survivor");
    const next = findPassages(scope(), "acoustic navigation")[0];
    expect(next.contactId).toBe("survivor");
    expect(next.sourceId).toBe(old.sourceId);
    expect(
      buildFullExport(scope()).contacts.find((row) => row.id === "survivor")
        ?.sources[0],
    ).toMatchObject({
      rawData: JSON.stringify({ biography: longBio }),
      externalId: "original-profile",
    });
  });
  it("rejects an edit beyond the old prefix while embedding is in flight", async () => {
    contact();
    let edit = true;
    vi.mocked(embeddings.embedWithProvider).mockImplementation(
      async (_p, _m, texts) => {
        if (edit) {
          edit = false;
          sqlite
            .prepare("UPDATE contacts SET about = ? WHERE id = 'one'")
            .run(longBio + " New fact.");
        }
        return texts.map(vector);
      },
    );
    expect(await embedContact("one")).toEqual({
      status: "outdated",
      reason: "contact_edited",
    });
    expect(getSearchCoverage(scope()).evidenceIndexed).toBe(0);
    expect(await embedContact("one")).toEqual({ status: "indexed" });
  });

  it("rejects an in-flight write from an earlier build generation", async () => {
    contact();
    vi.mocked(embeddings.embedWithProvider).mockImplementation(
      async (_p, _m, texts) => {
        embeddings.setEmbeddingsState({
          signature: "test/test",
          dimension: 384,
          representationVersion: PASSAGE_VERSION,
          generation: "next-generation",
        });
        return texts.map(vector);
      },
    );
    expect((await embedContact("one")).status).toBe("outdated");
    expect(findPassages(scope(), "astronomical")).toEqual([]);
  });

  it("resumes after a partial provider response and only marks complete after every vector succeeds", async () => {
    contact();
    vi.mocked(embeddings.embedWithProvider)
      .mockResolvedValueOnce([vector()])
      .mockResolvedValueOnce([]);
    await expect(backfillSearchEmbeddings()).rejects.toThrow(
      "incomplete passage",
    );
    expect(getSearchCoverage(scope())).toMatchObject({
      evidenceIndexed: 0,
      pending: 1,
    });
    sqlite.prepare("UPDATE search_index_queue SET status = 'processing'").run();
    initSearchIndexQueue();
    expect((await drainIndexQueue({ allowProvider: true })).succeeded).toBe(1);
    expect(getSearchCoverage(scope())).toMatchObject({
      evidenceIndexed: 1,
      pending: 0,
    });
    const calls = vi.mocked(embeddings.embedWithProvider).mock.calls.length;
    expect(await ensureEmbeddingStore()).toBe(0);
    expect(vi.mocked(embeddings.embedWithProvider)).toHaveBeenCalledTimes(
      calls,
    );
  });

  it("rebuilds a changed representation without deleting contacts or source data", async () => {
    contact();
    history();
    await embedContact("one");
    embeddings.setEmbeddingsState({
      signature: "test/test",
      dimension: 384,
      representationVersion: 0,
    });
    expect(await ensureEmbeddingStore()).toBe(1);
    expect(embeddings.getEmbeddingsState()?.representationVersion).toBe(
      PASSAGE_VERSION,
    );
    expect(
      passageSnapshot("one")?.passages.some((p) => p.sourceId === "job-one"),
    ).toBe(true);
    expect(getSearchCoverage(scope()).evidenceIndexed).toBe(1);
  });

  it("keeps full imported text and provenance through JSON export and SQLite backup", async () => {
    contact();
    history();
    const raw = JSON.stringify({
      fullText: longBio,
      origin: "original archive",
    });
    sqlite
      .prepare(
        "INSERT INTO contact_sources (id, contactId, platform, rawData) VALUES ('source', 'one', 'archive', ?)",
      )
      .run(raw);
    await embedContact("one");
    const exported = buildFullExport(scope());
    expect(exported.contacts[0].about).toBe(longBio);
    expect(exported.contacts[0].sources[0]).toMatchObject({ rawData: raw });
    expect(exported.contacts[0].experience[0]).toMatchObject({
      source: "import",
      endDate: "2020-01",
    });
    expect(
      contactRepo.hydrate(
        sqlite.prepare("SELECT * FROM contacts WHERE id = 'one'").get(),
      )!.sources[0],
    ).not.toHaveProperty("rawData");
    const backup = await runBackup();
    expect(backup.verification?.ok).toBe(true);
    const restored = new Database(path.join(BACKUPS_DIR, backup.filename), {
      readonly: true,
    });
    try {
      expect(
        restored.prepare("SELECT about FROM contacts WHERE id = 'one'").get(),
      ).toEqual({ about: longBio });
      expect(
        restored
          .prepare("SELECT rawData FROM contact_sources WHERE id = 'source'")
          .get(),
      ).toEqual({ rawData: raw });
      expect(
        restored
          .prepare(
            "SELECT fingerprint FROM search_passage_state WHERE contactId = 'one'",
          )
          .get(),
      ).toEqual({ fingerprint: passageSnapshot("one")?.fingerprint });
    } finally {
      restored.close();
    }
  });
});

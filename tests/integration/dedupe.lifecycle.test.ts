// =============================================================================
// Integration Tests — a duplicate decision, from merge to undo and back
// =============================================================================
// What happens to a pair after somebody, or something, decides about it:
//
// - An undo keeps the two apart, so the next scan does not merge them again.
// - "Keep separate" has an undo of its own.
// - A merged contact's old link can find the contact it became.
// - No pair waits in the review for a contact that was merged away, and a
//   merge of one says it cannot rather than answering "merged".
// - Every merge answer carries its history row, for an Undo.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite, ensureLocalOwner } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { contactService } from "../../server/services/contactService.ts";
import { dedupeService } from "../../server/services/dedupe/index.ts";
import { dedupeQueue } from "../../server/services/dedupe/jobQueue.ts";
import { storeSuggestion } from "../../server/services/dedupe/suggestions.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import type { MergePreset } from "../../server/services/dedupe/policy.ts";

const app = makeTestApp();
const scope = scopeForOwnerId(ensureLocalOwner());

async function seed(
  contacts: Parameters<typeof contactService.bulkCreateContacts>[1],
): Promise<string[]> {
  const { createdIds } = await contactService.bulkCreateContacts(
    scope,
    contacts,
  );
  return createdIds;
}

function choose(preset: MergePreset): void {
  setPreferences(scope.ownerId, { dedupePreset: preset });
}

async function scan(): Promise<void> {
  const created = dedupeQueue.createScan(scope, "quick");
  await dedupeService.runScan(scope, created.scanId, "quick", "test");
}

function canonicalIdOf(id: string): string | null {
  return (
    (
      sqlite
        .prepare("SELECT canonicalId FROM contacts WHERE id = ?")
        .get(id) as { canonicalId: string | null } | undefined
    )?.canonicalId ?? null
  );
}

function rows() {
  return sqlite
    .prepare(
      `SELECT id, contactIdA, contactIdB, matchType, status
         FROM dedupe_suggestions WHERE ownerId = ? ORDER BY createdAt`,
    )
    .all(scope.ownerId) as {
    id: string;
    contactIdA: string;
    contactIdB: string;
    matchType: string;
    status: string;
  }[];
}

const exclusions = () =>
  (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM dedupe_exclusions WHERE ownerId = ?")
      .get(scope.ownerId) as { n: number }
  ).n;

/** The one merge-history row for a duplicate, not undone. */
const logIdOf = (duplicateId: string) =>
  (
    sqlite
      .prepare(
        "SELECT id FROM dedupe_merge_log WHERE duplicateId = ? AND undoneAt IS NULL",
      )
      .get(duplicateId) as { id: string } | undefined
  )?.id;

beforeEach(() => {
  dedupeQueue.__resetForTests();
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_exclusions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM action_items");
  sqlite.exec("DELETE FROM contacts");
  choose("default");
});
afterEach(() => choose("default"));

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

describe("undoing an automatic merge", () => {
  const pair = [
    { name: "Ada Quill", emails: ["ada@example.com"], company: "Northwind" },
    { name: "Ada Quill", emails: ["ada@example.com"] },
  ];

  it("keeps the two apart, so the next scan does not merge them again", async () => {
    const ids = await seed(pair);
    await scan();
    const duplicate = ids.find((id) => canonicalIdOf(id) !== null)!;
    expect(duplicate).toBeTruthy();

    const undone = await request(app).post(
      `/api/dedupe/merge-log/${logIdOf(duplicate)}/undo`,
    );
    expect(undone.status).toBe(200);
    expect(undone.body.keptSeparate).toBe(true);
    expect(exclusions()).toBe(1);

    await scan();
    expect(ids.map(canonicalIdOf)).toEqual([null, null]);
    // Not merged, and not suggested either: a person said no.
    expect(rows().filter((r) => r.status === "pending")).toEqual([]);
  });

  it("puts the pair back in the review when the browser asks for that", async () => {
    choose("conservative");
    const [primary, duplicate] = await seed(pair);
    const merged = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: primary, duplicateId: duplicate });
    expect(merged.status).toBe(200);
    // The pair a scan had suggested is marked merged with the merge.
    storeSuggestion(
      scope,
      {
        idA: primary,
        idB: duplicate,
        matchType: "email",
        confidence: 0.98,
        reasoning: "Same email address",
      },
      "pending",
    );
    sqlite.prepare("UPDATE dedupe_suggestions SET status = 'merged'").run();

    const undone = await request(app)
      .post(`/api/dedupe/merge-log/${merged.body.mergeLogId}/undo`)
      .send({ keepSeparate: false });
    expect(undone.status).toBe(200);
    expect(undone.body.keptSeparate).toBe(false);
    expect(exclusions()).toBe(0);
    expect(rows().map((r) => r.status)).toEqual(["pending"]);
  });

  it("still lets a person merge two contacts that were kept apart", async () => {
    const ids = await seed(pair);
    await scan();
    const duplicate = ids.find((id) => canonicalIdOf(id) !== null)!;
    await request(app).post(`/api/dedupe/merge-log/${logIdOf(duplicate)}/undo`);
    const primary = ids.find((id) => id !== duplicate)!;

    const again = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: primary, duplicateId: duplicate });
    expect(again.status).toBe(200);
    expect(canonicalIdOf(duplicate)).toBe(primary);
  });

  it("refuses a body it does not know", async () => {
    const res = await request(app)
      .post("/api/dedupe/merge-log/nothing/undo")
      .send({ keepSeparate: "yes" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Keep separate, and its undo
// ---------------------------------------------------------------------------

describe("restoring a pair kept separate", () => {
  async function dismissedPair(): Promise<{ id: string; ids: string[] }> {
    choose("conservative");
    const ids = await seed([
      { name: "Rowan Vale", phones: ["+1 415 555 0142"] },
      { name: "Rowan Vale", phones: ["415-555-0142"] },
    ]);
    await scan();
    const [row] = rows();
    const dismissed = await request(app).post(
      `/api/dedupe/suggestions/${row.id}/dismiss`,
    );
    expect(dismissed.status).toBe(200);
    expect(exclusions()).toBe(1);
    return { id: row.id, ids };
  }

  it("puts it back in the review, and scans see it again", async () => {
    const { id } = await dismissedPair();

    const restored = await request(app).post(
      `/api/dedupe/suggestions/${id}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual({ success: true });
    expect(exclusions()).toBe(0);
    const listed = await request(app).get("/api/dedupe/suggestions");
    expect(listed.body.suggestions.map((s: { id: string }) => s.id)).toEqual([
      id,
    ]);

    const again = await request(app).post(
      `/api/dedupe/suggestions/${id}/restore`,
    );
    expect(again.status).toBe(409);
    const unknown = await request(app).post(
      "/api/dedupe/suggestions/nothing/restore",
    );
    expect(unknown.status).toBe(404);
  });

  it("refuses when one of the two has been merged since", async () => {
    const { id, ids } = await dismissedPair();
    const third = (await seed([{ name: "Rowan Q. Vale" }]))[0];
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: third, duplicateId: ids[0] });

    const restored = await request(app).post(
      `/api/dedupe/suggestions/${id}/restore`,
    );
    expect(restored.status).toBe(409);
    expect(exclusions()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The contact a merged one became
// ---------------------------------------------------------------------------

describe("GET /api/dedupe/merged-into/:contactId", () => {
  it("answers null for a live contact and 404 for an unknown one", async () => {
    const [live] = await seed([{ name: "Imani Kessler" }]);
    const res = await request(app).get(`/api/dedupe/merged-into/${live}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ merge: null });
    const unknown = await request(app).get("/api/dedupe/merged-into/nothing");
    expect(unknown.status).toBe(404);
  });

  it("follows a chain of merges to the contact that is live", async () => {
    const [a, b, c] = await seed([
      { name: "Lena Okafor" },
      { name: "Lena O." },
      { name: "Lena Okafor-Reyes" },
    ]);
    const first = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: b, duplicateId: a });
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: c, duplicateId: b });

    const res = await request(app).get(`/api/dedupe/merged-into/${a}`);
    expect(res.status).toBe(200);
    expect(res.body.merge).toMatchObject({
      mergeLogId: first.body.mergeLogId,
      primaryId: c,
      primaryName: "Lena Okafor-Reyes",
      mergedBy: "user",
    });
    expect(typeof res.body.merge.mergedAt).toBe("string");
  });

  it("says when a check merged it by itself", async () => {
    const [existing] = await seed([
      {
        name: "Tobias Wren",
        emails: ["tobias@example.com"],
        company: "Contoso",
      },
    ]);
    const [added] = await seed([
      { name: "Tobias Wren", emails: ["tobias@example.com"] },
    ]);
    await dedupeService.incrementalDedupeCheck(added, "test");

    const merged = [existing, added].find((id) => canonicalIdOf(id) !== null)!;
    const res = await request(app).get(`/api/dedupe/merged-into/${merged}`);
    expect(res.body.merge.mergedBy).toBe("auto");
    expect(res.body.merge.mergeLogId).toBe(logIdOf(merged));
  });
});

// ---------------------------------------------------------------------------
// No pair waits for a contact that was merged away
// ---------------------------------------------------------------------------

describe("pairs after a merge", () => {
  it("leave the review when a pair's contact merges from its own row", async () => {
    const [a, b, c] = await seed([
      { name: "Gideon Marsh" },
      { name: "Gideon Marsh" },
      { name: "Gideon Marsh" },
    ]);
    const pending = (idA: string, idB: string) =>
      storeSuggestion(
        scope,
        {
          idA,
          idB,
          matchType: "name",
          confidence: 0.9,
          reasoning: "Same name",
        },
        "pending",
      );
    pending(a, b);
    pending(b, c);
    const ab = rows().find(
      (r) =>
        [r.contactIdA, r.contactIdB].sort().join() === [a, b].sort().join(),
    )!;

    const merged = await request(app)
      .post(`/api/dedupe/suggestions/${ab.id}/merge`)
      .send({ primaryId: a });
    expect(merged.status).toBe(200);
    expect(typeof merged.body.mergeLogId).toBe("string");

    // B is hidden now, so B–C is gone, and the review and its badge agree.
    expect(rows().filter((r) => r.status === "pending")).toEqual([]);
    const count = await request(app).get("/api/dedupe/suggestions/count");
    expect(count.body).toEqual({ count: 0, pairs: 0 });
  });

  it("answers 409 for a merge of a contact already merged away", async () => {
    const [a, b, c] = await seed([
      { name: "Felix Dunmore" },
      { name: "Felix Dunmore" },
      { name: "Felix Dunmore" },
    ]);
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: a, duplicateId: b });

    const again = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: c, duplicateId: b });
    expect(again.status).toBe(409);
    expect(canonicalIdOf(b)).toBe(a);
    expect(canonicalIdOf(c)).toBeNull();
  });

  it("are stored against the contact an import merged into", async () => {
    // B holds the email, C the phone. The new X carries both. The cautious
    // preset merges X and B on the email and asks about the phone, and the
    // phone pair is between C and the contact X became, not the hidden X.
    choose("conservative");
    const [b, c] = await seed([
      {
        name: "Hana Ishikawa",
        emails: ["hana@example.com"],
        company: "Wingtip",
        role: "Designer",
        location: "Kyoto",
      },
      { name: "Hana Ishikawa", phones: ["+81 75 555 0101"] },
    ]);
    const [x] = await seed([
      {
        name: "Hana Ishikawa",
        emails: ["hana@example.com"],
        phones: ["075 555 0101"],
      },
    ]);

    const result = await dedupeService.runImportScan(scope, [x], "test");
    expect(result.autoMerged).toBe(1);
    expect(canonicalIdOf(x)).toBe(b);

    const pending = rows().filter((r) => r.status === "pending");
    expect(pending).toHaveLength(1);
    expect([pending[0].contactIdA, pending[0].contactIdB].sort()).toEqual(
      [b, c].sort(),
    );
  });

  it("leave the review while one of their contacts is archived", async () => {
    choose("conservative");
    const [a, b] = await seed([
      { name: "Maya Lindqvist", phones: ["+46 8 555 0123"] },
      { name: "Maya Lindqvist", phones: ["08 555 0123"] },
    ]);
    await scan();
    expect(
      (await request(app).get("/api/dedupe/suggestions/count")).body,
    ).toEqual({ count: 1, pairs: 1 });

    sqlite.prepare("UPDATE contacts SET isArchived = 1 WHERE id = ?").run(b);
    expect(
      (await request(app).get("/api/dedupe/suggestions/count")).body,
    ).toEqual({ count: 0, pairs: 0 });
    const forA = await request(app).get(`/api/dedupe/suggestion-for/${a}`);
    expect(forA.body.suggestion).toBeNull();
  });

  it("keep a note's pair through a scan and a merge", async () => {
    const [contact, one, two] = await seed([
      { name: "Oskar Feld" },
      { name: "Dana Whitfield" },
      { name: "Dana Whitfield" },
    ]);
    const ghost = sqlite
      .prepare(
        `INSERT INTO contacts (id, name, isGhost, ownerId) VALUES (?, ?, 1, ?) RETURNING id`,
      )
      .get("ghost-oskar", "Oskar F.", scope.ownerId) as { id: string };
    storeSuggestion(
      scope,
      {
        idA: contact,
        idB: ghost.id,
        matchType: "mention",
        confidence: 0.8,
        reasoning: 'Mentioned as "Oskar F." in a note',
      },
      "pending",
    );

    // A scan clears the pairs it will write again, and a merge clears the
    // pairs its hidden contact stranded. Neither touches a note's ghost.
    await scan();
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: one, duplicateId: two });

    expect(rows().filter((r) => r.matchType === "mention")).toMatchObject([
      { status: "pending" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// What the answers carry
// ---------------------------------------------------------------------------

describe("what a merge answers", () => {
  it("names its history rows, for an Undo", async () => {
    const [a, b, c, d] = await seed([
      { name: "Elena Marchetti" },
      { name: "Elena Marchetti" },
      { name: "Elena Marchetti" },
      { name: "Elena Marchetti" },
    ]);
    const single = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: a, duplicateId: b });
    expect(single.body.mergeLogId).toBe(logIdOf(b));

    const cluster = await request(app)
      .post("/api/contacts/merge-cluster")
      .send({ primaryId: a, duplicateIds: [c, "nobody"] });
    expect(cluster.body).toMatchObject({ merged: 1, failed: 1 });
    expect(cluster.body.mergeLogIds).toEqual([logIdOf(c)]);

    const many = await request(app)
      .post("/api/contacts/merge-clusters")
      .send({ clusters: [{ primaryId: a, duplicateIds: [d] }] });
    expect(many.body.results[0].mergeLogIds).toEqual([logIdOf(d)]);
  });
});

describe("what the review reads", () => {
  it("carries each contact's open follow-ups and the pair's caveat", async () => {
    choose("conservative");
    const [ada, ben] = await seed([
      { name: "Ada Twin", phones: ["+1 555 0142"] },
      { name: "Ben Twin", phones: ["+1 555 0142"] },
    ]);
    await request(app)
      .post(`/api/contacts/${ada}/action-items`)
      .send({ title: "Send the deck", dueAt: "2030-01-01" });
    await scan();

    const res = await request(app).get("/api/dedupe/suggestions");
    const [suggestion] = res.body.suggestions;
    expect(suggestion.caveat).toBe("First names differ: Ada and Ben");
    expect(suggestion.reasoning).toBe("Same phone number");
    const byId = new Map(
      [suggestion.contactA, suggestion.contactB].map((c) => [c.id, c]),
    );
    expect(byId.get(ada).openFollowUpCount).toBe(1);
    expect(byId.get(ben).openFollowUpCount).toBe(0);
  });

  it("tells two history entries with one name apart by company and city", async () => {
    const [a, b] = await seed([
      { name: "Chris Navarro", company: "Adatum", location: "Boston, MA" },
      {
        name: "Chris Navarro",
        company: "Woodgrove Bank",
        location: "Miami, FL",
      },
    ]);
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: a, duplicateId: b });

    const log = await request(app).get("/api/dedupe/merge-log");
    expect(log.body.entries[0]).toMatchObject({
      primaryName: "Chris Navarro",
      primaryCompany: "Adatum",
      primaryLocation: "Boston, MA",
      duplicateName: "Chris Navarro",
      duplicateCompany: "Woodgrove Bank",
      duplicateLocation: "Miami, FL",
    });
  });

  it("counts groups in the command palette, the way Pulse does", async () => {
    choose("conservative");
    await seed([
      { name: "Morgan Ellery", phones: ["+353 1 555 0100"] },
      { name: "Morgan Ellery", phones: ["01 555 0100"] },
      { name: "Morgan Ellery", phones: ["+353 1 555 0100"] },
    ]);
    await scan();

    const count = await request(app).get("/api/dedupe/suggestions/count");
    expect(count.body.count).toBe(1);
    expect(count.body.pairs).toBe(3);
    const palette = await request(app).get("/api/command-palette/zero-state");
    const insight = palette.body.insights.find(
      (i: { type: string }) => i.type === "dedupe",
    );
    expect(insight).toMatchObject({
      label: "Review 1 possible duplicate",
      count: 1,
    });
  });
});

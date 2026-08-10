// =============================================================================
// Integration: dedupe merge/undo (the data-destructive core), dashboard, MCP
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { softMergeContacts } from "../../server/services/dedupe/merging.ts";

const app = makeTestApp();

interface SlimContact {
  id: string;
  name: string;
  emails?: { email: string }[];
}

async function createContact(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post("/api/contacts").send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function slimContacts(): Promise<SlimContact[]> {
  const res = await request(app).get("/api/contacts?view=slim");
  expect(res.status).toBe(200);
  return res.body as SlimContact[];
}

describe("merge → audit log → undo", () => {
  it("soft-merges a duplicate into a primary, migrating child records", async () => {
    const primaryId = await createContact({
      name: "Robert Merge",
      emails: ["bob@primary.com"],
    });
    const duplicateId = await createContact({
      name: "Bob Merge",
      emails: ["bob@duplicate.com"],
      phones: ["+1 555 0100"],
    });

    const merged = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });
    expect(merged.status).toBe(200);
    expect(merged.body.success).toBe(true);

    // Duplicate disappears from the active list (canonicalId tombstone)...
    const slim = await slimContacts();
    expect(slim.some((c) => c.id === duplicateId)).toBe(false);
    expect(slim.some((c) => c.id === primaryId)).toBe(true);

    // ...and its child records migrated onto the primary.
    const primary = await request(app).get(`/api/contacts/${primaryId}`);
    const emails = primary.body.emails.map((e: { email: string }) => e.email);
    expect(emails).toContain("bob@primary.com");
    expect(emails).toContain("bob@duplicate.com");
    expect(
      primary.body.phones.map((p: { phone: string }) => p.phone),
    ).toContain("+1 555 0100");
  });

  it("hard merges are logged and explicitly NOT undoable (409 contract)", async () => {
    const primaryId = await createContact({ name: "Hard Primary" });
    const duplicateId = await createContact({ name: "Hard Duplicate" });

    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });

    const logRes = await request(app).get("/api/dedupe/merge-log");
    const entry = logRes.body.entries.find(
      (e: { primaryId: string; duplicateId: string }) =>
        e.primaryId === primaryId && e.duplicateId === duplicateId,
    );
    expect(entry).toBeTruthy();
    expect(entry.mergeType).toBe("hard");

    const undo = await request(app).post(
      `/api/dedupe/merge-log/${entry.id}/undo`,
    );
    expect(undo.status).toBe(409);
    expect(undo.body.error.code).toBe("HARD_MERGE_IRREVERSIBLE");
  });

  it("soft merges (auto-merge path) are logged and undoable end-to-end", async () => {
    const primaryId = await createContact({ name: "Undo Primary" });
    const duplicateId = await createContact({
      name: "Undo Duplicate",
      emails: ["undo@example.com"],
    });

    // The soft-merge path is what the scan auto-merger and bulk import use;
    // drive the service directly against the same real database.
    softMergeContacts(primaryId, duplicateId, 0.95, "test auto-merge", "test");

    // Tombstoned out of the active list...
    let slim = await slimContacts();
    expect(slim.some((c) => c.id === duplicateId)).toBe(false);

    const logRes = await request(app).get("/api/dedupe/merge-log");
    const entry = logRes.body.entries.find(
      (e: { primaryId: string; duplicateId: string; mergeType: string }) =>
        e.primaryId === primaryId && e.duplicateId === duplicateId,
    );
    expect(entry).toBeTruthy();
    expect(entry.mergeType).toBe("soft");
    expect(entry.undoneAt).toBeNull();

    const undo = await request(app).post(
      `/api/dedupe/merge-log/${entry.id}/undo`,
    );
    expect(undo.status).toBeLessThan(300);

    // ...and restored to the active list after undo.
    slim = await slimContacts();
    expect(slim.some((c) => c.id === duplicateId)).toBe(true);
  });

  it("rejects self-merge and missing ids", async () => {
    const id = await createContact({ name: "Self Merge" });

    const self = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: id, duplicateId: id });
    expect(self.status).toBe(400);

    const missing = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: id });
    expect(missing.status).toBe(400);
  });
});

describe("dashboard + zero state + MCP", () => {
  it("serves the dashboard payload with metrics", async () => {
    await createContact({ name: "Dashboard Contact" });
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalActive).toBeGreaterThanOrEqual(1);
  });

  it("serves the command-palette zero state", async () => {
    const res = await request(app).get("/api/command-palette/zero-state");
    expect(res.status).toBe(200);
  });

  it("serves MCP contact queries with a capped limit", async () => {
    await createContact({ name: "MCP Contact" });
    const res = await request(app).get("/api/query/contacts?limit=999999999");
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Cluster merges from overlapping suggestions — the select-all path
// =============================================================================
// The review queue groups pairwise suggestions into clusters. Merging a
// cluster used to walk its SUGGESTIONS one by one under the cluster's chosen
// primary — but a pair like (B,C) does not contain primary A, and the server
// silently treated A as "not contactIdA, so contactIdA must be the
// duplicate", re-merging a tombstoned contact. Select-all reliably failed.
// These tests pin the correct path (merge-cluster) and the server guard.

describe("cluster merge from overlapping suggestions", () => {
  /** Seed a pending suggestion directly — scans are not under test here. */
  const seedSuggestion = (idA: string, idB: string): string => {
    const id = `sugg-${idA}-${idB}`;
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO dedupe_suggestions
           (id, contactIdA, contactIdB, matchType, confidence, reasoning, matchedField, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(id, idA, idB, "name", 0.9, "test", "name");
    return id;
  };

  const pendingCount = (): number =>
    (
      sqlite
        .prepare(
          "SELECT COUNT(*) n FROM dedupe_suggestions WHERE status = 'pending'",
        )
        .get() as { n: number }
    ).n;

  it("rejects a suggestion merge whose primary is not part of the pair", async () => {
    const a = await createContact({ name: "Overlap A" });
    const b = await createContact({ name: "Overlap B" });
    const c = await createContact({ name: "Overlap C" });
    const suggestionBC = seedSuggestion(b, c);

    // The old behaviour: primary A (not in the pair) silently picked B as
    // the duplicate. It must refuse instead.
    const res = await request(app)
      .post(`/api/dedupe/suggestions/${suggestionBC}/merge`)
      .send({ primaryId: a });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/must be one of the suggestion/i);

    // Nothing merged, suggestion untouched.
    const contacts = await slimContacts();
    expect(contacts.map((x) => x.id)).toEqual(
      expect.arrayContaining([a, b, c]),
    );
  });

  it("merges an overlapping cluster in one call and clears its suggestions", async () => {
    const a = await createContact({ name: "Cluster A" });
    const b = await createContact({ name: "Cluster B" });
    const c = await createContact({ name: "Cluster C" });
    // The overlapping shape select-all produces: (A,B) and (B,C) → one
    // 3-contact cluster with best primary A.
    seedSuggestion(a, b);
    seedSuggestion(b, c);
    const before = pendingCount();
    expect(before).toBeGreaterThanOrEqual(2);

    const res = await request(app)
      .post("/api/contacts/merge-cluster")
      .send({ primaryId: a, duplicateIds: [b, c] });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(2);
    expect(res.body.failed).toBe(0);

    // Both duplicates are tombstoned into A…
    const active = await slimContacts();
    const activeIds = active.map((x) => x.id);
    expect(activeIds).toContain(a);
    expect(activeIds).not.toContain(b);
    expect(activeIds).not.toContain(c);

    // …and the satisfied suggestions left the pending queue, so the review
    // queue cannot offer pairs that no longer exist as separate contacts.
    expect(pendingCount()).toBe(before - 2);
  });

  it("clears stranded suggestions after a batch merge too", async () => {
    const a = await createContact({ name: "Batch A" });
    const b = await createContact({ name: "Batch B" });
    const c = await createContact({ name: "Batch C" });
    seedSuggestion(a, b);
    seedSuggestion(b, c); // stranded once B merges

    const res = await request(app)
      .post("/api/contacts/merge-batch")
      .send({ merges: [{ primaryId: a, duplicateId: b }] });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(1);

    // The (B,C) suggestion references a tombstone now — it must be gone.
    const stranded = sqlite
      .prepare(
        "SELECT COUNT(*) n FROM dedupe_suggestions WHERE status = 'pending' AND (contactIdA = ? OR contactIdB = ?)",
      )
      .get(b, b) as { n: number };
    expect(stranded.n).toBe(0);
  });
});

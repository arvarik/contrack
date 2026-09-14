// =============================================================================
// Integration: dedupe merge/undo (the data-destructive core), dashboard, MCP
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { softMergeContacts } from "../../server/services/dedupe/merging.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();

/**
 * Merging takes a scope since 2e. Auth is off in this file, so every row
 * belongs to the local owner account, which is the same owner the routes read
 * out of `scopeOf(req)`.
 */
const scope = () => scopeForOwnerId(localOwnerId());

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
    softMergeContacts(
      scope(),
      primaryId,
      duplicateId,
      0.95,
      "test auto-merge",
      "test",
    );

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

// =============================================================================
// Follow-up tasks survive a merge
// =============================================================================
// `action_items.contactId` references `contacts.id` with ON DELETE CASCADE.
// A hard merge re-parented eleven kinds of child row and then deleted the
// duplicate, and tasks were not one of the eleven, so the database removed
// every follow-up the duplicate carried. One task became zero, silently. The
// soft-merge path left the rows in place, on a contact nobody can open.
//
// The cache is checked beside the rows. `contacts.nextFollowUpAt` is
// MIN(dueAt) of the pending tasks, kept by trigger, and a merge that moved the
// rows without the survivor's cache following them would show the task on the
// contact and never on the dashboard.

interface TaskRow {
  id: string;
  contactId: string;
  ownerId: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
}

/** Every task in the account, whichever contact it hangs off. */
function allTasks(): TaskRow[] {
  return sqlite
    .prepare(
      `SELECT id, contactId, ownerId, title, dueAt, completedAt
         FROM action_items WHERE ownerId = ? ORDER BY dueAt, title`,
    )
    .all(localOwnerId()) as TaskRow[];
}

function nextFollowUpOf(contactId: string): string | null {
  const row = sqlite
    .prepare("SELECT nextFollowUpAt FROM contacts WHERE id = ?")
    .get(contactId) as { nextFollowUpAt: string | null } | undefined;
  return row?.nextFollowUpAt ?? null;
}

async function createTask(
  contactId: string,
  title: string,
  dueAt: string,
): Promise<string> {
  const res = await request(app)
    .post(`/api/contacts/${contactId}/action-items`)
    .send({ title, dueAt });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function completeTask(id: string): Promise<void> {
  const res = await request(app).patch(`/api/action-items/${id}/complete`);
  expect(res.status).toBe(200);
}

describe("a merge keeps the duplicate's follow-up tasks", () => {
  it("moves a pending task onto the primary in a hard merge", async () => {
    const primaryId = await createContact({ name: "Task Primary" });
    const duplicateId = await createContact({ name: "Task Duplicate" });
    const taskId = await createTask(
      duplicateId,
      "Send the proposal",
      "2027-03-01T09:00:00.000Z",
    );
    expect(nextFollowUpOf(duplicateId)).toBe("2027-03-01T09:00:00.000Z");
    expect(nextFollowUpOf(primaryId)).toBeNull();

    const merged = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });
    expect(merged.status).toBe(200);

    // The row is still there, and it hangs off the survivor now. Before this
    // the count here was zero: the FOREIGN KEY cascade took it with the
    // duplicate.
    const tasks = allTasks().filter((t) => t.id === taskId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].contactId).toBe(primaryId);
    expect(tasks[0].completedAt).toBeNull();

    // The survivor's cache followed the row, so the dashboard sees it.
    expect(nextFollowUpOf(primaryId)).toBe("2027-03-01T09:00:00.000Z");
    expect(merged.body.contact.nextFollowUpAt).toBe("2027-03-01T09:00:00.000Z");

    // And the API agrees with the table.
    const listed = await request(app).get(
      `/api/contacts/${primaryId}/action-items`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.map((t: TaskRow) => t.id)).toEqual([taskId]);
  });

  it("recomputes the survivor's next follow-up as the earliest pending task of both", async () => {
    const primaryId = await createContact({ name: "Earliest Primary" });
    const duplicateId = await createContact({ name: "Earliest Duplicate" });
    const later = await createTask(
      primaryId,
      "Quarterly check-in",
      "2027-06-01T09:00:00.000Z",
    );
    const sooner = await createTask(
      duplicateId,
      "Return the call",
      "2027-04-01T09:00:00.000Z",
    );
    // A completed task moves too, and it does not count towards the cache.
    const done = await createTask(
      duplicateId,
      "Already done",
      "2027-01-01T09:00:00.000Z",
    );
    await completeTask(done);
    expect(nextFollowUpOf(primaryId)).toBe("2027-06-01T09:00:00.000Z");

    const merged = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });
    expect(merged.status).toBe(200);

    const mine = allTasks().filter((t) => t.contactId === primaryId);
    expect(mine.map((t) => t.id).sort()).toEqual([done, later, sooner].sort());
    expect(mine.find((t) => t.id === done)?.completedAt).not.toBeNull();

    // MIN over the pending rows of both contacts, which is the duplicate's.
    expect(nextFollowUpOf(primaryId)).toBe("2027-04-01T09:00:00.000Z");
    expect(nextFollowUpOf(duplicateId)).toBeNull();
  });

  it("moves the tasks in a soft merge too, and clears the tombstone's cache", async () => {
    const primaryId = await createContact({ name: "Soft Task Primary" });
    const duplicateId = await createContact({ name: "Soft Task Duplicate" });
    const taskId = await createTask(
      duplicateId,
      "Book the venue",
      "2027-05-01T09:00:00.000Z",
    );

    softMergeContacts(
      scope(),
      primaryId,
      duplicateId,
      0.95,
      "test auto-merge with a task",
      "test",
    );

    const task = allTasks().find((t) => t.id === taskId);
    expect(task?.contactId).toBe(primaryId);
    expect(nextFollowUpOf(primaryId)).toBe("2027-05-01T09:00:00.000Z");
    // The tombstone keeps no pending tasks, so its cache says so. A stale
    // date here would surface the moment the merge is undone.
    expect(nextFollowUpOf(duplicateId)).toBeNull();

    // The pending list shows the task once, under the survivor.
    const pending = await request(app).get("/api/action-items");
    expect(pending.status).toBe(200);
    const rows = pending.body.filter((t: TaskRow) => t.id === taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0].contactId).toBe(primaryId);
    expect(rows[0].contactName).toBe("Soft Task Primary");
  });

  it("settles both caches when a task is re-parented by any path", async () => {
    // The sync trigger recomputed the contact a task moved TO and forgot the
    // one it moved FROM. The merge recomputes both itself, so this drives the
    // trigger on its own with a bare UPDATE, the way any other writer would.
    const fromId = await createContact({ name: "Trigger From" });
    const toId = await createContact({ name: "Trigger To" });
    const taskId = await createTask(fromId, "Moves by itself", "2027-07-01");
    expect(nextFollowUpOf(fromId)).toBe("2027-07-01");

    sqlite
      .prepare("UPDATE action_items SET contactId = ? WHERE id = ?")
      .run(toId, taskId);

    expect(nextFollowUpOf(toId)).toBe("2027-07-01");
    expect(nextFollowUpOf(fromId)).toBeNull();
  });

  it("keeps a task the primary already had, and never deletes one", async () => {
    const primaryId = await createContact({ name: "Both Primary" });
    const duplicateId = await createContact({ name: "Both Duplicate" });
    // The same title and the same date on both sides. Two commitments that
    // look alike are still two commitments: a merge moves rows, it does not
    // decide which of somebody's tasks to keep.
    const a = await createTask(primaryId, "Follow up", "2027-02-01");
    const b = await createTask(duplicateId, "Follow up", "2027-02-01");

    const merged = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });
    expect(merged.status).toBe(200);

    const mine = allTasks().filter((t) => t.contactId === primaryId);
    expect(mine.map((t) => t.id).sort()).toEqual([a, b].sort());
    expect(nextFollowUpOf(primaryId)).toBe("2027-02-01");
  });
});

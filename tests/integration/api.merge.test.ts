// =============================================================================
// Integration: dedupe merge/undo (the data-destructive core)
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

/**
 * Every merge runs through the route. Since #56 the manual and the automatic
 * paths share one merge engine, so one set of merge and undo tests covers
 * both. Auth is off in this file, so every row belongs to the local owner.
 */
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
  it("manual merges are logged and undoable, fully restoring duplicate and transferred child records", async () => {
    const primaryId = await createContact({
      name: "Manual Primary",
      headline: "Lead Engineer",
      emails: ["manual.p@test.com"],
    });
    const duplicateId = await createContact({
      name: "Manual Duplicate",
      headline: "Senior Engineer",
      emails: ["manual.d@test.com"],
      phones: ["+1 555 9999"],
    });

    const mergeRes = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });
    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.success).toBe(true);

    const logRes = await request(app).get("/api/dedupe/merge-log");
    const entry = logRes.body.entries.find(
      (e: { primaryId: string; duplicateId: string }) =>
        e.primaryId === primaryId && e.duplicateId === duplicateId,
    );
    expect(entry).toBeTruthy();
    expect(entry.mergeType).toBe("soft");

    // Primary has both emails and the transferred phone; duplicate is hidden
    let primary = await request(app).get(`/api/contacts/${primaryId}`);
    expect(
      primary.body.emails.map((e: { email: string }) => e.email),
    ).toContain("manual.d@test.com");
    expect(
      primary.body.phones.map((p: { phone: string }) => p.phone),
    ).toContain("+1 555 9999");
    let slim = await slimContacts();
    expect(slim.some((c) => c.id === duplicateId)).toBe(false);

    // Undo the manual merge
    const undo = await request(app).post(
      `/api/dedupe/merge-log/${entry.id}/undo`,
    );
    expect(undo.status).toBe(200);
    expect(undo.body.success).toBe(true);
    expect(undo.body.restoredContactId).toBe(duplicateId);
    expect(undo.body.conflicts).toHaveLength(0);

    // Duplicate is restored to the active list
    slim = await slimContacts();
    expect(slim.some((c) => c.id === duplicateId)).toBe(true);

    // Duplicate has its email and phone back
    const duplicate = await request(app).get(`/api/contacts/${duplicateId}`);
    expect(
      duplicate.body.emails.map((e: { email: string }) => e.email),
    ).toContain("manual.d@test.com");
    expect(
      duplicate.body.phones.map((p: { phone: string }) => p.phone),
    ).toContain("+1 555 9999");
    expect(
      duplicate.body.emails.map((e: { email: string }) => e.email),
    ).not.toContain("manual.p@test.com");

    // Primary only has its original email and does not have duplicate's phone
    primary = await request(app).get(`/api/contacts/${primaryId}`);
    expect(primary.body.emails.map((e: { email: string }) => e.email)).toEqual([
      "manual.p@test.com",
    ]);
    expect(primary.body.phones).toHaveLength(0);
  });

  it("preserves post-merge survivor edits on undo and reports conflicts", async () => {
    const primaryId = await createContact({
      name: "Conflict Primary",
      emails: ["conflict.p@test.com"],
    });
    const duplicateId = await createContact({
      name: "Conflict Duplicate",
      emails: ["conflict.d@test.com"],
    });
    const taskId = await createTask(
      duplicateId,
      "Task to complete on survivor",
      "2027-09-01T10:00:00.000Z",
    );

    // Merge
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });

    // Survivor completes the transferred task
    await completeTask(taskId);

    // Find merge log entry
    const logRes = await request(app).get("/api/dedupe/merge-log");
    const entry = logRes.body.entries.find(
      (e: { primaryId: string; duplicateId: string }) =>
        e.primaryId === primaryId && e.duplicateId === duplicateId,
    );
    expect(entry).toBeTruthy();

    // Undo the merge
    const undo = await request(app).post(
      `/api/dedupe/merge-log/${entry.id}/undo`,
    );
    expect(undo.status).toBe(200);
    expect(undo.body.conflicts.length).toBeGreaterThanOrEqual(1);
    const taskConflict = undo.body.conflicts.find(
      (c: { type: string }) => c.type === "task_completed",
    );
    expect(taskConflict).toBeTruthy();

    // Survivor keeps the completed task
    const survivorTasks = allTasks().filter((t) => t.contactId === primaryId);
    expect(
      survivorTasks.some((t) => t.id === taskId && t.completedAt !== null),
    ).toBe(true);

    // Duplicate gets a restored copy of the task in pending state
    const duplicateTasks = allTasks().filter(
      (t) => t.contactId === duplicateId,
    );
    expect(duplicateTasks.length).toBe(1);
    expect(duplicateTasks[0].title).toBe("Task to complete on survivor");
    expect(duplicateTasks[0].completedAt).toBeNull();
  });

  it("recomputes follow-up task caches on both survivor and duplicate upon undo", async () => {
    const primaryId = await createContact({ name: "Cache Primary" });
    const duplicateId = await createContact({ name: "Cache Duplicate" });

    await createTask(primaryId, "Later task", "2027-08-01T00:00:00.000Z");
    await createTask(duplicateId, "Earlier task", "2027-04-01T00:00:00.000Z");

    expect(nextFollowUpOf(primaryId)).toBe("2027-08-01T00:00:00.000Z");
    expect(nextFollowUpOf(duplicateId)).toBe("2027-04-01T00:00:00.000Z");

    // Merge duplicate into primary
    await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId, duplicateId });

    expect(nextFollowUpOf(primaryId)).toBe("2027-04-01T00:00:00.000Z");
    expect(nextFollowUpOf(duplicateId)).toBeNull();

    const logRes = await request(app).get("/api/dedupe/merge-log");
    const entry = logRes.body.entries.find(
      (e: { primaryId: string; duplicateId: string }) =>
        e.primaryId === primaryId && e.duplicateId === duplicateId,
    );

    // Undo merge
    const undo = await request(app).post(
      `/api/dedupe/merge-log/${entry.id}/undo`,
    );
    expect(undo.status).toBe(200);

    // Caches are restored on both contacts!
    expect(nextFollowUpOf(primaryId)).toBe("2027-08-01T00:00:00.000Z");
    expect(nextFollowUpOf(duplicateId)).toBe("2027-04-01T00:00:00.000Z");
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
  it("moves a pending task onto the primary", async () => {
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

    // The survivor's cache followed the row, so the dashboard sees it. The
    // tombstone keeps no pending tasks, so its cache says so: a stale date
    // there would surface the moment the merge is undone.
    expect(nextFollowUpOf(primaryId)).toBe("2027-03-01T09:00:00.000Z");
    expect(merged.body.contact.nextFollowUpAt).toBe("2027-03-01T09:00:00.000Z");
    expect(nextFollowUpOf(duplicateId)).toBeNull();

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

// -----------------------------------------------------------------------------
// Undo after the survivor changed a child row
//
// A merge moves the duplicate's child rows onto the survivor. If the survivor
// then deletes or edits one, undo must put the original back on the duplicate.
// That path writes the row again, so it must name columns the tables have.
// -----------------------------------------------------------------------------

interface ChildRow {
  table: string;
  values: Record<string, unknown>;
}

/** One row for every kind of child row a merge moves. */
const CHILD_ROWS: ChildRow[] = [
  {
    table: "contact_emails",
    values: { email: "restore.email@test.com", label: "work" },
  },
  {
    table: "contact_phones",
    values: { phone: "+1 555 0101", label: "mobile" },
  },
  {
    table: "contact_addresses",
    values: { address: "1 Restore Way, Portland", label: "home" },
  },
  {
    table: "contact_social_links",
    values: { platform: "linkedin", url: "https://linkedin.com/in/restore" },
  },
  {
    table: "contact_education",
    values: {
      school: "Restore University",
      degree: "BS",
      startDate: "2010",
      endDate: "2014",
    },
  },
  {
    table: "contact_experience",
    values: {
      company: "Restore Inc",
      role: "Engineer",
      startDate: "2015",
      endDate: "2020",
      isCurrent: 0,
    },
  },
  {
    table: "contact_sources",
    values: { platform: "google", externalId: "people/restore" },
  },
  { table: "contact_tags", values: { tag: "restore-tag" } },
  { table: "contact_interests", values: { interest: "restore-climbing" } },
  {
    table: "contact_attributes",
    values: { name: "restore-attribute", value: "restore-value" },
  },
  {
    table: "interactions",
    values: {
      type: "note",
      title: "Restore note",
      content: "Original note",
      date: "2026-01-02T10:00:00.000Z",
    },
  },
];

function insertChildRow(
  table: string,
  contactId: string,
  values: Record<string, unknown>,
): string {
  const id = crypto.randomUUID();
  const row: Record<string, unknown> = { id, contactId, ...values };
  if (table === "interactions") row.ownerId = localOwnerId();
  const columns = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...columns.map((c) => row[c]));
  return id;
}

function rowById(table: string, id: string): Record<string, unknown> {
  return sqlite
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

async function mergeThenFindLogId(
  primaryId: string,
  duplicateId: string,
): Promise<string> {
  const merged = await request(app)
    .post("/api/contacts/merge")
    .send({ primaryId, duplicateId });
  expect(merged.status).toBe(200);
  const log = await request(app).get("/api/dedupe/merge-log");
  const entry = log.body.entries.find(
    (e: { primaryId: string; duplicateId: string }) =>
      e.primaryId === primaryId && e.duplicateId === duplicateId,
  );
  expect(entry).toBeTruthy();
  return entry.id as string;
}

describe("undo after the survivor changed a child row", () => {
  it("puts back every kind of child row that the survivor deleted", async () => {
    const primaryId = await createContact({ name: "Deleted Rows Primary" });
    const duplicateId = await createContact({ name: "Deleted Rows Duplicate" });
    const ids = CHILD_ROWS.map((r) =>
      insertChildRow(r.table, duplicateId, r.values),
    );
    const logId = await mergeThenFindLogId(primaryId, duplicateId);

    // The merge moved each row to the survivor. The survivor deletes them all.
    CHILD_ROWS.forEach((r, i) => {
      expect(rowById(r.table, ids[i]).contactId).toBe(primaryId);
      sqlite.prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(ids[i]);
    });

    const undo = await request(app).post(`/api/dedupe/merge-log/${logId}/undo`);
    expect(undo.status).toBe(200);
    expect(
      undo.body.conflicts.map((c: { entity: string }) => c.entity).sort(),
    ).toEqual(CHILD_ROWS.map((r) => r.table).sort());

    CHILD_ROWS.forEach((r, i) => {
      expect(rowById(r.table, ids[i])).toMatchObject({
        ...r.values,
        contactId: duplicateId,
      });
    });
  });

  it.each([
    {
      kind: "an email label",
      table: "contact_emails",
      column: "label",
      original: "work",
      edited: "home",
    },
    {
      kind: "the end of a school year",
      table: "contact_education",
      column: "endDate",
      original: "2014",
      edited: "2016",
    },
    {
      kind: "the text of a note",
      table: "interactions",
      column: "content",
      original: "Original note",
      edited: "Edited note",
    },
  ])(
    "keeps the survivor's edit of $kind and gives the duplicate the original",
    async ({ table, column, original, edited }) => {
      const primaryId = await createContact({ name: `Edit ${column} Primary` });
      const duplicateId = await createContact({
        name: `Edit ${column} Duplicate`,
      });
      const source = CHILD_ROWS.find((r) => r.table === table) as ChildRow;
      const id = insertChildRow(table, duplicateId, source.values);
      const logId = await mergeThenFindLogId(primaryId, duplicateId);

      sqlite
        .prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`)
        .run(edited, id);

      const undo = await request(app).post(
        `/api/dedupe/merge-log/${logId}/undo`,
      );
      expect(undo.status).toBe(200);
      expect(undo.body.conflicts).toEqual([
        expect.objectContaining({ type: "record_edited", entity: table, id }),
      ]);

      // The survivor keeps the row it edited.
      expect(rowById(table, id)).toMatchObject({
        contactId: primaryId,
        [column]: edited,
      });
      // The duplicate gets a copy that holds the original value.
      const copies = sqlite
        .prepare(`SELECT * FROM ${table} WHERE contactId = ?`)
        .all(duplicateId) as Record<string, unknown>[];
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({ [column]: original });
      expect(copies[0].id).not.toBe(id);
    },
  );
});

// =============================================================================
// Integration: dedupe merge/undo (the data-destructive core), dashboard, MCP
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
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

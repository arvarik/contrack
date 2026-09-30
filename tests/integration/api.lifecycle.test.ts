// =============================================================================
// Integration: data lifecycle — trash/restore/purge, backups, full export
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { contactService } from "../../server/services/contactService.ts";

const app = makeTestApp();

async function createContact(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post("/api/contacts").send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("trash: soft delete → restore", () => {
  it("DELETE moves a contact to trash instead of destroying it", async () => {
    const id = await createContact({
      name: "Trash Candidate",
      emails: ["trash@example.com"],
    });

    const del = await request(app).delete(`/api/contacts/${id}`);
    expect(del.status).toBe(200);

    // Gone from every active surface...
    const byId = await request(app).get(`/api/contacts/${id}`);
    expect(byId.status).toBe(404);
    const slim = await request(app).get("/api/contacts?view=slim");
    expect(slim.body.some((c: { id: string }) => c.id === id)).toBe(false);
    const archived = await request(app).get("/api/contacts/archived");
    expect(archived.body.some((c: { id: string }) => c.id === id)).toBe(false);
    const search = await request(app).get("/api/search?q=Trash");
    expect(search.body.some((c: { id: string }) => c.id === id)).toBe(false);

    // ...but present in the trash with its row intact.
    const trash = await request(app).get("/api/trash");
    const item = trash.body.items.find((t: { id: string }) => t.id === id);
    expect(item).toBeTruthy();
    expect(item.deletedAt).toBeTruthy();
  });

  it("restore brings the contact back, searchable again", async () => {
    const id = await createContact({ name: "Phoenix Restored" });
    await request(app).delete(`/api/contacts/${id}`);

    const restored = await request(app).post(`/api/trash/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.name).toBe("Phoenix Restored");

    const byId = await request(app).get(`/api/contacts/${id}`);
    expect(byId.status).toBe(200);

    // FTS row reinserted by the trash-aware update trigger.
    const search = await request(app).get("/api/search?q=Phoenix");
    expect(search.body.some((c: { id: string }) => c.id === id)).toBe(true);

    // No longer in the trash.
    const trash = await request(app).get("/api/trash");
    expect(trash.body.items.some((t: { id: string }) => t.id === id)).toBe(
      false,
    );
  });

  it("bulk restore is the undo path for a bulk delete", async () => {
    const a = await createContact({ name: "Undo Alpha" });
    const b = await createContact({ name: "Undo Beta" });

    await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [a, b] })
      .expect(200);
    // A bulk delete uses the same trash as a single one.
    expect((await request(app).get(`/api/contacts/${a}`)).status).toBe(404);
    const trash = await request(app).get("/api/trash");
    const trashedIds = trash.body.items.map((t: { id: string }) => t.id);
    expect(trashedIds).toEqual(expect.arrayContaining([a, b]));

    const undo = await request(app)
      .post("/api/trash/bulk-restore")
      .send({ ids: [a, b] });
    expect(undo.status).toBe(200);
    expect(undo.body.count).toBe(2);

    expect((await request(app).get(`/api/contacts/${a}`)).status).toBe(200);
    expect((await request(app).get(`/api/contacts/${b}`)).status).toBe(200);
  });

  it("bulk restore skips ids that are not in the trash rather than failing", async () => {
    // Undo has to be forgiving: a double-tap, or a batch where one contact was
    // already restored by hand, must not throw away the rest of the recovery.
    const trashed = await createContact({ name: "Half Restored" });
    const untouched = await createContact({ name: "Still Here" });
    await request(app).delete(`/api/contacts/${trashed}`);

    const res = await request(app)
      .post("/api/trash/bulk-restore")
      .send({ ids: [trashed, untouched, "does-not-exist"] });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect((await request(app).get(`/api/contacts/${trashed}`)).status).toBe(
      200,
    );
  });

  it("bulk restore rejects an empty id list", async () => {
    const res = await request(app)
      .post("/api/trash/bulk-restore")
      .send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it("restore of a non-trashed contact 404s", async () => {
    const id = await createContact({ name: "Never Deleted" });
    const res = await request(app).post(`/api/trash/${id}/restore`);
    expect(res.status).toBe(404);
  });
});

describe("trash: permanent purge", () => {
  it("DELETE /api/trash/:id hard-deletes a trashed contact", async () => {
    const id = await createContact({ name: "Purge Me" });
    await request(app).delete(`/api/contacts/${id}`);

    const purge = await request(app).delete(`/api/trash/${id}`);
    expect(purge.status).toBe(200);

    const row = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(id);
    expect(row).toBeUndefined();
  });

  it("refuses to purge an active contact", async () => {
    const id = await createContact({ name: "Still Active" });
    const res = await request(app).delete(`/api/trash/${id}`);
    expect(res.status).toBe(404);

    const row = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  it("purgeExpiredTrash removes only entries past the retention window", async () => {
    const oldId = await createContact({ name: "Ancient Trash" });
    const newId = await createContact({ name: "Fresh Trash" });
    await request(app).delete(`/api/contacts/${oldId}`);
    await request(app).delete(`/api/contacts/${newId}`);

    // Backdate the old one beyond the 30-day window.
    sqlite
      .prepare("UPDATE contacts SET deletedAt = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", oldId);

    const purged = contactService.purgeExpiredTrash(30);
    expect(purged).toBeGreaterThanOrEqual(1);

    expect(
      sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(oldId),
    ).toBeUndefined();
    expect(
      sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(newId),
    ).toBeTruthy();
  });
});

describe("backups", () => {
  it("takes a snapshot on demand and lists it", async () => {
    await createContact({ name: "Backed Up" });

    const created = await request(app).post("/api/backups");
    expect(created.status).toBe(201);
    expect(created.body.filename).toMatch(/^curator-.*\.db$/);
    expect(created.body.sizeBytes).toBeGreaterThan(0);

    const list = await request(app).get("/api/backups");
    expect(
      list.body.backups.some(
        (b: { filename: string }) => b.filename === created.body.filename,
      ),
    ).toBe(true);

    // The snapshot is a real SQLite file on disk in DATA_DIR/backups.
    const file = path.join(
      process.env.DATA_DIR!,
      "backups",
      created.body.filename,
    );
    expect(fs.existsSync(file)).toBe(true);
    const header = fs.readFileSync(file).subarray(0, 16).toString("utf8");
    expect(header.startsWith("SQLite format 3")).toBe(true);
  });
});

describe("full export", () => {
  it("exports the entire database as downloadable JSON", async () => {
    const id = await createContact({
      name: "Export Subject",
      emails: ["export@example.com"],
    });
    await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "note", title: "Exported note" });

    const res = await request(app).get("/api/export/json");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");

    const payload = JSON.parse(res.text);
    expect(payload.version).toBe(1);
    expect(payload.contacts.some((c: { id: string }) => c.id === id)).toBe(
      true,
    );
    expect(
      payload.interactions.some(
        (i: { title: string }) => i.title === "Exported note",
      ),
    ).toBe(true);
  });

  it("exports a well-formed contacts CSV with escaping", async () => {
    await createContact({
      name: "Comma, Inc Person",
      company: 'Quotes "R" Us, LLC',
    });

    const res = await request(app).get("/api/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const lines = res.text.split("\r\n");
    expect(lines[0]).toContain("Name,First Name,Last Name,Company");
    expect(res.text).toContain('"Comma, Inc Person"');
    expect(res.text).toContain('"Quotes ""R"" Us, LLC"');
  });

  it("leaves ghosts and merged-away contacts out of the CSV, like the vCard file", async () => {
    // A ghost is a name pulled out of a note, not a contact of its own.
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, isGhost)
         SELECT 'ghost-csv', ownerId, 'Ghost Csv Person', 1 FROM contacts LIMIT 1`,
      )
      .run();
    // After a merge the kept contact holds both, so the other row would be
    // the same person twice.
    const kept = await createContact({
      name: "Kept Csv Person",
      emails: ["kept@csv.example"],
    });
    const mergedAway = await createContact({
      name: "Merged Csv Person",
      emails: ["gone@csv.example"],
    });
    const merge = await request(app)
      .post("/api/contacts/merge")
      .send({ primaryId: kept, duplicateId: mergedAway });
    expect(merge.status).toBe(200);

    const res = await request(app).get("/api/export/csv");
    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Ghost Csv Person");
    expect(res.text).not.toContain("Merged Csv Person");
    const keptRow = res.text
      .split("\r\n")
      .find((line) => line.startsWith("Kept Csv Person,"));
    expect(keptRow).toContain("gone@csv.example");
  });
});

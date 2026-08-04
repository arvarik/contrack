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

  it("restore of a non-trashed contact 404s", async () => {
    const id = await createContact({ name: "Never Deleted" });
    const res = await request(app).post(`/api/trash/${id}/restore`);
    expect(res.status).toBe(404);
  });

  it("bulk delete uses the same trash semantics", async () => {
    const a = await createContact({ name: "Bulk Trash A" });
    const b = await createContact({ name: "Bulk Trash B" });

    await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [a, b] });

    const trash = await request(app).get("/api/trash");
    const trashedIds = trash.body.items.map((t: { id: string }) => t.id);
    expect(trashedIds).toContain(a);
    expect(trashedIds).toContain(b);
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
});

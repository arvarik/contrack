// Integration: data lifecycle — trash/restore/purge, backups, full export

import { afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { contactService } from "../../server/services/contactService.ts";
import { sweepOrphanUploads } from "../../server/services/uploadCleanup.ts";
import { resolveUploadPath } from "../../server/utils/paths.ts";

const app = makeTestApp();

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Give a contact a photo, and answer the photo's URL. */
async function addPhoto(id: string): Promise<string> {
  const res = await request(app)
    .post(`/api/contacts/${id}/avatar`)
    .attach("avatar", PNG_1X1, "photo.png");
  expect(res.status).toBe(200);
  return res.body.avatarUrl as string;
}

async function merge(primaryId: string, duplicateId: string) {
  const res = await request(app)
    .post("/api/contacts/merge")
    .send({ primaryId, duplicateId });
  expect(res.status).toBe(200);
}

const onDisk = (url: string) => fs.existsSync(resolveUploadPath(url)!);

async function createContact(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post("/api/contacts").send(body);
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe("a delete says how long the trash keeps the contact", () => {
  afterEach(() => {
    delete process.env.TRASH_RETENTION_DAYS;
  });

  it("DELETE answers the retention in force, not a fixed 30 days", async () => {
    const id = await createContact({ name: "Retention Single" });
    process.env.TRASH_RETENTION_DAYS = "7";

    const del = await request(app).delete(`/api/contacts/${id}`);

    expect(del.status).toBe(200);
    expect(del.body.retentionDays).toBe(7);
  });

  it("bulk delete answers the retention in force", async () => {
    const a = await createContact({ name: "Retention Bulk A" });
    const b = await createContact({ name: "Retention Bulk B" });
    process.env.TRASH_RETENTION_DAYS = "90";

    const del = await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [a, b] });

    expect(del.status).toBe(200);
    expect(del.body.count).toBe(2);
    expect(del.body.retentionDays).toBe(90);
  });

  it("answers 30 days when nobody has set a retention", async () => {
    const id = await createContact({ name: "Retention Default" });

    const del = await request(app).delete(`/api/contacts/${id}`);

    expect(del.body.retentionDays).toBe(30);
  });
});

describe("the archive date", () => {
  it("is set when a contact is archived and cleared when it comes back", async () => {
    const id = await createContact({ name: "Archive Date Person" });
    // An edit long after the archive must not move the archive date.
    const archive = await request(app)
      .patch(`/api/contacts/${id}`)
      .send({ isArchived: true });
    expect(archive.status).toBe(200);
    expect(archive.body.archivedAt).toEqual(expect.any(String));
    sqlite
      .prepare(
        "UPDATE contacts SET archivedAt = '2026-01-02 03:04:05' WHERE id = ?",
      )
      .run(id);
    await request(app).patch(`/api/contacts/${id}`).send({ about: "Edited" });

    const archived = await request(app).get("/api/contacts/archived");
    const row = archived.body.find((c: { id: string }) => c.id === id);
    expect(row.archivedAt).toBe("2026-01-02 03:04:05");

    await request(app).patch(`/api/contacts/${id}`).send({ isArchived: false });
    const back = await request(app).get(`/api/contacts/${id}`);
    expect(back.body.archivedAt).toBeNull();
  });
});

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
  it("refuses to purge an active contact", async () => {
    const id = await createContact({ name: "Still Active" });
    const res = await request(app).delete(`/api/trash/${id}`);
    expect(res.status).toBe(404);

    const row = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  it("delete forever takes the contacts merged into it, their merge log entries and their files", async () => {
    const kept = await createContact({ name: "Forever Kept" });
    const gone = await createContact({
      name: "Forever Merged Away",
      about: "Words only this contact had",
    });
    const photo = await addPhoto(gone);
    const mail = await request(app)
      .post(`/api/contacts/${gone}/attachments`)
      .attach("attachment", Buffer.from("Subject: Hi\r\n\r\nBody"), "a.eml")
      .expect(201);
    await merge(kept, gone);

    await request(app).delete(`/api/contacts/${kept}`).expect(200);
    await request(app).delete(`/api/trash/${kept}`).expect(200);

    const left = sqlite
      .prepare(
        `SELECT (SELECT COUNT(*) FROM contacts WHERE id IN (?, ?))
              + (SELECT COUNT(*) FROM dedupe_merge_log WHERE duplicateId = ?) AS n`,
      )
      .get(kept, gone, gone) as { n: number };
    expect(left.n).toBe(0);
    expect([photo, mail.body.fileUrl].map(onDisk)).toEqual([false, false]);
    expect((await request(app).get(mail.body.fileUrl)).status).toBe(404);
    const exported = await request(app).get("/api/export/json");
    expect(exported.text).not.toContain("Words only this contact had");
  });

  it("a merge undoes inside its window, and after it the merged-away row goes but a photo still in use stays", async () => {
    const ids: string[] = [];
    for (const name of ["Recent Kept", "Recent Gone", "Old Kept", "Old Gone"])
      ids.push(await createContact({ name: `Window ${name}` }));
    const [recentKept, recentGone, oldKept, oldGone] = ids;
    await merge(recentKept, recentGone);
    // With no photo of its own, the kept contact takes this one in the
    // merge, so both rows name one file.
    sqlite
      .prepare("UPDATE contacts SET avatarUrl = NULL WHERE id = ?")
      .run(oldKept);
    const photo = await addPhoto(oldGone);
    await merge(oldKept, oldGone);
    sqlite
      .prepare(
        `UPDATE dedupe_merge_log SET mergedAt = datetime('now', '-91 days')
          WHERE duplicateId = ?`,
      )
      .run(oldGone);

    contactService.purgeExpiredMerges();

    expect(
      sqlite
        .prepare("SELECT id, avatarUrl FROM contacts WHERE id IN (?, ?)")
        .all(oldKept, oldGone),
    ).toEqual([{ id: oldKept, avatarUrl: photo }]);
    expect(onDisk(photo)).toBe(true);
    const log = await request(app).get("/api/dedupe/merge-log?limit=200");
    const entries = log.body.entries as { id: string; duplicateId: string }[];
    expect(entries.map((e) => e.duplicateId)).not.toContain(oldGone);
    const recent = entries.find((e) => e.duplicateId === recentGone)!;
    await request(app)
      .post(`/api/dedupe/merge-log/${recent.id}/undo`)
      .expect(200);
  });

  it("the daily upload sweep removes only old files that no row uses, and a deleted note takes its preview image", async () => {
    const id = await createContact({ name: "Sweep Owner" });
    const photo = await addPhoto(id);
    const inNote = photo.replace(/avatars\/.*/, "previews/kept.jpg");
    const note = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "note", title: "Link", content: `<p>${inNote}</p>` })
      .expect(201);
    const age = (url: string, days: number) => {
      const file = resolveUploadPath(url)!;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, "x");
      const when = new Date(Date.now() - days * 86_400_000);
      fs.utimesSync(file, when, when);
      return url;
    };
    const oldOrphan = age(photo.replace(/[^/]+$/, "old.jpg"), 3);
    const newOrphan = age(photo.replace(/[^/]+$/, "new.jpg"), 0);
    age(photo, 40);
    age(inNote, 40);

    sweepOrphanUploads();

    expect([oldOrphan, newOrphan, photo, inNote].map(onDisk)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    await request(app).delete(`/api/interactions/${note.body.id}`).expect(200);
    expect(onDisk(inNote)).toBe(false);
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
      birthday: "1990-05-14",
      about: "Met at the fair",
      addresses: [{ address: "1 Main St, Springfield" }],
      socialLinks: [
        { platform: "linkedin", url: "https://www.linkedin.com/in/comma" },
      ],
    });

    const res = await request(app).get("/api/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const lines = res.text.split("\r\n");
    expect(lines[0]).toContain("Name,First Name,Last Name,Company");
    expect(lines[0]).toContain("Addresses,Social Links,Birthday,About");
    expect(res.text).toContain('"Comma, Inc Person"');
    expect(res.text).toContain('"Quotes ""R"" Us, LLC"');
    expect(res.text).toContain(
      '"1 Main St, Springfield",https://www.linkedin.com/in/comma,1990-05-14,Met at the fair',
    );
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

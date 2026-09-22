// =============================================================================
// Integration Tests — an import that can be interrupted and asked again
// =============================================================================
// A bulk import used to exist only for the life of its request. Two things
// followed. A stream that ended without its `done` frame left the browser
// showing "Import complete" over an import it knew nothing about, and a
// second attempt created every contact again under fresh ids.
//
// Every import now has an id the caller chooses and a record the server
// keeps. These tests are about that record: the same request twice imports
// once, the record says where an import is, a row that fails is kept and can
// be run again, and a record whose process died settles on the next read.
//
// The JSON path runs its duplicate check after a settle delay, shortened
// here so the tests wait milliseconds rather than seconds.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";

process.env.IMPORT_SETTLE_MS = "20";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite, ensureLocalOwner } = await import("../../server/db.ts");
const { contactRepo } =
  await import("../../server/repositories/contactRepository.ts");
const { importService } =
  await import("../../server/services/importService.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");

const app = makeTestApp();
const owner = ensureLocalOwner();
const scope = scopeForOwnerId(owner);

interface Frame {
  phase?: string;
  done?: boolean;
  importId?: string;
  repeated?: boolean;
  status?: string;
  count?: number;
  failed?: number;
  summary?: {
    imported: number;
    autoMerged: number;
    needsReview: number;
    newUnique: number;
    failed: number;
  } | null;
}

interface Record {
  id: string;
  status: string;
  phase: string | null;
  message: string | null;
  total: number;
  processed: number;
  imported: number;
  failed: number;
  summary: Frame["summary"];
  error: string | null;
  completedAt: string | null;
}

/** The frames of a streamed import, in order. */
async function stream(
  body: object[],
  importId?: string,
): Promise<{ status: number; frames: Frame[] }> {
  let req = request(app)
    .post("/api/contacts/bulk")
    .set("Accept", "text/event-stream");
  if (importId) req = req.set("X-Import-Id", importId);
  const res = await req.send(body);
  const frames = res.text
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")) as Frame);
  return { status: res.status, frames };
}

async function json(body: object[], importId?: string) {
  let req = request(app).post("/api/contacts/bulk");
  if (importId) req = req.set("X-Import-Id", importId);
  return req.send(body);
}

async function record(importId: string): Promise<Record> {
  const res = await request(app).get(`/api/imports/${importId}`);
  expect(res.status).toBe(200);
  return res.body as Record;
}

/** Poll the record until it reaches `status`, or give up after a while. */
async function until(importId: string, status: string): Promise<Record> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const current = await record(importId);
    if (current.status === status) return current;
    if (Date.now() > deadline) {
      throw new Error(
        `Import ${importId} is ${current.status}, not ${status}, after 5s`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function contactCount(): number {
  return (
    sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts WHERE ownerId = ? AND deletedAt IS NULL",
      )
      .get(owner) as { n: number }
  ).n;
}

function namesOf(): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM contacts WHERE ownerId = ? ORDER BY name")
      .all(owner) as { name: string }[]
  ).map((r) => r.name);
}

function reset(): void {
  sqlite.exec("DELETE FROM dedupe_suggestions");
  sqlite.exec("DELETE FROM dedupe_merge_log");
  sqlite.exec("DELETE FROM imports");
  sqlite.exec("DELETE FROM contacts");
}

beforeEach(() => reset());
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

describe("every import leaves a record", () => {
  it("answers a streamed import with its id first and its status last", async () => {
    const id = crypto.randomUUID();
    const { status, frames } = await stream(
      [{ name: "Ada Lovelace" }, { name: "Charles Babbage" }],
      id,
    );

    expect(status).toBe(200);
    expect(frames[0]).toEqual({ phase: "accepted", importId: id });
    const done = frames.at(-1)!;
    expect(done).toMatchObject({
      done: true,
      importId: id,
      repeated: false,
      status: "complete",
      count: 2,
      failed: 0,
      summary: {
        imported: 2,
        autoMerged: 0,
        needsReview: 0,
        newUnique: 2,
        failed: 0,
      },
    });

    // And the record says the same, for a browser that lost the stream.
    const rec = await record(id);
    expect(rec).toMatchObject({
      id,
      status: "complete",
      phase: "done",
      total: 2,
      processed: 2,
      imported: 2,
      failed: 0,
      summary: done.summary,
      error: null,
    });
    expect(rec.completedAt).not.toBeNull();
  });

  it("makes an id for a caller that sends none, and records that import too", async () => {
    const res = await json([{ name: "Grace Hopper" }]);
    expect(res.status).toBe(201);
    expect(res.body.importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body).toMatchObject({ success: true, count: 1, failed: 0 });

    const rec = await until(res.body.importId, "complete");
    expect(rec.summary).toEqual({
      imported: 1,
      autoMerged: 0,
      needsReview: 0,
      newUnique: 1,
      failed: 0,
    });
  });

  it("refuses an id that is not a UUID", async () => {
    const res = await json([{ name: "Nobody" }], "not-an-id");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(contactCount()).toBe(0);
  });

  it("answers 404 for an id nobody used", async () => {
    const res = await request(app).get(`/api/imports/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    const rows = await request(app).get(
      `/api/imports/${crypto.randomUUID()}/rows`,
    );
    expect(rows.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// The same request twice
// ---------------------------------------------------------------------------

describe("the same import id twice", () => {
  it("imports once on the stream, and answers the second request from the record", async () => {
    const id = crypto.randomUUID();
    const body = [{ name: "Ada Lovelace" }, { name: "Charles Babbage" }];
    const first = await stream(body, id);
    expect(first.frames.at(-1)!.status).toBe("complete");
    expect(contactCount()).toBe(2);

    // The connection dropped after the server finished, the browser never
    // saw `done`, and it sends the same file again.
    const second = await stream(body, id);
    expect(second.status).toBe(200);
    expect(second.frames).toHaveLength(2);
    expect(second.frames[0]).toEqual({ phase: "accepted", importId: id });
    expect(second.frames[1]).toMatchObject({
      done: true,
      importId: id,
      repeated: true,
      status: "complete",
      count: 2,
      summary: first.frames.at(-1)!.summary,
    });

    // Two contacts, not four.
    expect(contactCount()).toBe(2);
  });

  it("imports once on the JSON path too", async () => {
    const id = crypto.randomUUID();
    const first = await json([{ name: "Grace Hopper" }], id);
    expect(first.status).toBe(201);
    await until(id, "complete");

    const second = await json([{ name: "Grace Hopper" }], id);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      success: true,
      repeated: true,
      importId: id,
      status: "complete",
      count: 1,
    });
    expect(contactCount()).toBe(1);
  });

  it("does not run again while the record is committed and the check is still running", async () => {
    const id = crypto.randomUUID();
    const first = await json([{ name: "Grace Hopper" }], id);
    expect(first.status).toBe(201);
    // Before the settle delay has elapsed the record is `imported`.
    const second = await json([{ name: "Grace Hopper" }], id);
    expect(second.status).toBe(200);
    expect(second.body.repeated).toBe(true);
    expect(["imported", "complete"]).toContain(second.body.status);
    expect(contactCount()).toBe(1);
    await until(id, "complete");
  });

  it("runs again under the same id after a failure that committed nothing", async () => {
    const id = crypto.randomUUID();
    // The shape a dead process leaves: running, and nobody running it.
    sqlite
      .prepare(
        `INSERT INTO imports (id, ownerId, status, phase, total) VALUES (?, ?, 'running', 'importing', 1)`,
      )
      .run(id, owner);

    const rec = await record(id);
    expect(rec.status).toBe("failed");
    expect(rec.error).toBe(
      "The import was interrupted before any contact was saved.",
    );

    // "Try again" sends the same id and the same rows.
    const { frames } = await stream([{ name: "Ada Lovelace" }], id);
    expect(frames.at(-1)).toMatchObject({
      done: true,
      repeated: false,
      status: "complete",
      count: 1,
    });
    expect(contactCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A row that fails
// ---------------------------------------------------------------------------

describe("a row that fails", () => {
  /** Make the child-record write throw for one name, the way a bad row would. */
  function breakRow(name: string) {
    const real = contactRepo._insertChildRecordsUnsafe.bind(contactRepo);
    return vi
      .spyOn(contactRepo, "_insertChildRecordsUnsafe")
      .mockImplementation((contactId, body, source) => {
        if ((body as { name?: string }).name === name) {
          throw new Error("simulated child write failure");
        }
        return real(contactId, body, source);
      });
  }

  it("is recorded, and the rest of the import commits", async () => {
    breakRow("Broken Row");
    const id = crypto.randomUUID();
    const { frames } = await stream(
      [
        { name: "Ada Lovelace" },
        { name: "Broken Row" },
        { name: "Grace Hopper" },
      ],
      id,
    );

    const done = frames.at(-1)!;
    expect(done).toMatchObject({
      status: "complete",
      count: 2,
      failed: 1,
      summary: { imported: 2, failed: 1, newUnique: 2 },
    });
    expect(namesOf()).toEqual(["Ada Lovelace", "Grace Hopper"]);

    const rows = await request(app).get(`/api/imports/${id}/rows`);
    expect(rows.status).toBe(200);
    expect(rows.body.rows).toEqual([
      {
        index: 1,
        status: "failed",
        name: "Broken Row",
        error: "simulated child write failure",
        contactId: null,
      },
    ]);
    const doneRows = await request(app).get(
      `/api/imports/${id}/rows?status=done`,
    );
    expect(doneRows.body.rows.map((r: { index: number }) => r.index)).toEqual([
      0, 2,
    ]);
  });

  it("can be run again from the payload the server kept", async () => {
    const broken = breakRow("Broken Row");
    const id = crypto.randomUUID();
    await stream(
      [
        { name: "Ada Lovelace", emails: ["ada@example.com"] },
        { name: "Broken Row", emails: ["broken@example.com"], company: "Kept" },
      ],
      id,
    );
    expect(namesOf()).toEqual(["Ada Lovelace"]);
    broken.mockRestore();

    const retry = await request(app).post(`/api/imports/${id}/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({
      importId: id,
      retried: 1,
      imported: 2,
      failed: 0,
    });

    // The row is back on its own line, with what it carried.
    expect(namesOf()).toEqual(["Ada Lovelace", "Broken Row"]);
    const kept = sqlite
      .prepare(
        `SELECT c.company, e.email FROM contacts c
           JOIN contact_emails e ON e.contactId = c.id
          WHERE c.name = 'Broken Row'`,
      )
      .get() as { company: string; email: string };
    expect(kept).toEqual({ company: "Kept", email: "broken@example.com" });
    const rows = await request(app).get(`/api/imports/${id}/rows?status=done`);
    expect(rows.body.rows.map((r: { index: number }) => r.index)).toEqual([
      0, 1,
    ]);

    // The check runs again for the new contact and the record completes.
    const rec = await until(id, "complete");
    expect(rec.summary).toEqual({
      imported: 2,
      autoMerged: 0,
      needsReview: 0,
      newUnique: 2,
      failed: 0,
    });
    expect(
      (await request(app).get(`/api/imports/${id}/rows`)).body.rows,
    ).toEqual([]);
  });

  it("refuses a retry when nothing failed", async () => {
    const id = crypto.randomUUID();
    await stream([{ name: "Ada Lovelace" }], id);
    const retry = await request(app).post(`/api/imports/${id}/retry`);
    expect(retry.status).toBe(400);
    expect(retry.body.error.code).toBe("NOTHING_TO_RETRY");
    expect(contactCount()).toBe(1);
  });

  it("refuses a retry of an import that committed nothing", async () => {
    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO imports (id, ownerId, status, total, error) VALUES (?, ?, 'failed', 1, 'x')`,
      )
      .run(id, owner);
    const retry = await request(app).post(`/api/imports/${id}/retry`);
    expect(retry.status).toBe(400);
    expect(retry.body.error.code).toBe("NOTHING_TO_RETRY");
  });
});

// ---------------------------------------------------------------------------
// A check that never finished
// ---------------------------------------------------------------------------

describe("an import whose duplicate check was interrupted", () => {
  it("is finished on the next read, and the summary counts what the check found", async () => {
    // What a process death after the commit leaves: the contacts are there,
    // the record says `imported`, and nobody is running the check.
    const existing = await request(app)
      .post("/api/contacts")
      .send({ name: "Margaret Ellington", emails: ["peggy@example.com"] });
    const twin = await request(app)
      .post("/api/contacts")
      .send({ name: "Peggy Ellington", emails: ["peggy@example.com"] });
    const other = await request(app)
      .post("/api/contacts")
      .send({ name: "Somebody Else" });
    expect([existing.status, twin.status, other.status]).toEqual([
      201, 201, 201,
    ]);

    const id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO imports (id, ownerId, status, phase, total, processed, imported)
         VALUES (?, ?, 'imported', 'embedding', 2, 2, 2)`,
      )
      .run(id, owner);
    const row = sqlite.prepare(
      `INSERT INTO import_rows (importId, rowIndex, status, contactId, name) VALUES (?, ?, 'done', ?, ?)`,
    );
    row.run(id, 0, twin.body.id, "Peggy Ellington");
    row.run(id, 1, other.body.id, "Somebody Else");

    const first = await record(id);
    expect(first.status).toBe("imported");
    expect(first.phase).toBe("scanning");
    expect(first.summary).toBeNull();

    const rec = await until(id, "complete");
    expect(rec.summary).toEqual({
      imported: 2,
      autoMerged: 1,
      needsReview: 0,
      newUnique: 1,
      failed: 0,
    });
    // The pair the check found is merged, once.
    const merged = sqlite
      .prepare(
        "SELECT COUNT(*) AS n FROM contacts WHERE canonicalId IS NOT NULL",
      )
      .get() as { n: number };
    expect(merged.n).toBe(1);
  });

  it("is not resumed twice", async () => {
    const id = crypto.randomUUID();
    const c = await request(app).post("/api/contacts").send({ name: "Solo" });
    sqlite
      .prepare(
        `INSERT INTO imports (id, ownerId, status, total, processed, imported) VALUES (?, ?, 'imported', 1, 1, 1)`,
      )
      .run(id, owner);
    sqlite
      .prepare(
        `INSERT INTO import_rows (importId, rowIndex, status, contactId, name) VALUES (?, 0, 'done', ?, 'Solo')`,
      )
      .run(id, c.body.id);

    const finish = vi.spyOn(importService, "finish");
    await record(id);
    await record(id);
    await until(id, "complete");
    expect(finish).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The service, without a request
// ---------------------------------------------------------------------------

describe("bulkCreateContacts without an import id", () => {
  it("is still all or nothing", async () => {
    const { contactService } =
      await import("../../server/services/contactService.ts");
    const real = contactRepo._insertChildRecordsUnsafe.bind(contactRepo);
    vi.spyOn(contactRepo, "_insertChildRecordsUnsafe").mockImplementation(
      (contactId, body, source) => {
        if ((body as { name?: string }).name === "Broken Row") {
          throw new Error("simulated child write failure");
        }
        return real(contactId, body, source);
      },
    );

    await expect(
      contactService.bulkCreateContacts(scope, [
        { name: "Ada Lovelace" },
        { name: "Broken Row" },
      ]),
    ).rejects.toThrow("simulated child write failure");
    expect(contactCount()).toBe(0);
  });
});

describe("GET /api/imports", () => {
  it("lists newest imports for the caller", async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    await json([{ name: "Import 1 Person" }], id1);
    await json([{ name: "Import 2 Person" }], id2);

    const res = await request(app).get("/api/imports");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("imports");
    expect(Array.isArray(res.body.imports)).toBe(true);
    expect(res.body.imports.length).toBeGreaterThanOrEqual(2);
    const idx2 = (res.body.imports as { id: string }[]).findIndex(
      (i) => i.id === id2,
    );
    const idx1 = (res.body.imports as { id: string }[]).findIndex(
      (i) => i.id === id1,
    );
    expect(idx2).toBeLessThan(idx1);
  });
});

describe("dedupeOnImport preference", () => {
  it("skips duplicate scan when dedupeOnImport is false", async () => {
    const { dedupeService } =
      await import("../../server/services/dedupe/index.ts");
    const scanSpy = vi.spyOn(dedupeService, "runImportScan");

    await request(app)
      .patch("/api/auth/preferences")
      .send({ dedupeOnImport: false });

    const importId = crypto.randomUUID();
    await json([{ name: "No Dedupe Person" }], importId);
    await until(importId, "complete");

    expect(scanSpy).not.toHaveBeenCalled();

    // Reset preference
    await request(app)
      .patch("/api/auth/preferences")
      .send({ dedupeOnImport: true });
    scanSpy.mockRestore();
  });
});

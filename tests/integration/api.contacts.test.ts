// =============================================================================
// Integration: contact CRUD, validation, FTS search, bulk ops, error envelope
// =============================================================================
// Every request here runs the real Express pipeline against a real SQLite
// database (fresh temp file per test file) — validation middleware, service
// layer, repositories, FTS triggers, and the error envelope all execute.
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("POST /api/contacts", () => {
  it("creates a contact and returns the hydrated record", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({
        name: "Grace Hopper",
        company: "US Navy",
        role: "Rear Admiral",
        emails: ["grace@navy.mil"],
        tags: ["computing"],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("Grace Hopper");
    expect(res.body.emails).toEqual([
      expect.objectContaining({ email: "grace@navy.mil" }),
    ]);
    expect(res.body.tags).toEqual([
      expect.objectContaining({ tag: "computing" }),
    ]);
  });

  it("rejects a payload without a name via the validation envelope", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({ company: "Nameless Inc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.requestId).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("GET /api/contacts", () => {
  it("lists created contacts in slim view with hydrated children", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Slim Target", emails: ["slim@example.com"] });

    const res = await request(app).get("/api/contacts?view=slim");
    expect(res.status).toBe(200);
    const slim = res.body.find(
      (c: { name: string }) => c.name === "Slim Target",
    );
    expect(slim).toBeTruthy();
    expect(slim.emails).toEqual([
      expect.objectContaining({ email: "slim@example.com" }),
    ]);
  });

  it("returns the canonical 404 envelope for a missing contact", async () => {
    const res = await request(app).get(
      "/api/contacts/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
  });
});

describe("PATCH /api/contacts/:id", () => {
  it("updates scalar fields", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Me" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ role: "CTO" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("CTO");
  });

  it("rejects child arrays with a 400", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Reject" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ emails: ["nope@example.com"] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/child arrays/i);
  });

  it("rejects a type-invalid body via Zod", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Invalid" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ cadenceDays: "not-a-number" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("FTS search pipeline (triggers + index)", () => {
  it("finds a contact by name immediately after creation", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Zaphod Beeblebrox", company: "Heart of Gold" });

    const res = await request(app).get("/api/search?q=Zaphod");
    expect(res.status).toBe(200);
    expect(
      res.body.some((c: { name: string }) => c.name === "Zaphod Beeblebrox"),
    ).toBe(true);
  });

  it("reflects renames via the FTS update trigger", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Trillian Astra" });

    await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ name: "Tricia McMillan" });

    const oldName = await request(app).get("/api/search?q=Trillian");
    const newName = await request(app).get("/api/search?q=McMillan");
    expect(
      oldName.body.some((c: { id: string }) => c.id === created.body.id),
    ).toBe(false);
    expect(
      newName.body.some((c: { id: string }) => c.id === created.body.id),
    ).toBe(true);
  });

  it("indexes email addresses via the child-table trigger", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Email Indexed", emails: ["findme-fts@example.com"] });

    const res = await request(app).get("/api/search?q=findme");
    expect(
      res.body.some((c: { name: string }) => c.name === "Email Indexed"),
    ).toBe(true);
  });
});

describe("bulk operations", () => {
  it("bulk-creates contacts via the JSON path", async () => {
    const res = await request(app)
      .post("/api/contacts/bulk")
      .send([
        { name: "Bulk One", emails: ["b1@example.com"] },
        { name: "Bulk Two" },
      ]);

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });

  it("bulk-deletes contacts and cascades children", async () => {
    const a = await request(app)
      .post("/api/contacts")
      .send({ name: "Doomed A", emails: ["da@example.com"] });
    const b = await request(app)
      .post("/api/contacts")
      .send({ name: "Doomed B" });

    const res = await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [a.body.id, b.body.id] });
    expect(res.status).toBe(200);

    const after = await request(app).get(`/api/contacts/${a.body.id}`);
    expect(after.status).toBe(404);
  });
});

describe("error envelope", () => {
  it("returns ROUTE_NOT_FOUND for unknown API paths", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("returns INVALID_JSON for malformed request bodies", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .set("Content-Type", "application/json")
      .send('{"name": "broken"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

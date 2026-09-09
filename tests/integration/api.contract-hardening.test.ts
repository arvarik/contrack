import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";

const app = makeTestApp();
beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  sqlite.prepare("DELETE FROM lists").run();
});
const create = async () =>
  (await request(app).post("/api/contacts").send({ name: "Alice" })).body
    .id as string;

describe("API and UI data contracts", () => {
  it("returns the same request identifier for parser errors and response headers", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .set("Content-Type", "application/json")
      .send("{");
    expect(res.status).toBe(400);
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    expect(res.body.error.requestId).toMatch(/^[0-9a-f]{8}$/);
  });

  it.each([
    { name: "   " },
    { name: "Alice", isArchived: "nope" },
    { name: "Alice", lat: 91 },
    { name: "Alice", lng: -181 },
  ])("rejects invalid contact fields: %j", async (body) => {
    expect((await request(app).post("/api/contacts").send(body)).status).toBe(
      400,
    );
  });

  it("preserves accepted scalar fields on creation and update", async () => {
    const res = await request(app).post("/api/contacts").send({
      name: " Alice ",
      lat: 12,
      lng: 45,
      themeColor: "rose",
      isGhost: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Alice",
      lat: 12,
      lng: 45,
      themeColor: "rose",
      isGhost: true,
    });
    const updated = await request(app)
      .patch(`/api/contacts/${res.body.id}`)
      .send({ lat: 20, isGhost: false });
    expect(updated.body).toMatchObject({ lat: 20, isGhost: false });
  });

  it("rejects empty updates and missing parents before a child write", async () => {
    const id = await create();
    expect(
      (
        await request(app)
          .patch(`/api/contacts/${id}`)
          .send({ typo: "ignored" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put("/api/contacts/missing")
          .send({ emails: ["test@example.com"] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/contacts/missing/action-items")
          .send({ title: "Call", dueAt: "2026-09-30" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/contacts/missing/attachments")
          .attach("attachment", Buffer.from("test"), "test.txt")
      ).status,
    ).toBe(404);
  });

  it("rejects invalid dates and negative interaction duration", async () => {
    const id = await create();
    for (const dueAt of ["tomorrow", "2026-02-30", "bad"]) {
      expect(
        (
          await request(app)
            .post(`/api/contacts/${id}/action-items`)
            .send({ title: "Call", dueAt })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await request(app)
          .post(`/api/contacts/${id}/interactions`)
          .send({ type: "call", title: "Call", duration: -1 })
      ).status,
    ).toBe(400);
  });

  it("counts actual bulk changes and preserves the trash boundary", async () => {
    const id = await create();
    const removed = await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [id, id, "missing"] });
    expect(removed.body.count).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/contacts/bulk-delete")
          .send({ ids: [id] })
      ).body.count,
    ).toBe(0);
    expect(
      (
        await request(app)
          .put(`/api/contacts/${id}`)
          .send({ name: "Resurrect" })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .put("/api/contacts/bulk-update")
          .send({ ids: [id, "missing"], data: { name: "Resurrect" } })
      ).body.count,
    ).toBe(0);
  });

  it("rejects unsupported bulk child edits instead of silently dropping them", async () => {
    const id = await create();
    const response = await request(app)
      .put("/api/contacts/bulk-update")
      .send({ ids: [id], data: { tags: ["friend"] } });
    expect(response.status).toBe(400);
    expect((await request(app).get(`/api/contacts/${id}`)).body.tags).toEqual(
      [],
    );
  });

  it("keeps list counts aligned with visible members and reports missing lists", async () => {
    const id = await create();
    const list = (
      await request(app).post("/api/lists").send({ name: "Friends" })
    ).body.id;
    expect(
      (
        await request(app)
          .post(`/api/lists/${list}/members/bulk`)
          .send({ contactIds: [id, id] })
      ).body.count,
    ).toBe(1);
    expect(
      (
        await request(app)
          .post(`/api/lists/${list}/members/bulk`)
          .send({ contactIds: [id] })
      ).body.count,
    ).toBe(0);
    expect(
      (
        await request(app)
          .post(`/api/lists/${list}/members`)
          .send({ contactId: "missing" })
      ).status,
    ).toBe(404);
    await request(app).delete(`/api/contacts/${id}`);
    expect(
      (await request(app).get(`/api/lists/${list}/contacts`)).body,
    ).toEqual([]);
    expect((await request(app).get("/api/lists")).body[0].memberCount).toBe(0);
    expect((await request(app).get("/api/lists/missing/contacts")).status).toBe(
      404,
    );
  });

  it("does not move the latest interaction date backward and recomputes it after deletion", async () => {
    const id = await create();
    const newer = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "call", title: "New", date: "2026-09-08T12:00:00Z" });
    const older = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "call", title: "Old", date: "2026-08-01T12:00:00Z" });
    expect(
      (await request(app).get(`/api/contacts/${id}`)).body.lastContactedAt,
    ).toBe("2026-09-08T12:00:00.000Z");
    await request(app).delete(`/api/interactions/${newer.body.id}`);
    expect(
      (await request(app).get(`/api/contacts/${id}`)).body.lastContactedAt,
    ).toBe("2026-08-01T12:00:00.000Z");
    await request(app).delete(`/api/interactions/${older.body.id}`);
    expect(
      (await request(app).get(`/api/contacts/${id}`)).body.lastContactedAt,
    ).toBeNull();
  });

  it("applies the same command-palette facets before server search limits", async () => {
    const owner = localOwnerId();
    sqlite.transaction(() => {
      for (let i = 0; i < 30; i++)
        sqlite
          .prepare(
            "INSERT INTO contacts(id,name,location,ownerId) VALUES (?,?,?,?)",
          )
          .run(String(i), "Alice", i === 29 ? "Paris" : "London", owner);
    })();
    const res = await request(app)
      .get("/api/search")
      .query({
        q: "Alice",
        filters: JSON.stringify([{ field: "location", value: "Paris" }]),
      });
    expect(res.body.map((c: { id: string }) => c.id)).toEqual(["29"]);
    expect(
      (
        await request(app)
          .get("/api/search")
          .query({ q: "Alice", filters: "{" })
      ).status,
    ).toBe(400);
  });
});

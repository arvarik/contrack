import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import {
  asUser,
  createActor,
  resetAccounts,
  type Actor,
} from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;

describe("Map Views API (/api/map/views)", () => {
  let alice: Actor;
  let bob: Actor;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    app = makeTestApp();
    resetAccounts();
    alice = await createActor(app, {
      email: "alice@example.com",
      username: "alice",
    });
    bob = await createActor(app, { email: "bob@example.com", username: "bob" });
  });

  afterAll(() => {
    delete process.env.AUTH_REQUIRED;
    app.close();
  });

  beforeEach(() => {
    sqlite.exec("DELETE FROM map_views;");
  });

  it("POST /api/map/views creates a view with 201 and valid payload", async () => {
    const res = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "London Tech",
          query: "industry:Technology",
          layer: "heat",
          bounds: [-0.5, 51.3, 0.2, 51.7],
        }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: "London Tech",
      query: "industry:Technology",
      layer: "heat",
      bounds: [-0.5, 51.3, 0.2, 51.7],
      sortOrder: 0,
    });
  });

  it("GET /api/map/views returns views sorted by sortOrder ASC, name ASC", async () => {
    await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "B View",
          query: "tag:vip",
          layer: "pins",
          bounds: [-10, 40, 10, 60],
        }),
    );
    await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "A View",
          query: "near:Paris",
          layer: "heat",
          bounds: [2, 48, 3, 49],
        }),
    );

    const res = await asUser(alice)(request(app).get("/api/map/views"));
    expect(res.status).toBe(200);
    expect(res.body.views).toHaveLength(2);
    expect(res.body.views[0].name).toBe("B View");
    expect(res.body.views[0].sortOrder).toBe(0);
    expect(res.body.views[1].name).toBe("A View");
    expect(res.body.views[1].sortOrder).toBe(1);
  });

  it("PATCH /api/map/views/:id updates allowed fields", async () => {
    const createRes = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "Initial Name",
          query: "test",
          layer: "pins",
          bounds: [-1, 50, 1, 52],
        }),
    );
    const viewId = createRes.body.id;

    const patchRes = await asUser(alice)(
      request(app)
        .patch(`/api/map/views/${viewId}`)
        .send({
          name: "Updated Name",
          query: "updated:query",
          layer: "heat",
          bounds: [-2, 49, 2, 53],
        }),
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({
      id: viewId,
      name: "Updated Name",
      query: "updated:query",
      layer: "heat",
      bounds: [-2, 49, 2, 53],
    });
  });

  it("DELETE /api/map/views/:id removes the view", async () => {
    const createRes = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "To Delete",
          bounds: [0, 0, 10, 10],
        }),
    );
    const viewId = createRes.body.id;

    const delRes = await asUser(alice)(
      request(app).delete(`/api/map/views/${viewId}`),
    );
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ success: true });

    const listRes = await asUser(alice)(request(app).get("/api/map/views"));
    expect(listRes.body.views).toHaveLength(0);
  });

  it("rejects invalid bounds with 400 Bad Request", async () => {
    const badBoundsCases = [
      null,
      "not an array",
      [1, 2, 3], // only 3 items
      [1, 2, 3, 4, 5], // 5 items
      ["-10", 50, 10, 60], // string item
      [NaN, 50, 10, 60], // NaN
      [-190, 50, 10, 60], // west out of range
      [10, 50, 195, 60], // east out of range
      [-10, -95, 10, 60], // south out of range
      [-10, 50, 10, 95], // north out of range
      [-10, 60, 10, 50], // south >= north
    ];

    for (const bounds of badBoundsCases) {
      const res = await asUser(alice)(
        request(app).post("/api/map/views").send({
          name: "Invalid Bounds",
          bounds,
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects invalid name, query, and layer with 400 Bad Request", async () => {
    // Empty name
    let res = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "",
          bounds: [0, 0, 1, 1],
        }),
    );
    expect(res.status).toBe(400);

    // Name > 60 chars
    res = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "a".repeat(61),
          bounds: [0, 0, 1, 1],
        }),
    );
    expect(res.status).toBe(400);

    // Query > 200 chars
    res = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "Valid Name",
          query: "q".repeat(201),
          bounds: [0, 0, 1, 1],
        }),
    );
    expect(res.status).toBe(400);

    // Invalid layer
    res = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "Valid Name",
          layer: "satellite",
          bounds: [0, 0, 1, 1],
        }),
    );
    expect(res.status).toBe(400);
  });

  it("enforces 100-view cap with 409 TOO_MANY_VIEWS", async () => {
    // Create 100 views
    for (let i = 0; i < 100; i++) {
      const res = await asUser(alice)(
        request(app)
          .post("/api/map/views")
          .send({
            name: `View ${i}`,
            bounds: [-10, 40, 10, 60],
          }),
      );
      expect(res.status).toBe(201);
    }

    // 101st view fails with 409
    const res101 = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "View 101",
          bounds: [-10, 40, 10, 60],
        }),
    );
    expect(res101.status).toBe(409);
    expect(res101.body.error.code).toBe("TOO_MANY_VIEWS");

    // Bob can still create a view (independent cap)
    const bobRes = await asUser(bob)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "Bob View 1",
          bounds: [0, 0, 1, 1],
        }),
    );
    expect(bobRes.status).toBe(201);
  });

  it("returns 404 when acting on another owner's view", async () => {
    const createRes = await asUser(alice)(
      request(app)
        .post("/api/map/views")
        .send({
          name: "Alice Private View",
          bounds: [-10, 40, 10, 60],
        }),
    );
    const aliceViewId = createRes.body.id;

    // Bob cannot patch Alice's view
    const patchRes = await asUser(bob)(
      request(app)
        .patch(`/api/map/views/${aliceViewId}`)
        .send({ name: "Bob Hijack" }),
    );
    expect(patchRes.status).toBe(404);

    // Bob cannot delete Alice's view
    const delRes = await asUser(bob)(
      request(app).delete(`/api/map/views/${aliceViewId}`),
    );
    expect(delRes.status).toBe(404);
  });

  // Health was a third layer until v2. A view saved with it, a save from a
  // page loaded before v2, and the account's layer preference all read as
  // Pins, so an old value never fails to load.
  describe("a layer saved as health", () => {
    it("opens a stored health view on pins", async () => {
      const created = await asUser(alice)(
        request(app)
          .post("/api/map/views")
          .send({ name: "Old health view", bounds: [-10, 40, 10, 60] }),
      );
      sqlite
        .prepare("UPDATE map_views SET layer = 'health' WHERE id = ?")
        .run(created.body.id);

      const list = await asUser(alice)(request(app).get("/api/map/views"));
      expect(list.status).toBe(200);
      expect(list.body.views[0].layer).toBe("pins");
    });

    it("saves health from an old page as pins", async () => {
      const created = await asUser(alice)(
        request(app)
          .post("/api/map/views")
          .send({
            name: "From an old tab",
            layer: "health",
            bounds: [-10, 40, 10, 60],
          }),
      );
      expect(created.status).toBe(201);
      expect(created.body.layer).toBe("pins");

      const patched = await asUser(alice)(
        request(app)
          .patch(`/api/map/views/${created.body.id}`)
          .send({ layer: "health" }),
      );
      expect(patched.status).toBe(200);
      expect(patched.body.layer).toBe("pins");
      const row = sqlite
        .prepare("SELECT layer FROM map_views WHERE id = ?")
        .get(created.body.id) as { layer: string };
      expect(row.layer).toBe("pins");
    });

    it("reads the layer preference stored as health as pins", async () => {
      sqlite
        .prepare(
          `INSERT INTO user_settings (userId, key, value) VALUES (?, ?, ?)
           ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
        )
        .run(alice.user.id, "pref.mapLayer", '"health"');

      const res = await asUser(alice)(
        request(app).get("/api/auth/preferences"),
      );
      expect(res.status).toBe(200);
      expect(res.body.preferences.mapLayer).toBe("pins");
      expect(res.body.stored).toContain("mapLayer");
    });

    it("stores a health layer preference from an old page as pins", async () => {
      const res = await asUser(alice)(
        request(app)
          .patch("/api/auth/preferences")
          .send({ mapLayer: "health" }),
      );
      expect(res.status).toBe(200);
      expect(res.body.preferences.mapLayer).toBe("pins");
      const row = sqlite
        .prepare(
          "SELECT value FROM user_settings WHERE userId = ? AND key = 'pref.mapLayer'",
        )
        .get(alice.user.id) as { value: string };
      expect(JSON.parse(row.value)).toBe("pins");
    });

    it("still refuses a layer that never existed", async () => {
      const view = await asUser(alice)(
        request(app)
          .post("/api/map/views")
          .send({
            name: "Satellite",
            layer: "satellite",
            bounds: [0, 0, 1, 1],
          }),
      );
      expect(view.status).toBe(400);
      const pref = await asUser(alice)(
        request(app)
          .patch("/api/auth/preferences")
          .send({ mapLayer: "satellite" }),
      );
      expect(pref.status).toBe(400);
    });
  });
});

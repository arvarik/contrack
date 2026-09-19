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
          layer: "health",
          bounds: [-0.5, 51.3, 0.2, 51.7],
        }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: "London Tech",
      query: "industry:Technology",
      layer: "health",
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
          layer: "health",
          bounds: [-2, 49, 2, 53],
        }),
    );
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({
      id: viewId,
      name: "Updated Name",
      query: "updated:query",
      layer: "health",
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
});

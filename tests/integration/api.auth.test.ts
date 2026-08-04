// =============================================================================
// Integration: authentication — bearer token, cookie login, gating
// =============================================================================
// The auth middleware reads env per request, so this file enables enforcement
// in beforeAll (after the shared setup deleted any ambient AUTH_* vars) and
// disables it again in afterAll so ordering never leaks into other files.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const TEST_TOKEN = "integration-test-token-12345";
const app = makeTestApp();

beforeAll(() => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
});

afterAll(() => {
  delete process.env.AUTH_TOKEN;
});

describe("gating", () => {
  it("rejects unauthenticated API requests with 401 UNAUTHORIZED", async () => {
    const res = await request(app).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a wrong bearer token", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("accepts a valid bearer token", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("gates /uploads as well", async () => {
    const res = await request(app).get("/uploads/anything.jpg");
    expect(res.status).toBe(401);
  });

  it("gates write operations", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Should Not Exist" });
    expect(res.status).toBe(401);
  });
});

describe("auth endpoints", () => {
  it("status is reachable without credentials", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authRequired: true, authenticated: false });
  });

  it("status reflects a valid bearer token", async () => {
    const res = await request(app)
      .get("/api/auth/status")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.body).toEqual({ authRequired: true, authenticated: true });
  });

  it("login rejects a bad token without setting a cookie", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ token: "nope" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("login sets an HttpOnly cookie that authenticates later requests", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ token: TEST_TOKEN });
    expect(login.status).toBe(200);

    const cookie = login.headers["set-cookie"]?.[0];
    expect(cookie).toContain("contrack_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const authed = await request(app)
      .get("/api/contacts")
      .set("Cookie", cookie!.split(";")[0]);
    expect(authed.status).toBe(200);
  });

  it("logout clears the cookie", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.headers["set-cookie"]?.[0]).toContain("Max-Age=0");
  });
});

describe("full flow with auth on", () => {
  it("create → search round trip with a bearer token", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .set("Authorization", `Bearer ${TEST_TOKEN}`)
      .send({ name: "Authed Contact" });
    expect(created.status).toBe(201);

    const search = await request(app)
      .get("/api/search?q=Authed")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(
      search.body.some((c: { id: string }) => c.id === created.body.id),
    ).toBe(true);
  });
});

describe("auth disabled (default local setup)", () => {
  it("everything is open when no token is configured", async () => {
    delete process.env.AUTH_TOKEN;
    try {
      const status = await request(app).get("/api/auth/status");
      expect(status.body).toEqual({ authRequired: false, authenticated: true });

      const res = await request(app).get("/api/contacts");
      expect(res.status).toBe(200);
    } finally {
      process.env.AUTH_TOKEN = TEST_TOKEN;
    }
  });
});

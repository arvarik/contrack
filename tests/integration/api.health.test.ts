// =============================================================================
// Integration: the /healthz liveness probe
// =============================================================================
// Docker's HEALTHCHECK holds no credential, so the probe must answer on a
// gated instance. It also must not leak instance detail — an unauthenticated
// endpoint describes nothing beyond up/down.
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

afterEach(() => {
  process.env.AUTH_REQUIRED = "";
});

describe("GET /healthz", () => {
  it("answers while the instance is gated and the caller holds nothing", async () => {
    process.env.AUTH_REQUIRED = "true";
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("says only up or down — no versions, counts, or configuration", async () => {
    const res = await request(app).get("/healthz");
    expect(Object.keys(res.body)).toEqual(["status"]);
  });

  it("does not exist under /api, where the auth gate applies", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(404);
  });
});

// Integration: the /healthz liveness probe.
// Docker's HEALTHCHECK holds no credential, so the probe answers on a gated
// instance. It also names the schema versions (the last migration applied and
// the last the build holds), so an operator can confirm a migration ran.
//
// The payload is asserted key by key, so a count, a name, a setting or an
// account added here fails this file. Anything richer belongs on
// `GET /api/admin/health`, which needs an admin.

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { MIGRATIONS } from "../../server/db/migrations/index.ts";

const app = makeTestApp();

afterEach(() => {
  process.env.AUTH_REQUIRED = "";
});

describe("GET /healthz", () => {
  it("answers while the instance is gated and the caller holds nothing", async () => {
    process.env.AUTH_REQUIRED = "true";

    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("reports the schema this database is on, beside what the build expects", async () => {
    const res = await request(app).get("/healthz");

    // The pair is the point. One value alone cannot tell an operator whether
    // the migration they just ran finished.
    const last = MIGRATIONS[MIGRATIONS.length - 1].id;
    expect(res.body.schema).toEqual({ migration: last, expects: last });
    expect(res.body.vec).toMatch(/^v?\d+\.\d+\.\d+/);
  });

  it("says versions and nothing else", async () => {
    const res = await request(app).get("/healthz");

    // Exact, not a subset. An unauthenticated endpoint must not describe the
    // instance, and a fourth key here would be somebody deciding otherwise
    // without anybody noticing.
    expect(Object.keys(res.body).sort()).toEqual(["schema", "status", "vec"]);
    expect(Object.keys(res.body.schema).sort()).toEqual([
      "expects",
      "migration",
    ]);

    const text = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of [
      "user",
      "account",
      "contact",
      "email",
      "token",
      "registration",
      "instance",
      "bytes",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("does not exist under /api, where the auth gate applies", async () => {
    const res = await request(app).get("/api/healthz");

    expect(res.status).toBe(404);
  });

  it("is not stored by anything", async () => {
    // Not one of the four no-store prefixes, and it should not be: a probe
    // answered from a cache is a probe that cannot detect an outage. Express
    // sends no caching headers of its own here, which leaves it to the
    // monitor. Asserted so that a later change to the static or proxy layer
    // that starts marking it cacheable is visible.
    const res = await request(app).get("/healthz");

    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

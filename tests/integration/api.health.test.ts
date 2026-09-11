// =============================================================================
// Integration: the /healthz liveness probe
// =============================================================================
// Docker's HEALTHCHECK holds no credential, so the probe must answer on a
// gated instance.
//
// It used to answer `{ status: "ok" }` and this file asserted exactly that:
// no versions, no counts, no configuration. Extra F4 adds the three schema
// versions so an operator can confirm a migration ran without opening the
// database, and that is a deliberate widening of what an unauthenticated
// caller is told.
//
// The guard did not go away, it moved. The payload is asserted key by key, so
// a count, a name, a setting or an account added here later fails this file
// rather than shipping. Everything richer belongs on `GET /api/admin/health`,
// which needs an admin.
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { TENANCY_SCHEMA_VERSION } from "../../server/db.ts";
import { FTS_SCHEMA_VERSION } from "../../server/services/search/ftsIndex.ts";

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

    // The pair is the point. One number alone cannot tell an operator whether
    // the migration they just ran finished.
    expect(res.body.schema).toEqual({
      tenancy: TENANCY_SCHEMA_VERSION,
      fts: FTS_SCHEMA_VERSION,
    });
    expect(res.body.expects).toEqual({
      tenancy: TENANCY_SCHEMA_VERSION,
      fts: FTS_SCHEMA_VERSION,
    });
    expect(res.body.vec).toMatch(/^v?\d+\.\d+\.\d+/);
  });

  it("says versions and nothing else", async () => {
    const res = await request(app).get("/healthz");

    // Exact, not a subset. An unauthenticated endpoint must not describe the
    // instance, and a fifth key here would be somebody deciding otherwise
    // without anybody noticing.
    expect(Object.keys(res.body).sort()).toEqual([
      "expects",
      "schema",
      "status",
      "vec",
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

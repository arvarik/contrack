// =============================================================================
// Integration Tests — what a browser and a proxy may keep
// =============================================================================
// Express sends no `Cache-Control` of its own on a JSON response, and a
// response with no caching headers is one a shared cache may store and hand
// to somebody else using heuristics. Four prefixes carry responses that
// differ per caller — who is signed in, who else has an account, what the
// instance has spent, and a whole account's data in one file — and one prefix
// serves files that belong to exactly one account.
//
// One test per prefix, plus the two that matter most: that the header is not
// sprayed across the whole API, and that a 401 carries it too.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import request from "supertest";

const { makeTestApp } = await import("./helpers.ts");
const { NO_STORE_PREFIXES } =
  await import("../../server/middleware/cacheControl.ts");
const { sqlite } = await import("../../server/db.ts");
const { ownerUploadDir, ownerUploadUrl } =
  await import("../../server/utils/paths.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");

const app = makeTestApp();
let actor: Awaited<ReturnType<typeof createActor>>;

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  actor = await createActor(app, { username: "cacheactor" });
  sqlite
    .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
    .run(actor.user.id);
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  resetAccounts();
});

describe("no-store", () => {
  it("covers exactly the four prefixes the middleware names", () => {
    // The list is a statement about what those responses contain. `/api` as a
    // whole is not that statement, and a prefix added by accident is worse
    // than one missing on purpose.
    expect([...NO_STORE_PREFIXES]).toEqual([
      "/api/auth",
      "/api/admin",
      "/api/ai/stats",
      "/api/export",
    ]);
  });

  it("marks who is signed in as never storable", async () => {
    const res = await asUser(actor)(request(app).get("/api/auth/me"));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(
      "no-store, no-cache, must-revalidate",
    );
  });

  it("marks the account list as never storable", async () => {
    const res = await asUser(actor)(request(app).get("/api/admin/users"));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("marks what the instance has spent as never storable", async () => {
    const res = await asUser(actor)(request(app).get("/api/ai/stats/summary"));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("marks a whole account's export as never storable", async () => {
    const res = await asUser(actor)(request(app).get("/api/export/json"));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("covers the refusals too, not just the answers", async () => {
    // A 401 from `/api/auth/me` says whether somebody is signed in, which is
    // exactly as cacheable as the answer. The middleware is mounted before
    // the routers so it reaches every response they produce.
    const res = await request(app).get("/api/auth/me");

    expect(res.status).toBe(401);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("sends the older directives for the caches that predate no-store", async () => {
    const res = await asUser(actor)(request(app).get("/api/auth/me"));

    expect(res.headers["pragma"]).toBe("no-cache");
    expect(res.headers["expires"]).toBe("0");
  });

  it("leaves the rest of the API alone", async () => {
    // Contacts are not on the list. Nothing about this is a decision to cache
    // them; it is a decision not to make a blanket claim, so that the four
    // prefixes above mean something.
    const res = await asUser(actor)(request(app).get("/api/contacts"));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBeUndefined();
  });
});

describe("uploads", () => {
  /**
   * A real file in the caller's own upload directory.
   *
   * It has to be real. `express.static` calls `setHeaders` only when it is
   * actually sending a file, so a request for a path that does not exist
   * produces a 404 with no headers from that layer at all — and a test
   * asserting "the header is not `public`" against a response that has no
   * header would pass whatever the code did.
   */
  function writeUpload(name: string, body: string): string {
    const dir = ownerUploadDir(actor.user.id, "files");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
    return ownerUploadUrl(actor.user.id, "files", name);
  }

  it("are private, so no shared cache keeps one account's file", async () => {
    // An upload lives under /uploads/u/<ownerId>/… and belongs to exactly one
    // account. `express.static` sends `public, max-age=0`, and `public` is an
    // instruction to a shared cache that it may keep the response and serve
    // it to whoever asks for that URL next.
    const url = writeUpload("cache-control.txt", "a private file");

    const res = await asUser(actor)(request(app).get(url));

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(
      "private, max-age=0, must-revalidate",
    );
    expect(res.headers["cache-control"]).not.toContain("public");
  });

  it("keep the headers that were already there", async () => {
    const url = writeUpload("still-guarded.txt", "a private file");

    const res = await asUser(actor)(request(app).get(url));

    // Adding a caching header must not have displaced the two that stop a
    // stored .html or .svg running as same-origin script.
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBe("attachment");
  });
});

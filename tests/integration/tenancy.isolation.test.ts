// =============================================================================
// Integration Tests — the isolation matrix
// =============================================================================
// Two real accounts, two real sessions, rows written through the public API.
// For every route a sub-phase has converted, user B tries to reach user A's
// data and must fail, and A's rows must be unchanged afterwards.
//
// The rows that are still unconverted stay as `it.todo`, generated from
// ROUTE_MANIFEST, so a new scoped route arrives here as a todo automatically
// and cannot be forgotten. The `COVERED` list below is checked against the
// manifest: a route cannot be marked `isolated` without a test in this file,
// and a test here cannot cover a route the manifest has not flipped.
//
// Auth is on for this file. Isolation between two accounts is only meaningful
// when both had to sign in.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { makeTestApp } from "./helpers.ts";
import { ROUTE_MANIFEST } from "../../server/tenancy/routeManifest.ts";
import { LOGOS_DIR, UPLOADS_DIR, ensureDir } from "../../server/utils/paths.ts";
import {
  asUser,
  createActor,
  resetAccounts,
  rowsOwnedBy,
  seedOwner,
  snapshotRow,
  type Actor,
  type Seeded,
} from "./tenancy/helpers.ts";

const app = makeTestApp();

/** Routes proven below. Kept in step with `isolated: true` by a test. */
const COVERED = [
  "DELETE /api/contacts/:id",
  "GET /api/contacts",
  "GET /api/contacts/:id",
  "GET /api/contacts/:id/score",
  "GET /api/contacts/archived",
  "GET /api/contacts/map",
  "PATCH /api/contacts/:id",
  "POST /api/contacts",
  "POST /api/contacts/:id/avatar",
  "POST /api/contacts/:id/enrich",
  "POST /api/contacts/bulk",
  "POST /api/contacts/bulk-delete",
  "PUT /api/contacts/:id",
  "PUT /api/contacts/bulk-update",
  "USE /uploads",
];

/** The smallest valid PNG, so multer's MIME filter has something real. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let A: Actor;
let B: Actor;
let seedA: Seeded;
let seedB: Seeded;
/** A's avatar URL, uploaded through the route so the file really exists. */
let avatarUrlA: string;

const randomId = () => crypto.randomUUID();
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** The error body with the two fields that legitimately differ removed. */
function comparableError(body: { error?: Record<string, unknown> }) {
  const { requestId, stack, ...rest } = body.error ?? {};
  void requestId;
  void stack;
  return rest;
}

/** A's contact rows, keyed by id, for a before-and-after comparison. */
function snapshotA(): Record<string, Record<string, unknown> | undefined> {
  const out: Record<string, Record<string, unknown> | undefined> = {};
  for (const id of seedA.contactIds) out[id] = snapshotRow("contacts", id);
  return out;
}

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";

  A = await createActor(app, { username: "alice", email: "alice@example.com" });
  B = await createActor(app, { username: "bob", email: "bob@example.com" });

  seedA = await seedOwner(app, A, {
    contacts: 20,
    interactions: 10,
    lists: 2,
    actionItems: 5,
  });
  seedB = await seedOwner(app, B, { contacts: 5 });

  // A puts a real file on disk through the real upload route.
  const uploaded = await asUser(A)(
    request(app)
      .post(`/api/contacts/${seedA.contactIds[0]}/avatar`)
      .attach("avatar", PNG_1X1, {
        filename: "alice.png",
        contentType: "image/png",
      }),
  );
  expect(uploaded.status).toBe(200);
  avatarUrlA = uploaded.body.avatarUrl;
  expect(avatarUrlA).toContain(`/uploads/u/${A.user.id}/avatars/`);

  // A shared logo and a file in the pre-Phase-1 flat layout, so the guard is
  // tested against files that exist rather than against a missing path.
  ensureDir(LOGOS_DIR);
  fs.writeFileSync(path.join(LOGOS_DIR, "acme.png"), PNG_1X1);
  ensureDir(path.join(UPLOADS_DIR, "avatars"));
  fs.writeFileSync(path.join(UPLOADS_DIR, "avatars", "legacy.png"), PNG_1X1);
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  resetAccounts();
});

// =============================================================================
// Reading one contact
// =============================================================================

describe("GET /api/contacts/:id", () => {
  it("answers a foreign id and an unknown id with the same 404", async () => {
    const foreign = await asUser(B)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}`),
    );
    const unknown = await asUser(B)(
      request(app).get(`/api/contacts/${randomId()}`),
    );

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    // Identical, not merely both 404. A body that differed would tell B which
    // ids exist on the instance, one guess at a time.
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });

  it("still serves the row to its owner", async () => {
    const res = await asUser(A)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seedA.contactIds[0]);
  });
});

describe("GET /api/contacts/:id/score", () => {
  it("refuses a foreign id and leaves the row alone", async () => {
    const before = snapshotRow("contacts", seedA.contactIds[1]);
    const res = await asUser(B)(
      request(app).get(`/api/contacts/${seedA.contactIds[1]}/score`),
    );
    expect(res.status).toBe(404);
    // explainScore writes relationshipScore back, so a leak here is a write.
    expect(snapshotRow("contacts", seedA.contactIds[1])).toEqual(before);
  });

  it("serves the breakdown to its owner", async () => {
    const res = await asUser(A)(
      request(app).get(`/api/contacts/${seedA.contactIds[1]}/score`),
    );
    expect(res.status).toBe(200);
    expect(typeof res.body.score).toBe("number");
  });
});

// =============================================================================
// List endpoints
// =============================================================================

describe("list endpoints return only the caller's rows", () => {
  it("GET /api/contacts (slim) excludes the other owner", async () => {
    const forB = await asUser(B)(request(app).get("/api/contacts?view=slim"));
    const forA = await asUser(A)(request(app).get("/api/contacts?view=slim"));

    expect(forB.status).toBe(200);
    expect(ids(forB.body).sort()).toEqual([...seedB.contactIds].sort());
    expect(ids(forA.body)).toEqual(expect.arrayContaining(seedA.contactIds));
    for (const id of seedA.contactIds) expect(ids(forB.body)).not.toContain(id);
    for (const id of seedB.contactIds) expect(ids(forA.body)).not.toContain(id);
  });

  it("GET /api/contacts (full) excludes the other owner", async () => {
    const forB = await asUser(B)(request(app).get("/api/contacts"));
    expect(forB.status).toBe(200);
    expect(ids(forB.body).sort()).toEqual([...seedB.contactIds].sort());
  });

  it("GET /api/contacts/map excludes the other owner", async () => {
    const placed = seedA.contactIds[2];
    const patched = await asUser(A)(
      request(app)
        .patch(`/api/contacts/${placed}`)
        .send({ lat: 51.5, lng: -0.1 }),
    );
    expect(patched.status).toBe(200);

    const forA = await asUser(A)(request(app).get("/api/contacts/map"));
    const forB = await asUser(B)(request(app).get("/api/contacts/map"));
    expect(ids(forA.body)).toEqual([placed]);
    expect(forB.body).toEqual([]);
  });

  it("GET /api/contacts/archived excludes the other owner", async () => {
    const archived = seedA.contactIds[3];
    const patched = await asUser(A)(
      request(app)
        .patch(`/api/contacts/${archived}`)
        .send({ isArchived: true }),
    );
    expect(patched.status).toBe(200);

    const forA = await asUser(A)(request(app).get("/api/contacts/archived"));
    const forB = await asUser(B)(request(app).get("/api/contacts/archived"));
    expect(ids(forA.body)).toEqual([archived]);
    expect(forB.body).toEqual([]);
  });
});

// =============================================================================
// Writing
// =============================================================================

describe("POST /api/contacts", () => {
  it("stamps the caller and leaves the other owner's counts alone", async () => {
    const beforeA = rowsOwnedBy("contacts", A.user.id);
    const res = await asUser(B)(
      request(app).post("/api/contacts").send({ name: "Bob Newcomer" }),
    );
    expect(res.status).toBe(201);
    expect(snapshotRow("contacts", res.body.id)?.ownerId).toBe(B.user.id);
    expect(rowsOwnedBy("contacts", A.user.id)).toBe(beforeA);
    seedB.contactIds.push(res.body.id);
  });
});

describe("PUT and PATCH /api/contacts/:id", () => {
  it("refuse a foreign id and leave the row byte-identical", async () => {
    const target = seedA.contactIds[4];
    const before = snapshotRow("contacts", target);

    const put = await asUser(B)(
      request(app).put(`/api/contacts/${target}`).send({ name: "Taken Over" }),
    );
    const patch = await asUser(B)(
      request(app).patch(`/api/contacts/${target}`).send({ company: "Bob Co" }),
    );

    expect(put.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(snapshotRow("contacts", target)).toEqual(before);
  });

  it("give a foreign id the same 404 body as an unknown id", async () => {
    const foreign = await asUser(B)(
      request(app)
        .patch(`/api/contacts/${seedA.contactIds[4]}`)
        .send({ company: "Bob Co" }),
    );
    const unknown = await asUser(B)(
      request(app)
        .patch(`/api/contacts/${randomId()}`)
        .send({ company: "Bob Co" }),
    );
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });
});

describe("DELETE /api/contacts/:id", () => {
  it("refuses a foreign id and leaves the row out of the trash", async () => {
    const target = seedA.contactIds[5];
    const before = snapshotRow("contacts", target);

    const res = await asUser(B)(request(app).delete(`/api/contacts/${target}`));

    expect(res.status).toBe(404);
    expect(snapshotRow("contacts", target)).toEqual(before);
    expect(snapshotRow("contacts", target)?.deletedAt).toBeNull();
  });
});

describe("POST /api/contacts/:id/avatar", () => {
  it("refuses an upload onto a foreign contact", async () => {
    const target = seedA.contactIds[0];
    const before = snapshotRow("contacts", target);

    const res = await asUser(B)(
      request(app)
        .post(`/api/contacts/${target}/avatar`)
        .attach("avatar", PNG_1X1, {
          filename: "bob.png",
          contentType: "image/png",
        }),
    );

    expect(res.status).toBe(404);
    expect(snapshotRow("contacts", target)).toEqual(before);
  });
});

describe("POST /api/contacts/:id/enrich", () => {
  it("refuses a foreign contact before any provider call", async () => {
    const res = await asUser(B)(
      request(app).post(`/api/contacts/${seedA.contactIds[6]}/enrich`),
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("gets past the ownership check for its own contact", async () => {
    // No provider is configured in integration, so the request fails later in
    // the pipeline. What matters here is that it is not a 404.
    const res = await asUser(B)(
      request(app).post(`/api/contacts/${seedB.contactIds[0]}/enrich`),
    );
    expect(res.status).not.toBe(404);
  });
});

// =============================================================================
// Bulk endpoints
// =============================================================================

describe("bulk endpoints affect only the caller's rows", () => {
  it("POST /api/contacts/bulk-delete reports and deletes B's rows only", async () => {
    const mine = seedB.contactIds.slice(0, 2);
    const theirs = seedA.contactIds.slice(7, 10);
    const beforeA = snapshotA();
    const beforeCount = rowsOwnedBy("contacts", A.user.id);

    const res = await asUser(B)(
      request(app)
        .post("/api/contacts/bulk-delete")
        .send({ ids: [...theirs, ...mine] }),
    );

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(mine.length);
    expect(rowsOwnedBy("contacts", A.user.id)).toBe(beforeCount);
    expect(snapshotA()).toEqual(beforeA);
    for (const id of mine) {
      expect(snapshotRow("contacts", id)?.deletedAt).not.toBeNull();
    }
  });

  it("PUT /api/contacts/bulk-update reports and updates B's rows only", async () => {
    const mine = seedB.contactIds.slice(2, 4);
    const theirs = seedA.contactIds.slice(10, 13);
    const beforeA = snapshotA();

    const res = await asUser(B)(
      request(app)
        .put("/api/contacts/bulk-update")
        .send({
          ids: [...theirs, ...mine],
          data: { company: "Bob Industries" },
        }),
    );

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(mine.length);
    expect(snapshotA()).toEqual(beforeA);
    for (const id of mine) {
      expect(snapshotRow("contacts", id)?.company).toBe("Bob Industries");
    }
  });
});

describe("POST /api/contacts/bulk", () => {
  it("never matches an import against another owner's contact", async () => {
    // A has a contact that would be an exact name and email duplicate of what
    // B is about to import. Import-time matching auto-merges on that, so a
    // cross-owner match would silently rewrite A's row.
    const twin = await asUser(A)(
      request(app)
        .post("/api/contacts")
        .send({ name: "Rosalind Franklin", emails: ["rosalind@kings.ac.uk"] }),
    );
    expect(twin.status).toBe(201);
    seedA.contactIds.push(twin.body.id);
    const beforeTwin = snapshotRow("contacts", twin.body.id);
    const beforeCount = rowsOwnedBy("contacts", A.user.id);

    const res = await asUser(B)(
      request(app)
        .post("/api/contacts/bulk")
        .set("Accept", "text/event-stream")
        .send([
          { name: "Rosalind Franklin", emails: ["rosalind@kings.ac.uk"] },
        ]),
    );

    expect(res.status).toBe(200);
    const summary = res.text
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.replace(/^data: /, "")))
      .find((event) => event.done);
    expect(summary.summary.imported).toBe(1);
    expect(summary.summary.autoMerged).toBe(0);
    expect(summary.summary.needsReview).toBe(0);

    // A's twin is untouched, no row of A's was added or removed, and no
    // suggestion was filed against A.
    expect(snapshotRow("contacts", twin.body.id)).toEqual(beforeTwin);
    expect(rowsOwnedBy("contacts", A.user.id)).toBe(beforeCount);
    expect(rowsOwnedBy("dedupe_suggestions", A.user.id)).toBe(0);
  });
});

// =============================================================================
// Uploads
// =============================================================================

describe("the /uploads guard", () => {
  it("serves an owner their own file", async () => {
    const res = await asUser(A)(request(app).get(avatarUrlA));
    expect(res.status).toBe(200);
  });

  it("answers 404 for another owner's file that exists", async () => {
    const res = await asUser(B)(request(app).get(avatarUrlA));
    expect(res.status).toBe(404);
  });

  it("serves shared logos to both owners", async () => {
    for (const actor of [A, B]) {
      const res = await asUser(actor)(
        request(app).get("/uploads/logos/acme.png"),
      );
      expect(res.status, actor.user.username).toBe(200);
    }
  });

  it("answers 404 for a path outside /u/ and /logos/, file or not", async () => {
    const legacy = await asUser(A)(
      request(app).get("/uploads/avatars/legacy.png"),
    );
    const nowhere = await asUser(A)(request(app).get("/uploads/nothing-here"));
    expect(legacy.status).toBe(404);
    expect(nowhere.status).toBe(404);
  });

  it("answers 404 for a traversal out of the caller's own directory", async () => {
    const res = await asUser(B)(
      request(app).get(
        `/uploads/u/${B.user.id}/avatars/..%2f..%2f${A.user.id}/avatars/x.png`,
      ),
    );
    expect(res.status).toBe(404);
  });

  it("still needs a credential at all", async () => {
    const res = await request(app).get(avatarUrlA);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// The matrix and the manifest agree
// =============================================================================

const scoped = ROUTE_MANIFEST.filter((r) => r.class === "scoped");
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe("matrix coverage", () => {
  it("covers exactly the routes the manifest marks isolated", () => {
    const flipped = ROUTE_MANIFEST.filter((r) => r.isolated)
      .map(key)
      .sort();
    expect(flipped).toEqual([...COVERED].sort());
  });
});

describe("routes still waiting for their sub-phase", () => {
  for (const route of scoped.filter((r) => !r.isolated)) {
    it.todo(`${key(route)}: user B cannot reach user A's data`);
  }
});

/**
 * Collections need a second assertion beyond "B cannot read A's row by id":
 * the list itself must not leak A's rows into B's response, which is the
 * failure mode a per-id check cannot catch.
 */
describe("list endpoints still waiting for their sub-phase", () => {
  const collections = scoped.filter(
    (r) => r.method === "GET" && !r.path.includes("/:") && !r.isolated,
  );
  for (const route of collections) {
    it.todo(`${key(route)}: returns only the caller's rows`);
  }
});

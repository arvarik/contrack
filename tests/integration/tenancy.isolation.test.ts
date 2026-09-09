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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Two AI operations are stubbed, and only these two. Integration runs with no
// provider configured, so the real `extractMentions` returns nothing and the
// real `generateDailyInsight` returns null, which would leave the two paths
// that matter most here untestable: the mention matcher decides which contact
// a note points at, and the insight is a paragraph about one person's network
// held in a shared cache. Everything else in the barrel stays real.
vi.mock("../../server/ai/aiService.ts", async (importActual) => {
  const actual =
    await importActual<typeof import("../../server/ai/aiService.ts")>();
  return {
    ...actual,
    extractMentions: async (text: string) =>
      text.includes("MENTIONS-BOBS-CONTACT")
        ? [{ name: "bob Contact 0", company: null, context: "test" }]
        : [],
    generateDailyInsight: async (stats: { totalContacts: number }) => ({
      text: `Insight over ${stats.totalContacts} contacts`,
      category: "growth",
      generatedAt: new Date().toISOString(),
    }),
  };
});
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { ROUTE_MANIFEST } from "../../server/tenancy/routeManifest.ts";
import {
  WEIGHTS,
  lexicalSearch,
} from "../../server/services/search/lexical.ts";
import { ownerToken } from "../../server/tenancy/scope.ts";
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
  "DELETE /api/action-items/:id",
  "DELETE /api/contacts/:id",
  "DELETE /api/interactions/:id",
  "DELETE /api/lists/:id",
  "DELETE /api/lists/:id/members/:contactId",
  "GET /api/action-items",
  "GET /api/action-items/completed",
  "GET /api/action-items/count",
  "GET /api/command-palette/zero-state",
  "GET /api/contacts",
  "GET /api/contacts/:id",
  "GET /api/contacts/:id/action-items",
  "GET /api/contacts/:id/relationships",
  "GET /api/contacts/:id/score",
  "GET /api/contacts/:id/timeline",
  "GET /api/contacts/archived",
  "GET /api/contacts/map",
  "GET /api/dashboard",
  "GET /api/dashboard/insight",
  "GET /api/lists",
  "GET /api/lists/:id/contacts",
  "GET /api/search",
  "PATCH /api/action-items/:id",
  "PATCH /api/action-items/:id/complete",
  "PATCH /api/contacts/:id",
  "PATCH /api/interactions/:id",
  "PATCH /api/lists/:id",
  "POST /api/contacts",
  "POST /api/contacts/:id/action-items",
  "POST /api/contacts/:id/attachments",
  "POST /api/contacts/:id/avatar",
  "POST /api/contacts/:id/briefing",
  "POST /api/contacts/:id/enrich",
  "POST /api/contacts/:id/interactions",
  "POST /api/contacts/:id/promote",
  "POST /api/contacts/bulk",
  "POST /api/contacts/bulk-delete",
  "POST /api/lists",
  "POST /api/lists/:id/members",
  "POST /api/lists/:id/members/bulk",
  "POST /api/search/semantic",
  "POST /api/search/synthesize",
  "PUT /api/contacts/:id",
  "PUT /api/contacts/bulk-update",
  "PUT /api/lists/reorder",
  "USE /uploads",
];

/** The smallest valid PNG, so multer's MIME filter has something real. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let A: Actor;
let B: Actor;
/** A third account that never writes a row, for the "sees nothing" numbers. */
let C: Actor;
let seedA: Seeded;
let seedB: Seeded;
/** A's avatar URL, uploaded through the route so the file really exists. */
let avatarUrlA: string;
/**
 * A's contact with a name nobody else on the instance shares.
 *
 * Every search channel is asked for this token by an account that does not own
 * it. "Zebulon Quarrington" appears in no other row, so a single hit anywhere
 * in a response is proof the channel crossed an owner boundary.
 */
let zebulonId: string;
const ZEBULON = "Zebulon Quarrington";

const randomId = () => crypto.randomUUID();
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/** The error body with the two fields that legitimately differ removed. */
function comparableError(body: { error?: Record<string, unknown> }) {
  const { requestId, stack, ...rest } = body.error ?? {};
  void requestId;
  void stack;
  return rest;
}

/** The contacts an owner's dashboard should count as active. */
function activeCount(ownerId: string): number {
  return (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts
          WHERE ownerId = ? AND deletedAt IS NULL AND canonicalId IS NULL
            AND isGhost = 0 AND COALESCE(isArchived, 0) = 0`,
      )
      .get(ownerId) as { n: number }
  ).n;
}

/** The contact ids one interaction is linked to through a mention row. */
function mentionedContactIds(interactionId: string): string[] {
  return (
    sqlite
      .prepare(
        "SELECT contactId FROM interaction_mentions WHERE interactionId = ?",
      )
      .all(interactionId) as { contactId: string }[]
  ).map((r) => r.contactId);
}

/** The contact ids currently in one list. */
function memberIds(listId: string): string[] {
  return (
    sqlite
      .prepare("SELECT contactId FROM list_members WHERE listId = ?")
      .all(listId) as { contactId: string }[]
  ).map((r) => r.contactId);
}

/** Poll until `read` returns something truthy, or give up. */
async function eventually<T>(read: () => T, tries = 60): Promise<T> {
  let value = read();
  for (let i = 0; i < tries && !value; i++) {
    await new Promise((r) => setTimeout(r, 20));
    value = read();
  }
  return value;
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
  C = await createActor(app, { username: "carol", email: "carol@example.com" });

  seedA = await seedOwner(app, A, {
    contacts: 20,
    interactions: 10,
    lists: 2,
    actionItems: 5,
  });
  seedB = await seedOwner(app, B, { contacts: 5 });

  const rare = await asUser(A)(
    request(app).post("/api/contacts").send({
      name: ZEBULON,
      company: "Quarrington Holdings",
      role: "Actuary",
    }),
  );
  expect(rare.status).toBe(201);
  zebulonId = rare.body.id;

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
// Interactions
// =============================================================================

describe("GET /api/contacts/:id/timeline", () => {
  it("answers a foreign parent and an unknown one the same way", async () => {
    const foreign = await asUser(B)(
      request(app).get(`/api/contacts/${seedA.contactIds[13]}/timeline`),
    );
    const unknown = await asUser(B)(
      request(app).get(`/api/contacts/${randomId()}/timeline`),
    );
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });

  it("returns the owner's own interactions and no others", async () => {
    const res = await asUser(A)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}/timeline`),
    );
    expect(res.status).toBe(200);
    expect(ids(res.body).sort()).toEqual([...seedA.interactionIds].sort());
  });
});

describe("POST /api/contacts/:id/interactions", () => {
  it("refuses a foreign parent and writes nothing", async () => {
    const before = rowsOwnedBy("interactions", A.user.id);
    const res = await asUser(B)(
      request(app)
        .post(`/api/contacts/${seedA.contactIds[13]}/interactions`)
        .send({ type: "note", title: "Bob was here" }),
    );
    expect(res.status).toBe(404);
    expect(rowsOwnedBy("interactions", A.user.id)).toBe(before);
  });

  it("drops a data-id mention of another owner's contact", async () => {
    // The mention ids arrive in the request body. Before 2b any id at all was
    // linked, so a crafted note attached a mention row to a stranger's
    // contact and every later read of the graph crossed the boundary.
    const mine = seedA.contactIds[14];
    const theirs = seedB.contactIds[0];
    const res = await asUser(A)(
      request(app)
        .post(`/api/contacts/${seedA.contactIds[13]}/interactions`)
        .send({
          type: "note",
          title: "Mixed mentions",
          content:
            `<p>Met <span data-type="mention" data-id="${theirs}">@Bob</span>` +
            ` and <span data-type="mention" data-id="${mine}">@Ann</span></p>`,
        }),
    );
    expect(res.status).toBe(201);
    expect(mentionedContactIds(res.body.id)).toEqual([mine]);
  });

  it("gives a mention-extracted ghost to the caller, not the matching stranger", async () => {
    // The stub returns the exact name of one of B's contacts. An unscoped
    // name match would link A's note to B's row; the scoped match finds
    // nothing and creates a ghost A owns.
    const strangersContact = seedB.contactIds[0];
    const strangersName = snapshotRow("contacts", strangersContact)
      ?.name as string;

    const previous = process.env.DISABLE_BACKGROUND_JOBS;
    process.env.DISABLE_BACKGROUND_JOBS = "";
    let created;
    try {
      created = await asUser(A)(
        request(app)
          .post(`/api/contacts/${seedA.contactIds[15]}/interactions`)
          .send({
            type: "note",
            title: "Ghost source",
            content: "MENTIONS-BOBS-CONTACT came up again",
          }),
      );
    } finally {
      process.env.DISABLE_BACKGROUND_JOBS = previous;
    }
    expect(created.status).toBe(201);

    const stored = await eventually(
      () =>
        (
          sqlite
            .prepare("SELECT mentions FROM interactions WHERE id = ?")
            .get(created.body.id) as { mentions: string | null }
        ).mentions,
    );
    expect(stored, "mention extraction never wrote its result").toBeTruthy();

    const mapped = JSON.parse(stored as string) as { contactId: string }[];
    expect(mapped).toHaveLength(1);
    expect(mapped[0].contactId).not.toBe(strangersContact);

    const ghost = snapshotRow("contacts", mapped[0].contactId);
    expect(ghost?.ownerId).toBe(A.user.id);
    expect(ghost?.name).toBe(strangersName);
    expect(ghost?.isGhost).toBe(1);
    seedA.contactIds.push(mapped[0].contactId);
  });
});

describe("PATCH and DELETE /api/interactions/:id", () => {
  it("refuse a foreign interaction and leave the row byte-identical", async () => {
    const target = seedA.interactionIds[0];
    const before = snapshotRow("interactions", target);

    const patch = await asUser(B)(
      request(app)
        .patch(`/api/interactions/${target}`)
        .send({ title: "Rewritten by Bob" }),
    );
    const del = await asUser(B)(
      request(app).delete(`/api/interactions/${target}`),
    );

    expect(patch.status).toBe(404);
    expect(del.status).toBe(404);
    expect(snapshotRow("interactions", target)).toEqual(before);
  });

  it("give a foreign id the same 404 body as an unknown id", async () => {
    const foreign = await asUser(B)(
      request(app).delete(`/api/interactions/${seedA.interactionIds[1]}`),
    );
    const unknown = await asUser(B)(
      request(app).delete(`/api/interactions/${randomId()}`),
    );
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });
});

describe("POST /api/contacts/:id/briefing", () => {
  it("refuses a foreign contact before any provider call", async () => {
    const res = await asUser(B)(
      request(app).post(`/api/contacts/${seedA.contactIds[16]}/briefing`),
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("gets past the ownership check for its own contact", async () => {
    const res = await asUser(B)(
      request(app).post(`/api/contacts/${seedB.contactIds[4]}/briefing`),
    );
    expect(res.status).not.toBe(404);
  });
});

describe("POST /api/contacts/:id/promote", () => {
  it("refuses a foreign contact and leaves it a ghost", async () => {
    const ghostOfA = seedA.contactIds[seedA.contactIds.length - 1];
    const before = snapshotRow("contacts", ghostOfA);
    const res = await asUser(B)(
      request(app).post(`/api/contacts/${ghostOfA}/promote`),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("contacts", ghostOfA)).toEqual(before);
  });

  it("promotes the owner's own ghost", async () => {
    const ghostOfA = seedA.contactIds[seedA.contactIds.length - 1];
    const res = await asUser(A)(
      request(app).post(`/api/contacts/${ghostOfA}/promote`),
    );
    expect(res.status).toBe(200);
    expect(snapshotRow("contacts", ghostOfA)?.isGhost).toBe(0);
  });
});

describe("POST /api/contacts/:id/attachments", () => {
  it("refuses a foreign parent before multer stores anything", async () => {
    const before = rowsOwnedBy("interactions", A.user.id);
    const res = await asUser(B)(
      request(app)
        .post(`/api/contacts/${seedA.contactIds[16]}/attachments`)
        .attach("attachment", Buffer.from("hello"), {
          filename: "note.txt",
          contentType: "text/plain",
        }),
    );
    expect(res.status).toBe(404);
    expect(rowsOwnedBy("interactions", A.user.id)).toBe(before);
  });

  it("stores the caller's own attachment under the caller's directory", async () => {
    const res = await asUser(B)(
      request(app)
        .post(`/api/contacts/${seedB.contactIds[4]}/attachments`)
        .attach("attachment", Buffer.from("hello"), {
          filename: "note.txt",
          contentType: "text/plain",
        }),
    );
    expect(res.status).toBe(201);
    expect(res.body.fileUrl).toContain(`/uploads/u/${B.user.id}/files/`);
    expect(snapshotRow("interactions", res.body.id)?.ownerId).toBe(B.user.id);
  });
});

describe("GET /api/contacts/:id/relationships", () => {
  it("refuses a foreign contact", async () => {
    const res = await asUser(B)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}/relationships`),
    );
    expect(res.status).toBe(404);
  });

  it("returns no contact the caller does not own", async () => {
    const res = await asUser(A)(
      request(app).get(`/api/contacts/${seedA.contactIds[15]}/relationships`),
    );
    expect(res.status).toBe(200);
    for (const row of res.body as { id: string }[]) {
      expect(snapshotRow("contacts", row.id)?.ownerId).toBe(A.user.id);
    }
  });
});

// =============================================================================
// Action items
// =============================================================================

describe("action item collections carry only the caller's rows", () => {
  it("GET /api/action-items excludes the other owner", async () => {
    const forA = await asUser(A)(request(app).get("/api/action-items"));
    const forB = await asUser(B)(request(app).get("/api/action-items"));
    expect(forA.status).toBe(200);
    expect(ids(forA.body).sort()).toEqual([...seedA.actionItemIds].sort());
    expect(forB.body).toEqual([]);
  });

  it("GET /api/action-items/completed excludes the other owner", async () => {
    const completed = await asUser(A)(
      request(app).patch(
        `/api/action-items/${seedA.actionItemIds[4]}/complete`,
      ),
    );
    expect(completed.status).toBe(200);

    const forA = await asUser(A)(
      request(app).get("/api/action-items/completed"),
    );
    const forB = await asUser(B)(
      request(app).get("/api/action-items/completed"),
    );
    expect(ids(forA.body)).toEqual([seedA.actionItemIds[4]]);
    expect(forB.body).toEqual([]);
  });

  it("GET /api/action-items/count counts only the caller's urgent items", async () => {
    const urgent = await asUser(A)(
      request(app)
        .post(`/api/contacts/${seedA.contactIds[0]}/action-items`)
        .send({ title: "Overdue already", dueAt: "2020-01-01" }),
    );
    expect(urgent.status).toBe(201);
    seedA.actionItemIds.push(urgent.body.id);

    const forA = await asUser(A)(request(app).get("/api/action-items/count"));
    const forB = await asUser(B)(request(app).get("/api/action-items/count"));
    expect(forA.body.count).toBe(1);
    expect(forB.body.count).toBe(0);
  });

  it("uses the owner composite indexes, not a scan of action_items", () => {
    const plan = (rows: { detail: string }[]) =>
      rows.map((r) => r.detail).join(" | ");
    const pending = plan(
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT ai.* FROM action_items ai JOIN contacts c ON ai.contactId = c.id
             WHERE ai.ownerId = ? AND ai.completedAt IS NULL
             ORDER BY ai.dueAt ASC`,
        )
        .all(A.user.id) as { detail: string }[],
    );
    const done = plan(
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT ai.* FROM action_items ai JOIN contacts c ON ai.contactId = c.id
             WHERE ai.ownerId = ? AND ai.completedAt IS NOT NULL
             ORDER BY ai.completedAt DESC`,
        )
        .all(A.user.id) as { detail: string }[],
    );
    const urgent = plan(
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT COUNT(*) FROM action_items ai JOIN contacts c ON ai.contactId = c.id
             WHERE ai.ownerId = ? AND ai.completedAt IS NULL
               AND date(ai.dueAt) <= date('now')
               AND (c.isArchived = 0 OR c.isArchived IS NULL)`,
        )
        .all(A.user.id) as { detail: string }[],
    );

    expect(pending).toContain("idx_action_items_owner_due");
    expect(pending).not.toContain("SCAN action_items");
    expect(done).toContain("idx_action_items_owner_done");
    expect(done).not.toContain("SCAN action_items");
    // The urgent count takes `_owner_done` rather than the partial
    // `_owner_due`. `date(ai.dueAt)` wraps the column, so the second column of
    // `_owner_due` cannot answer the range, which leaves the two indexes even
    // on the owner alone and SQLite picks the plain one. Either is an owner
    // seek, which is what matters here, so the assertion names both.
    expect(urgent).toMatch(/idx_action_items_owner_(due|done)/);
    expect(urgent).not.toContain("SCAN action_items");
  });
});

describe("action items by id", () => {
  it("PATCH refuses a foreign id and leaves the row byte-identical", async () => {
    const target = seedA.actionItemIds[0];
    const before = snapshotRow("action_items", target);
    const res = await asUser(B)(
      request(app)
        .patch(`/api/action-items/${target}`)
        .send({ title: "Bob's task now" }),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("action_items", target)).toEqual(before);
  });

  it("PATCH /complete refuses a foreign id and leaves it pending", async () => {
    const target = seedA.actionItemIds[1];
    const before = snapshotRow("action_items", target);
    const res = await asUser(B)(
      request(app).patch(`/api/action-items/${target}/complete`),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("action_items", target)).toEqual(before);
    expect(snapshotRow("action_items", target)?.completedAt).toBeNull();
  });

  it("DELETE refuses a foreign id and the row survives", async () => {
    const target = seedA.actionItemIds[2];
    const before = snapshotRow("action_items", target);
    const res = await asUser(B)(
      request(app).delete(`/api/action-items/${target}`),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("action_items", target)).toEqual(before);
  });

  it("gives a foreign id the same 404 body as an unknown id", async () => {
    const foreign = await asUser(B)(
      request(app).delete(`/api/action-items/${seedA.actionItemIds[3]}`),
    );
    const unknown = await asUser(B)(
      request(app).delete(`/api/action-items/${randomId()}`),
    );
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });
});

describe("action items under a contact", () => {
  it("GET refuses a foreign parent", async () => {
    const res = await asUser(B)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}/action-items`),
    );
    expect(res.status).toBe(404);
  });

  it("GET returns the parent's own items to its owner", async () => {
    const res = await asUser(A)(
      request(app).get(`/api/contacts/${seedA.contactIds[0]}/action-items`),
    );
    expect(res.status).toBe(200);
    expect(ids(res.body).sort()).toEqual([...seedA.actionItemIds].sort());
  });

  it("POST refuses a foreign parent and writes nothing", async () => {
    const before = rowsOwnedBy("action_items", A.user.id);
    const res = await asUser(B)(
      request(app)
        .post(`/api/contacts/${seedA.contactIds[0]}/action-items`)
        .send({ title: "Bob's idea", dueAt: "2027-06-01" }),
    );
    expect(res.status).toBe(404);
    expect(rowsOwnedBy("action_items", A.user.id)).toBe(before);
  });
});

// =============================================================================
// Lists
// =============================================================================

describe("lists", () => {
  it("GET /api/lists excludes the other owner", async () => {
    const forA = await asUser(A)(request(app).get("/api/lists"));
    const forB = await asUser(B)(request(app).get("/api/lists"));
    expect(forA.status).toBe(200);
    expect(ids(forA.body).sort()).toEqual([...seedA.listIds].sort());
    expect(forB.body).toEqual([]);
  });

  it("POST /api/lists numbers each owner's lists from zero", async () => {
    // A already has two lists. An instance-wide MAX(sortOrder) would hand B's
    // first list the number 2 and tell B how many lists exist on the box.
    const res = await asUser(B)(
      request(app).post("/api/lists").send({ name: "Bob List 0" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.sortOrder).toBe(0);
    expect(snapshotRow("lists", res.body.id)?.ownerId).toBe(B.user.id);
    seedB.listIds.push(res.body.id);
  });

  it("PATCH refuses a foreign id and leaves the row byte-identical", async () => {
    const target = seedA.listIds[0];
    const before = snapshotRow("lists", target);
    const res = await asUser(B)(
      request(app).patch(`/api/lists/${target}`).send({ name: "Bob's list" }),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("lists", target)).toEqual(before);
  });

  it("DELETE answers a foreign id exactly as it answers an unknown one", async () => {
    // This route is deliberately idempotent: a missing list is a success, not
    // a 404. What matters is that the two answers are identical and that A's
    // list is still there afterwards.
    const target = seedA.listIds[1];
    const foreign = await asUser(B)(
      request(app).delete(`/api/lists/${target}`),
    );
    const unknown = await asUser(B)(
      request(app).delete(`/api/lists/${randomId()}`),
    );
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual(unknown.body);
    expect(snapshotRow("lists", target)).toBeTruthy();
  });

  it("PUT /api/lists/reorder answers 404 for a foreign id", async () => {
    const before = snapshotRow("lists", seedA.listIds[0]);
    const res = await asUser(B)(
      request(app)
        .put("/api/lists/reorder")
        .send({ orderedIds: [seedA.listIds[0]] }),
    );
    expect(res.status).toBe(404);
    expect(snapshotRow("lists", seedA.listIds[0])).toEqual(before);
  });

  it("PUT /api/lists/reorder still renumbers the caller's own lists", async () => {
    const res = await asUser(B)(
      request(app)
        .put("/api/lists/reorder")
        .send({ orderedIds: [...seedB.listIds] }),
    );
    expect(res.status).toBe(200);
    expect(snapshotRow("lists", seedB.listIds[0])?.sortOrder).toBe(0);
  });

  it("GET /api/lists/:id/contacts refuses a foreign list", async () => {
    const foreign = await asUser(B)(
      request(app).get(`/api/lists/${seedA.listIds[0]}/contacts`),
    );
    const unknown = await asUser(B)(
      request(app).get(`/api/lists/${randomId()}/contacts`),
    );
    expect(foreign.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
  });
});

describe("list membership checks both sides", () => {
  it("POST /:id/members refuses a foreign list", async () => {
    const res = await asUser(B)(
      request(app)
        .post(`/api/lists/${seedA.listIds[0]}/members`)
        .send({ contactId: seedB.contactIds[4] }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /:id/members refuses a foreign contact on the caller's own list", async () => {
    const res = await asUser(B)(
      request(app)
        .post(`/api/lists/${seedB.listIds[0]}/members`)
        .send({ contactId: seedA.contactIds[16] }),
    );
    expect(res.status).toBe(404);
    expect(memberIds(seedB.listIds[0])).not.toContain(seedA.contactIds[16]);
  });

  it("DELETE /:id/members/:contactId refuses a foreign list and keeps the row", async () => {
    const added = await asUser(A)(
      request(app)
        .post(`/api/lists/${seedA.listIds[0]}/members`)
        .send({ contactId: seedA.contactIds[17] }),
    );
    expect(added.status).toBe(200);
    expect(memberIds(seedA.listIds[0])).toContain(seedA.contactIds[17]);

    // Before 2b this route checked nothing at all and ran the DELETE on
    // whatever pair of ids arrived, so any caller could empty a list they had
    // never seen.
    const res = await asUser(B)(
      request(app).delete(
        `/api/lists/${seedA.listIds[0]}/members/${seedA.contactIds[17]}`,
      ),
    );
    expect(res.status).toBe(404);
    expect(memberIds(seedA.listIds[0])).toContain(seedA.contactIds[17]);
  });

  it("POST /:id/members/bulk refuses a foreign list", async () => {
    const res = await asUser(B)(
      request(app)
        .post(`/api/lists/${seedA.listIds[0]}/members/bulk`)
        .send({ contactIds: [seedB.contactIds[4]] }),
    );
    expect(res.status).toBe(404);
    expect(memberIds(seedA.listIds[0])).not.toContain(seedB.contactIds[4]);
  });

  it("POST /:id/members/bulk adds nobody when one id is foreign", async () => {
    const before = memberIds(seedB.listIds[0]);
    const res = await asUser(B)(
      request(app)
        .post(`/api/lists/${seedB.listIds[0]}/members/bulk`)
        .send({ contactIds: [seedB.contactIds[4], seedA.contactIds[18]] }),
    );
    expect(res.status).toBe(404);
    expect(memberIds(seedB.listIds[0])).toEqual(before);
  });

  it("POST /:id/members/bulk still adds the caller's own contacts", async () => {
    const res = await asUser(B)(
      request(app)
        .post(`/api/lists/${seedB.listIds[0]}/members/bulk`)
        .send({ contactIds: [seedB.contactIds[4]] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(memberIds(seedB.listIds[0])).toContain(seedB.contactIds[4]);
  });
});

// =============================================================================
// Dashboard, insight, zero-state
// =============================================================================

describe("GET /api/dashboard", () => {
  it("counts only the caller's rows", async () => {
    const forA = await asUser(A)(request(app).get("/api/dashboard"));
    const forB = await asUser(B)(request(app).get("/api/dashboard"));
    expect(forA.status).toBe(200);
    expect(forA.body.metrics.totalActive).toBe(activeCount(A.user.id));
    expect(forB.body.metrics.totalActive).toBe(activeCount(B.user.id));

    // Ownership is read back off the row rather than compared against the
    // seed list, because B has also imported a contact by now.
    const cards = [
      ...(forB.body.recentlyAdded as { id: string }[]),
      ...(forB.body.networkGrowthTimeline30d as { id: string }[]),
      ...(forB.body.atRisk as { id: string }[]),
      ...(forB.body.ghosts as { id: string }[]),
    ];
    expect(cards.length).toBeGreaterThan(0);
    for (const row of cards) {
      expect(snapshotRow("contacts", row.id)?.ownerId).toBe(B.user.id);
    }
    expect(ids(forB.body.overdue)).toEqual([]);
    expect(ids(forB.body.dueToday)).toEqual([]);
  });

  it("shows an owner with no rows every total at zero", async () => {
    // A has more than twenty contacts and interactions by now. None of it may
    // reach an account that has written nothing.
    const res = await asUser(C)(request(app).get("/api/dashboard"));
    expect(res.status).toBe(200);
    expect(res.body.metrics).toMatchObject({
      totalActive: 0,
      atRiskCount: 0,
      totalInteractions30d: 0,
      newContacts30d: 0,
    });
    expect(res.body.ghosts).toEqual([]);
    expect(res.body.atRisk).toEqual([]);
    expect(res.body.recentlyAdded).toEqual([]);
    expect(res.body.industryComposition).toEqual([]);
    expect(res.body.locationComposition).toEqual([]);
    expect(res.body.roleComposition).toEqual([]);
    expect(res.body.interactionBreakdown30d).toEqual([]);
    expect(res.body.networkGrowthTimeline30d).toEqual([]);
    expect(res.body.overdue).toEqual([]);
    expect(res.body.dueToday).toEqual([]);
    expect(res.body.upcoming).toEqual([]);
  });
});

describe("GET /api/dashboard/insight", () => {
  it("never serves one owner the paragraph generated for another", async () => {
    // The insight is a sentence about a person's own network held in a shared
    // cache. Before 2d the key described the instance, so whoever opened the
    // dashboard first published their paragraph to everybody for 24 hours.
    const forA = await asUser(A)(request(app).get("/api/dashboard/insight"));
    const forB = await asUser(B)(request(app).get("/api/dashboard/insight"));

    expect(forA.status).toBe(200);
    expect(forB.status).toBe(200);
    expect(forA.body.text).toBe(
      `Insight over ${activeCount(A.user.id)} contacts`,
    );
    expect(forB.body.text).toBe(
      `Insight over ${activeCount(B.user.id)} contacts`,
    );
    expect(forB.body.text).not.toBe(forA.body.text);
  });

  it("serves each owner their own entry from the cache on the second call", async () => {
    const again = await asUser(B)(request(app).get("/api/dashboard/insight"));
    expect(again.body.text).toBe(
      `Insight over ${activeCount(B.user.id)} contacts`,
    );
  });

  it("returns nothing at all to an owner with no contacts", async () => {
    const res = await asUser(C)(request(app).get("/api/dashboard/insight"));
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe("GET /api/command-palette/zero-state", () => {
  it("names no contact the caller does not own", async () => {
    const res = await asUser(B)(
      request(app).get("/api/command-palette/zero-state"),
    );
    expect(res.status).toBe(200);
    const mine = new Set(seedB.contactIds);
    for (const insight of res.body.insights as {
      contact?: { id: string };
    }[]) {
      if (insight.contact) expect(mine.has(insight.contact.id)).toBe(true);
    }
  });

  it("is empty for an owner with no rows", async () => {
    const res = await asUser(C)(
      request(app).get("/api/command-palette/zero-state"),
    );
    expect(res.status).toBe(200);
    expect(res.body.insights).toEqual([]);
  });

  it("counts the caller's own urgent items", async () => {
    const forA = await asUser(A)(
      request(app).get("/api/command-palette/zero-state"),
    );
    const urgent = (
      forA.body.insights as { type: string; count?: number }[]
    ).find((i) => i.type === "action_items");
    expect(urgent?.count).toBe(1);
  });
});

// =============================================================================
// Search
// =============================================================================
// Every search channel reads from an index that holds the whole instance, so
// each one is asked for A's rare name by an account that does not own it.

describe("GET /api/search", () => {
  it("finds A's rare contact for A and for nobody else", async () => {
    const forA = await asUser(A)(
      request(app).get("/api/search").query({ q: "Quarrington" }),
    );
    expect(forA.status).toBe(200);
    expect(ids(forA.body)).toEqual([zebulonId]);

    for (const other of [B, C]) {
      const res = await asUser(other)(
        request(app).get("/api/search").query({ q: "Quarrington" }),
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    }
  });

  it("returns only the caller's rows for a token both accounts share", async () => {
    // Both seeds contain the word "Contact", so this asks the ranking path,
    // not the empty-result path.
    const forB = await asUser(B)(
      request(app).get("/api/search").query({ q: "Contact" }),
    );
    expect(forB.status).toBe(200);
    expect(forB.body.length).toBeGreaterThan(0);
    for (const row of forB.body as { id: string }[]) {
      expect(snapshotRow("contacts", row.id)?.ownerId).toBe(B.user.id);
    }
  });

  it("applies a facet filter inside the caller's own rows", async () => {
    const filters = JSON.stringify([
      { field: "company", value: "Quarrington Holdings" },
    ]);
    const forA = await asUser(A)(
      request(app).get("/api/search").query({ q: "Quarrington", filters }),
    );
    expect(ids(forA.body)).toEqual([zebulonId]);
    const forB = await asUser(B)(
      request(app).get("/api/search").query({ q: "Quarrington", filters }),
    );
    expect(forB.body).toEqual([]);
  });

  it("filters inside the FTS index, before any hydration guard runs", () => {
    // The route is guarded twice: the owner token restricts the index, and
    // hydration then loads rows through a scoped finder. This calls the index
    // layer on its own, so removing the token fails here rather than being
    // covered up by the second guard.
    expect(
      lexicalSearch(A.scope, "Quarrington").map((r) => r.contactId),
    ).toEqual([zebulonId]);
    expect(lexicalSearch(B.scope, "Quarrington")).toEqual([]);
    expect(lexicalSearch(C.scope, "Quarrington")).toEqual([]);
  });

  it("answers the owner token from the FTS index, not from a post-filter", () => {
    // The whole point of an indexed ownerTok column: FTS5 intersects the
    // owner's posting list with the query's inside the index. A plan with a
    // scan of `contacts` would mean the owner was applied after the fact, over
    // rows the caller may not read. The statement mirrors lexical.ts.
    const detail = (
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT c.id FROM contacts_fts f
             JOIN contacts c ON c.rowid = f.rowid
             WHERE contacts_fts MATCH ? AND c.ownerId = ?
               AND c.isGhost = 0 AND COALESCE(c.isArchived, 0) = 0
               AND c.canonicalId IS NULL AND c.deletedAt IS NULL
             ORDER BY bm25(contacts_fts, ${WEIGHTS}), c.id LIMIT ?`,
        )
        .all(
          `ownerTok:${ownerToken(A.scope)} AND ("quar"*)`,
          A.user.id,
          20,
        ) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join(" | ");

    // "SCAN f VIRTUAL TABLE INDEX 0:M11" is FTS5 answering the MATCH from its
    // own index, and the contact row is then fetched by rowid. Neither side
    // reads a row the owner token did not already choose.
    expect(detail).toContain("VIRTUAL TABLE INDEX");
    expect(detail).toContain("SEARCH c USING INTEGER PRIMARY KEY");
    expect(detail).not.toContain("SCAN contacts");
  });

  it("seeks the owner composite index for the hard-filter corpus", () => {
    // The corpus query behind the query plan's `must` filters. It reads every
    // active contact of one owner, so it must start at that owner rather than
    // scan the table. The statement mirrors hybridRetrieval.applyHardFilters.
    const detail = (
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT c.id, c.location, c.company, c.role, c.headline, c.industry
             FROM contacts c
             WHERE c.ownerId = ? AND c.isGhost = 0
               AND COALESCE(c.isArchived, 0) = 0
               AND c.canonicalId IS NULL AND c.deletedAt IS NULL`,
        )
        .all(A.user.id) as { detail: string }[]
    )
      .map((r) => r.detail)
      .join(" | ");

    expect(detail).toContain("idx_contacts_owner_status");
    expect(detail).not.toContain("SCAN contacts");
  });
});

describe("POST /api/search/semantic", () => {
  const ask = (actor: Actor, ndjson: boolean) => {
    const req = request(app)
      .post("/api/search/semantic")
      .send({ query: "Quarrington" });
    return asUser(actor)(
      ndjson ? req.set("Accept", "application/x-ndjson") : req,
    );
  };

  it("returns A's only match to A and nothing to B as JSON", async () => {
    const forA = await ask(A, false);
    expect(forA.status).toBe(200);
    expect(ids(forA.body.matches)).toEqual([zebulonId]);

    const forB = await ask(B, false);
    expect(forB.status).toBe(200);
    expect(forB.body.matches).toEqual([]);
  });

  it("carries A's match in no NDJSON chunk sent to B", async () => {
    const forB = await ask(B, true);
    expect(forB.status).toBe(200);
    const chunks = forB.text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { matches?: { id: string }[] });
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(ids(chunk.matches ?? [])).not.toContain(zebulonId);
    }
    // A's own stream still carries it, so the assertion above is not passing
    // because the stream is empty for everybody.
    const forA = await ask(A, true);
    expect(forA.text).toContain(zebulonId);
  });

  it("never serves B the result A cached for the same query", async () => {
    // The rerank tier holds a list of hydrated contacts. Before 2c the key was
    // the query text alone, so B asking the same words was served A's rows
    // from memory, without a database read at all. A word no earlier test has
    // used keeps the four steps below in a known order.
    const phrase = { query: "Zebulon" };
    const send = (actor: Actor) =>
      asUser(actor)(request(app).post("/api/search/semantic").send(phrase));

    const firstA = await send(A);
    expect(ids(firstA.body.matches)).toEqual([zebulonId]);
    expect(firstA.body.cached).toBeUndefined();

    const firstB = await send(B);
    expect(firstB.body.matches).toEqual([]);

    const againA = await send(A);
    expect(againA.body.cached).toBe(true);
    expect(ids(againA.body.matches)).toEqual([zebulonId]);

    // B's second call is also a hit, on B's own empty entry. Two accounts,
    // two entries, one query text.
    const againB = await send(B);
    expect(againB.body.cached).toBe(true);
    expect(againB.body.matches).toEqual([]);
  });
});

describe("POST /api/search/synthesize", () => {
  const synthesize = (actor: Actor, contactIds: string[]) =>
    asUser(actor)(
      request(app)
        .post("/api/search/synthesize")
        .send({ query: "Quarrington", contactIds }),
    );

  it("refuses A's contact id with the answer a deleted id gets", async () => {
    const foreign = await synthesize(B, [zebulonId]);
    const missing = await synthesize(B, [randomId()]);
    expect(foreign.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(missing.body),
    );
  });

  it("refuses a mixed list rather than summarising the half it owns", async () => {
    // A contact created here, rather than one from the seed, because earlier
    // tests in this file archive and delete B's rows. The two calls below
    // differ by one id, so the 409 can only be about ownership.
    const mine = await asUser(B)(
      request(app).post("/api/contacts").send({ name: "Bob Fresh Contact" }),
    );
    expect(mine.status).toBe(201);

    const ownOnly = await synthesize(B, [mine.body.id]);
    expect(ownOnly.status).toBe(200);

    const mixed = await synthesize(B, [mine.body.id, zebulonId]);
    expect(mixed.status).toBe(409);
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

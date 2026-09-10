// =============================================================================
// Integration Tests — the isolation matrix
// =============================================================================
// Three real accounts, three real sessions, rows written through the public
// API. For every `scoped` route, user B tries to reach user A's data and must
// fail, and A's rows must be unchanged afterwards. The third account writes
// nothing, so every total it is shown must be zero.
//
// Phase 2 generated an `it.todo` here for each route it had not reached yet.
// Sub-phase 2i closed the phase, so a new scoped route now fails the manifest
// test instead: write its test here, add its key to `COVERED`, and flip
// `isolated`. The `COVERED` list below is checked against the manifest in
// both directions, so a route cannot be marked `isolated` without a test in
// this file, and a test here cannot cover a route the manifest has not
// flipped.
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
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { recordInvocation } from "../../server/services/aiStatsService.ts";
import { runWithContext } from "../../server/tenancy/requestContext.ts";
import {
  setSetting,
  clearSettingsCache,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { invalidateProviderCache } from "../../server/ai/providerRegistry.ts";
import { aiCache, ownerKey } from "../../server/utils/aiCache.ts";
import {
  clearOwnerEmbeddings,
  dedupeQueue,
} from "../../server/services/dedupe/index.ts";
import { softMergeContacts } from "../../server/services/dedupe/merging.ts";

const app = makeTestApp();

/** Routes proven below. Kept in step with `isolated: true` by a test. */
const COVERED = [
  "DELETE /api/action-items/:id",
  "DELETE /api/contacts/:id",
  "DELETE /api/interactions/:id",
  "DELETE /api/lists/:id",
  "DELETE /api/lists/:id/members/:contactId",
  "DELETE /api/trash/:id",
  "GET /api/action-items",
  "GET /api/action-items/completed",
  "GET /api/action-items/count",
  "GET /api/ai-search/status",
  "GET /api/ai-search/stream",
  "GET /api/ai/stats/feed",
  "GET /api/ai/stats/summary",
  "GET /api/command-palette/zero-state",
  "GET /api/contacts",
  "GET /api/contacts/:id",
  "GET /api/contacts/:id/action-items",
  "GET /api/contacts/:id/relationships",
  "GET /api/contacts/:id/score",
  "GET /api/contacts/:id/timeline",
  "GET /api/contacts/action-items",
  "GET /api/contacts/archived",
  "GET /api/contacts/map",
  "GET /api/dashboard",
  "GET /api/dashboard/insight",
  "GET /api/dedupe/active",
  "GET /api/dedupe/embedding-status",
  "GET /api/dedupe/merge-log",
  "GET /api/dedupe/status",
  "GET /api/dedupe/stream",
  "GET /api/dedupe/suggestion-for/:contactId",
  "GET /api/dedupe/suggestions",
  "GET /api/dedupe/suggestions/count",
  "GET /api/export/csv",
  "GET /api/export/json",
  "GET /api/industries",
  "GET /api/interactions/search",
  "GET /api/lists",
  "GET /api/lists/:id/contacts",
  "GET /api/query/contacts",
  "GET /api/search",
  "GET /api/tags",
  "GET /api/timeline",
  "GET /api/trash",
  "PATCH /api/action-items/:id",
  "PATCH /api/action-items/:id/complete",
  "PATCH /api/contacts/:id",
  "PATCH /api/interactions/:id",
  "PATCH /api/lists/:id",
  "POST /api/ai-search",
  "POST /api/ai-search/:batchId/cancel",
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
  "POST /api/contacts/merge",
  "POST /api/contacts/merge-batch",
  "POST /api/contacts/merge-cluster",
  "POST /api/contacts/merge-clusters",
  "POST /api/dedupe/merge-log/:id/undo",
  "POST /api/dedupe/scan",
  "POST /api/dedupe/suggestions/:id/dismiss",
  "POST /api/dedupe/suggestions/:id/merge",
  "POST /api/dev/seed-duplicates",
  "POST /api/lists",
  "POST /api/lists/:id/members",
  "POST /api/lists/:id/members/bulk",
  "POST /api/search/semantic",
  "POST /api/search/synthesize",
  "POST /api/trash/:id/restore",
  "POST /api/trash/bulk-restore",
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

/** An actor's role as the database holds it. The first account is the admin. */
function roleOf(actor: Actor): string {
  return (
    sqlite
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(actor.user.id) as {
      role: string;
    }
  ).role;
}

/** Change an actor's role. The principal is read from this row per request. */
function setRole(actor: Actor, role: "admin" | "member"): void {
  sqlite
    .prepare("UPDATE users SET role = ? WHERE id = ?")
    .run(role, actor.user.id);
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
// AI Search
// =============================================================================
// The batch queue lives in memory, not in SQLite, so nothing about it is
// protected by a WHERE clause. Every read of it is checked here.

describe("AI Search batches belong to the account that started them", () => {
  afterAll(() => jobQueue.__resetForTests());

  it("holds the cooldown against one account and the run lock against the instance", async () => {
    // A real run, with no provider configured, so every job fails at once and
    // the batch finishes in milliseconds. That is enough to set the cooldown,
    // which is the thing under test.
    jobQueue.__resetForTests();
    const subject = await asUser(A)(
      request(app).post("/api/contacts").send({ name: "Cooldown Subject" }),
    );
    expect(subject.status).toBe(201);
    const batch = jobQueue.createBatch(
      A.scope,
      [{ id: subject.body.id, name: "Cooldown Subject" }],
      "two-pass",
    );
    await jobQueue.processBatch(batch.id);
    expect(batch.status).toBe("complete");

    // A waits. B does not: the cooldown exists to stop one person burning
    // tokens, and used to make everybody else wait five minutes as well.
    const forA = jobQueue.canStartBatch(A.scope);
    expect(forA.allowed).toBe(false);
    expect(forA.yours).toBe(true);
    expect(forA.retryAfterSeconds).toBeGreaterThan(0);
    expect(jobQueue.canStartBatch(B.scope).allowed).toBe(true);

    // The run lock stays global. One provider API key serves the instance, so
    // two accounts researching at once would spend one quota twice as fast.
    expect(jobQueue.isProcessing()).toBe(false);
    jobQueue.__resetForTests();
  });

  it("shows a batch only to its own account", () => {
    jobQueue.__resetForTests();
    const batch = jobQueue.createBatch(
      A.scope,
      [{ id: zebulonId, name: ZEBULON }],
      "two-pass",
    );
    expect(jobQueue.getBatch(A.scope, batch.id)?.id).toBe(batch.id);
    expect(jobQueue.getBatch(B.scope, batch.id)).toBeNull();
    expect(jobQueue.getActiveBatches(A.scope).map((b) => b.id)).toEqual([
      batch.id,
    ]);
    expect(jobQueue.getActiveBatches(B.scope)).toEqual([]);
    jobQueue.__resetForTests();
  });
});

describe("GET /api/ai-search/status and /stream", () => {
  let batchId: string;

  beforeAll(() => {
    jobQueue.__resetForTests();
    batchId = jobQueue.createBatch(
      A.scope,
      [{ id: zebulonId, name: ZEBULON }],
      "two-pass",
    ).id;
  });
  afterAll(() => jobQueue.__resetForTests());

  const status = (actor: Actor, id: string) =>
    asUser(actor)(
      request(app).get("/api/ai-search/status").query({ batchId: id }),
    );

  it("answers B's poll for A's batch the way it answers an id that never existed", async () => {
    const own = await status(A, batchId);
    const foreign = await status(B, batchId);
    const missing = await status(B, randomId());

    expect(own.status).toBe(200);
    expect(own.body.id).toBe(batchId);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(missing.body),
    );
  });

  it("closes B's stream with 404 before any event reaches it", async () => {
    const res = await asUser(B)(
      request(app).get("/api/ai-search/stream").query({ batchId }),
    );
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("data:");
    expect(res.text).not.toContain(zebulonId);
  });

  it("refuses B's cancel and leaves A's batch running", async () => {
    const res = await asUser(B)(
      request(app).post(`/api/ai-search/${batchId}/cancel`),
    );
    expect(res.status).toBe(404);
    expect(jobQueue.getBatch(A.scope, batchId)?.status).toBe("processing");

    const own = await asUser(A)(
      request(app).post(`/api/ai-search/${batchId}/cancel`),
    );
    expect(own.status).toBe(200);
    expect(own.body.status).toBe("cancelled");
  });

  it("opens the stream for the owner and sends the batch", async () => {
    // Runs after the cancel above, so the batch is terminal and the handler
    // ends the response with its first write instead of holding it open.
    const own = await asUser(A)(
      request(app).get("/api/ai-search/stream").query({ batchId }),
    );
    expect(own.status).toBe(200);
    expect(own.text).toContain(batchId);
  });
});

describe("POST /api/ai-search", () => {
  beforeAll(() => {
    // A self-hosted endpoint, so the route gets past the "no AI provider"
    // gate and reaches the checks this file is about. Nothing calls out: the
    // batch never runs.
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-test",
        label: "Local",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    setSetting(SETTING_KEYS.aiCapabilities, {
      deep: { mode: "pinned", providerId: "custom:local-test", model: "m" },
    });
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    invalidateProviderCache();
    jobQueue.__resetForTests();
    vi.spyOn(jobQueue, "processBatch").mockResolvedValue();
  });

  afterAll(() => {
    vi.restoreAllMocks();
    sqlite.prepare("DELETE FROM app_settings").run();
    clearSettingsCache();
    invalidateProviderCache();
    jobQueue.__resetForTests();
  });

  const start = (actor: Actor, contactIds: string[]) =>
    asUser(actor)(request(app).post("/api/ai-search").send({ contactIds }));

  it("refuses A's contact id with the answer an id that never existed gets", async () => {
    const foreign = await start(B, [zebulonId]);
    const missing = await start(B, [randomId()]);
    expect(foreign.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(missing.body),
    );
    expect(jobQueue.getActiveBatches(B.scope)).toEqual([]);
    expect(jobQueue.getActiveBatches(A.scope)).toEqual([]);
  });

  it("starts a batch that only its own account can see", async () => {
    const mine = await asUser(B)(
      request(app).post("/api/contacts").send({ name: "Bob Research Subject" }),
    );
    const res = await start(B, [mine.body.id]);
    expect(res.status).toBe(200);
    expect(jobQueue.getBatch(B.scope, res.body.batchId)?.id).toBe(
      res.body.batchId,
    );
    expect(jobQueue.getBatch(A.scope, res.body.batchId)).toBeNull();
    // The response carries the contract's fields and no owner id.
    expect(Object.keys(res.body).sort()).toEqual(["batchId", "jobCount"]);
  });

  it("refuses a cooldown with the standard error envelope", async () => {
    // The queue's decision is stubbed so the route's translation of it is what
    // is under test. The decision itself is proven above, against a real run.
    vi.spyOn(jobQueue, "canStartBatch").mockReturnValue({
      allowed: false,
      reason: "Please wait 42s before starting another batch.",
      yours: true,
      retryAfterSeconds: 42,
    });
    const res = await start(B, [seedB.contactIds[0]]);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(res.body.error.message).toContain("Please wait 42s");
    expect(res.body.error.details).toMatchObject({
      yours: true,
      queued: false,
      retryAfterSeconds: 42,
    });
    expect(res.body.error.requestId).toBeTruthy();
  });
});

// =============================================================================
// The shared AI cache
// =============================================================================

describe("the AI cache drops one account's entries at a time", () => {
  it("keeps another account's entry when an owner is invalidated", () => {
    const value = { matches: [], fallback: false };
    aiCache.set("rerank", ownerKey(A.scope, "same query"), value);
    aiCache.set("rerank", ownerKey(B.scope, "same query"), value);

    aiCache.invalidateForOwner("rerank", A.user.id);

    expect(aiCache.get("rerank", ownerKey(A.scope, "same query"))).toBeNull();
    expect(
      aiCache.get("rerank", ownerKey(B.scope, "same query")),
    ).not.toBeNull();
    aiCache.invalidateForOwner("rerank", B.user.id);
  });

  it("gives two accounts two entries for one query text", () => {
    // The keys differ only by owner, so a tier that ignored the prefix would
    // hold one entry and hand each account the other's contacts.
    aiCache.invalidateForOwner("briefing", A.user.id);
    aiCache.invalidateForOwner("briefing", B.user.id);
    aiCache.set("briefing", ownerKey(A.scope, "contact-1"), ["A's points"]);
    aiCache.set("briefing", ownerKey(B.scope, "contact-1"), ["B's points"]);

    expect(aiCache.get("briefing", ownerKey(A.scope, "contact-1"))).toEqual([
      "A's points",
    ]);
    expect(aiCache.get("briefing", ownerKey(B.scope, "contact-1"))).toEqual([
      "B's points",
    ]);
    aiCache.invalidateForOwner("briefing", A.user.id);
    aiCache.invalidateForOwner("briefing", B.user.id);
  });
});

// =============================================================================
// AI stats
// =============================================================================

describe("AI stats count the caller's own work", () => {
  beforeAll(() => {
    sqlite.prepare("DELETE FROM ai_invocations").run();
    // Written the way the server writes them: inside a request context, whose
    // owner `recordInvocation` reads. Nothing here names ownerId directly.
    const record = (actor: Actor, times: number) => {
      for (let i = 0; i < times; i++)
        runWithContext(
          { requestId: `seed-${i}`, principal: null, scope: actor.scope },
          () =>
            recordInvocation({
              operation: "rerank",
              model: "mock-lite",
              tokenCount: 100,
              latencyMs: 5,
              cached: false,
            }),
        );
    };
    record(A, 3);
    record(B, 1);
  });
  afterAll(() => sqlite.prepare("DELETE FROM ai_invocations").run());

  it("gives each account its own totals", async () => {
    const forA = await asUser(A)(request(app).get("/api/ai/stats/summary"));
    const forB = await asUser(B)(request(app).get("/api/ai/stats/summary"));
    const forC = await asUser(C)(request(app).get("/api/ai/stats/summary"));

    expect(forA.body.session.totalInvocations).toBe(3);
    expect(forB.body.session.totalInvocations).toBe(1);
    expect(forC.body.session.totalInvocations).toBe(0);
    expect(forA.body.session.totalTokens).toBe(300);
    expect(forB.body.session.totalTokens).toBe(100);
    expect(forC.body.session.estimatedCostUsd).toBe(0);
  });

  it("shows the shared cache counters to an admin and to nobody else", async () => {
    // The tiers are one in-process cache for the whole instance, so their hit
    // and miss counts describe everybody's traffic. A member's own spending is
    // theirs; the instance's cache behaviour is not.
    //
    // Every actor here is a member: the local owner account boot creates takes
    // the admin role, and `createUser` gives it to the first account only.
    // Phase 3 brings role management, so this promotes and restores by hand.
    expect(roleOf(A)).toBe("member");
    const asMember = await asUser(A)(request(app).get("/api/ai/stats/summary"));
    expect(asMember.body).not.toHaveProperty("cacheTiers");

    setRole(A, "admin");
    try {
      const asAdmin = await asUser(A)(
        request(app).get("/api/ai/stats/summary"),
      );
      expect(asAdmin.body.cacheTiers).toBeDefined();
      expect(asAdmin.body.cacheTiers.rerank).toBeDefined();
      // The account's own numbers are the same either way. Only the shared
      // counters appear.
      expect(asAdmin.body.session).toEqual(asMember.body.session);
    } finally {
      setRole(A, "member");
    }
  });

  it("lists only the caller's rows in the feed", async () => {
    const forA = await asUser(A)(request(app).get("/api/ai/stats/feed"));
    const forB = await asUser(B)(request(app).get("/api/ai/stats/feed"));
    const forC = await asUser(C)(request(app).get("/api/ai/stats/feed"));

    expect(forA.body.pagination.totalCount).toBe(3);
    expect(forB.body.pagination.totalCount).toBe(1);
    expect(forC.body.items).toEqual([]);

    const idsA = new Set(ids(forA.body.items));
    expect(idsA.size).toBe(3);
    for (const item of forB.body.items as { id: string }[]) {
      expect(idsA.has(item.id)).toBe(false);
    }
  });

  it("keeps the owner predicate when a filter narrows the feed", async () => {
    const filtered = await asUser(B)(
      request(app).get("/api/ai/stats/feed").query({ operation: "rerank" }),
    );
    expect(filtered.body.pagination.totalCount).toBe(1);
    const none = await asUser(B)(
      request(app).get("/api/ai/stats/feed").query({ operation: "briefing" }),
    );
    expect(none.body.pagination.totalCount).toBe(0);
  });

  it("seeks the owner index rather than scanning the invocation table", () => {
    // Mirrors getFeed. The owner is written into the statement rather than
    // assembled with the optional filters, so every shape of the query starts
    // at this index.
    const detail = (
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
             SELECT id FROM ai_invocations
             WHERE ownerId = ? AND cached = ?
             ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
        )
        .all(A.user.id, 0, 50, 0) as { detail: string }[]
    )
      .map((r) => r.detail)
      .join(" | ");

    expect(detail).toContain("idx_ai_inv_owner_created");
    expect(detail).not.toContain("SCAN ai_invocations");
  });
});

// =============================================================================
// Dedupe: scans, suggestions, merges, and the merge log
// =============================================================================
// Dedupe is the one feature whose whole job is to decide that two rows are the
// same person. Two rules govern it, and both are proved below: a scan reads
// one account's contacts, and a merge refuses a pair the caller does not own
// before it moves a single child row.
//
// The tests in this block run in order and share fixtures on purpose. A scan
// clears and rewrites the pending suggestion table, so the order the queue
// sees them in is part of what is under test.

describe("dedupe scans and merges stop at the account that asked", () => {
  /** A's identical pair, and B's identical pair with the same name and email. */
  let janeA: string[];
  let janeB: string[];
  /** A's soft-merged pair, for the merge log and undo. */
  let roeA: string[];
  let mergeLogIdA: string;
  let scanIdA: string;

  const create = async (actor: Actor, body: Record<string, unknown>) => {
    const res = await asUser(actor)(
      request(app).post("/api/contacts").send(body),
    );
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const pendingRows = (
    owner: string,
  ): { contactIdA: string; contactIdB: string }[] =>
    sqlite
      .prepare(
        `SELECT contactIdA, contactIdB FROM dedupe_suggestions
          WHERE ownerId = ? AND status = 'pending'`,
      )
      .all(owner) as { contactIdA: string; contactIdB: string }[];

  const scan = (actor: Actor, body: Record<string, unknown>) =>
    asUser(actor)(request(app).post("/api/dedupe/scan").send(body));

  const status = (actor: Actor, scanId: string) =>
    asUser(actor)(request(app).get("/api/dedupe/status").query({ scanId }));

  beforeAll(async () => {
    dedupeQueue.__resetForTests();
    // The same two people, twice. Same name, same address, different accounts.
    // A duplicate is only ever a duplicate inside one account: these four rows
    // are two problems, not one, and never six pairs.
    janeA = [
      await create(A, { name: "Jane Doe", emails: ["jane.doe@example.com"] }),
      await create(A, { name: "Jane Doe", emails: ["jane.doe@example.com"] }),
    ];
    janeB = [
      await create(B, { name: "Jane Doe", emails: ["jane.doe@example.com"] }),
      await create(B, { name: "Jane Doe", emails: ["jane.doe@example.com"] }),
    ];
    roeA = [
      await create(A, { name: "John Roe Primary" }),
      await create(A, { name: "John Roe Duplicate" }),
    ];
  });

  afterAll(() => dedupeQueue.__resetForTests());

  it("finds one cluster holding A's two contacts and nothing of B's", async () => {
    // 0.99 keeps the pair out of the auto-merger: the shared address scores
    // 0.98, so the cluster is reported for review instead of being merged
    // away, which is what the suggestion tests below need.
    const started = await scan(A, { mode: "quick", autoMergeThreshold: 0.99 });
    expect(started.status).toBe(200);
    scanIdA = started.body.scanId;

    const done = await eventually(async () => {
      const res = await status(A, scanIdA);
      return res.body.phase === "complete" ? res.body : null;
    });
    expect(done.phase).toBe("complete");
    expect(done.clusters).toHaveLength(1);
    expect(ids(done.clusters[0].contacts).sort()).toEqual([...janeA].sort());

    // Every pair the scan persisted is a pair of A's rows.
    const pairs = pendingRows(A.user.id);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].contactIdA, pairs[0].contactIdB].sort()).toEqual(
      [...janeA].sort(),
    );

    // B's identical pair is untouched: A's scan neither found it nor cleared
    // B's own review queue on its way past.
    expect(pendingRows(B.user.id)).toHaveLength(0);
    expect(rowsOwnedBy("dedupe_suggestions", B.user.id)).toBe(0);
  });

  it("answers B's status and stream for A's scan the way it answers an unknown id", async () => {
    const own = await status(A, scanIdA);
    const foreign = await status(B, scanIdA);
    const missing = await status(B, randomId());

    expect(own.status).toBe(200);
    expect(own.body.scanId).toBe(scanIdA);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(missing.body),
    );

    // A scan record carries every cluster it found with the contacts hydrated
    // inside it, so the stream has to refuse before its first write.
    const stream = await asUser(B)(
      request(app).get("/api/dedupe/stream").query({ scanId: scanIdA }),
    );
    expect(stream.status).toBe(404);
    expect(stream.text).not.toContain("data:");
    expect(stream.text).not.toContain(janeA[0]);
  });

  it("reports an active scan only to the account running it", async () => {
    dedupeQueue.__resetForTests();
    const mine = dedupeQueue.createScan(A.scope, "quick");

    const forA = await asUser(A)(request(app).get("/api/dedupe/active"));
    const forB = await asUser(B)(request(app).get("/api/dedupe/active"));

    expect(forA.body).toMatchObject({ active: true });
    expect(forA.body.scan.scanId).toBe(mine.scanId);
    expect(forB.body).toEqual({ active: false });
    dedupeQueue.__resetForTests();
  });

  it("queues the next account behind the running scan with the standard 429", async () => {
    dedupeQueue.__resetForTests();
    // A holds the global run lock. One scan at a time is a 2.0 decision: a
    // scan normalizes every contact it owns and can call a provider per
    // candidate batch, so two at once double the memory and split one quota.
    const running = dedupeQueue.createScan(A.scope, "quick");
    dedupeQueue.setProcessing(true);

    const queued = await scan(B, { mode: "quick", autoMergeThreshold: 0.99 });
    expect(queued.status).toBe(429);
    expect(queued.body.error.code).toBe("RATE_LIMITED");
    expect(queued.body.error.message).toContain("queued");
    expect(queued.body.error.details).toMatchObject({
      yours: false,
      queued: true,
    });
    expect(queued.body.error.requestId).toBeTruthy();
    expect(dedupeQueue.queueLength()).toBe(1);

    // A asking again is refused for a different reason and books no place:
    // a second scan of the same account would repeat the work of the first.
    const again = await scan(A, { mode: "quick" });
    expect(again.status).toBe(429);
    expect(again.body.error.details).toMatchObject({
      yours: true,
      queued: false,
    });
    expect(dedupeQueue.queueLength()).toBe(1);

    const waiting = dedupeQueue.getActiveScan(B.scope);
    expect(waiting).not.toBeNull();

    // A finishing hands the lock to B, and B's scan runs for B.
    dedupeQueue.complete(running.scanId, []);
    const finished = await eventually(() => {
      const scanB = dedupeQueue.getScan(B.scope, waiting!.scanId);
      return scanB?.phase === "complete" ? scanB : null;
    });
    expect(finished?.phase).toBe("complete");
    expect(dedupeQueue.queueLength()).toBe(0);

    // B's scan found B's pair, and only B's pair.
    const pairs = pendingRows(B.user.id);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].contactIdA, pairs[0].contactIdB].sort()).toEqual(
      [...janeB].sort(),
    );
    dedupeQueue.__resetForTests();
  });

  it("lists and counts only the caller's suggestions", async () => {
    const forA = await asUser(A)(request(app).get("/api/dedupe/suggestions"));
    const forB = await asUser(B)(request(app).get("/api/dedupe/suggestions"));
    const forC = await asUser(C)(request(app).get("/api/dedupe/suggestions"));

    const idsIn = (res: {
      body: { suggestions: { contactIdA: string; contactIdB: string }[] };
    }) => res.body.suggestions.flatMap((x) => [x.contactIdA, x.contactIdB]);

    expect(idsIn(forA).sort()).toEqual([...janeA].sort());
    expect(idsIn(forB).sort()).toEqual([...janeB].sort());
    expect(forC.body.suggestions).toEqual([]);

    const countA = await asUser(A)(
      request(app).get("/api/dedupe/suggestions/count"),
    );
    const countC = await asUser(C)(
      request(app).get("/api/dedupe/suggestions/count"),
    );
    expect(countA.body).toEqual({ count: 1, pairs: 1 });
    expect(countC.body).toEqual({ count: 0, pairs: 0 });
  });

  it("finds no suggestion for a contact the caller does not own", async () => {
    const own = await asUser(A)(
      request(app).get(`/api/dedupe/suggestion-for/${janeA[0]}`),
    );
    const foreign = await asUser(B)(
      request(app).get(`/api/dedupe/suggestion-for/${janeA[0]}`),
    );
    expect(own.body.suggestion).toBeTruthy();
    expect(own.body.suggestion.contactIdA).toBe([...janeA].sort()[0]);
    expect(foreign.body.suggestion).toBeNull();
  });

  it("refuses B's dismiss and B's merge of A's suggestion", async () => {
    const list = await asUser(A)(request(app).get("/api/dedupe/suggestions"));
    const suggestionId = list.body.suggestions[0].id as string;
    const before = snapshotRow("contacts", janeA[1]);

    const dismiss = await asUser(B)(
      request(app).post(`/api/dedupe/suggestions/${suggestionId}/dismiss`),
    );
    const dismissMissing = await asUser(B)(
      request(app).post(`/api/dedupe/suggestions/${randomId()}/dismiss`),
    );
    expect(dismiss.status).toBe(404);
    expect(dismissMissing.status).toBe(404);

    const merge = await asUser(B)(
      request(app)
        .post(`/api/dedupe/suggestions/${suggestionId}/merge`)
        .send({ primaryId: janeA[0] }),
    );
    expect(merge.status).toBe(404);

    // A's pair survived both attempts, and the suggestion is still pending.
    expect(snapshotRow("contacts", janeA[1])).toEqual(before);
    expect(pendingRows(A.user.id)).toHaveLength(1);
    expect(rowsOwnedBy("dedupe_exclusions", B.user.id)).toBe(0);
  });

  it("dismisses A's own suggestion and records the exclusion under A", async () => {
    const list = await asUser(A)(request(app).get("/api/dedupe/suggestions"));
    const suggestionId = list.body.suggestions[0].id as string;

    const res = await asUser(A)(
      request(app).post(`/api/dedupe/suggestions/${suggestionId}/dismiss`),
    );
    expect(res.status).toBe(200);
    expect(pendingRows(A.user.id)).toHaveLength(0);
    expect(rowsOwnedBy("dedupe_exclusions", A.user.id)).toBe(1);
    expect(rowsOwnedBy("dedupe_exclusions", B.user.id)).toBe(0);
    // B's queue is untouched by A's review.
    expect(pendingRows(B.user.id)).toHaveLength(1);
  });

  it("refuses every merge endpoint a pair of A's ids, and changes nothing", async () => {
    const before = snapshotA();
    const janeBefore = janeA.map((id) => snapshotRow("contacts", id));
    const logBefore = rowsOwnedBy("dedupe_merge_log", A.user.id);

    const single = await asUser(B)(
      request(app)
        .post("/api/contacts/merge")
        .send({ primaryId: janeA[0], duplicateId: janeA[1] }),
    );
    const unknown = await asUser(B)(
      request(app)
        .post("/api/contacts/merge")
        .send({ primaryId: randomId(), duplicateId: randomId() }),
    );
    expect(single.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(single.body.error.code).toBe(unknown.body.error.code);

    const batch = await asUser(B)(
      request(app)
        .post("/api/contacts/merge-batch")
        .send({ merges: [{ primaryId: janeA[0], duplicateId: janeA[1] }] }),
    );
    expect(batch.status).toBe(200);
    expect(batch.body.succeeded).toBe(0);

    const cluster = await asUser(B)(
      request(app)
        .post("/api/contacts/merge-cluster")
        .send({ primaryId: janeA[0], duplicateIds: [janeA[1]] }),
    );
    expect(cluster.body.merged).toBe(0);
    expect(cluster.body.failed).toBe(1);

    const clusters = await asUser(B)(
      request(app)
        .post("/api/contacts/merge-clusters")
        .send({
          clusters: [{ primaryId: janeA[0], duplicateIds: [janeA[1]] }],
        }),
    );
    expect(clusters.body.totalMerged).toBe(0);
    expect(clusters.body.totalFailed).toBe(1);

    // Nothing of A's moved, and no audit row was written under either account.
    expect(snapshotA()).toEqual(before);
    expect(janeA.map((id) => snapshotRow("contacts", id))).toEqual(janeBefore);
    expect(rowsOwnedBy("dedupe_merge_log", A.user.id)).toBe(logBefore);
    expect(rowsOwnedBy("dedupe_merge_log", B.user.id)).toBe(0);
  });

  it("refuses a mixed pair without touching the account it does not own", async () => {
    // B owns the primary, A owns the duplicate. The merge cannot run, and the
    // interesting part is what it must not do on the way to saying so.
    const mine = await create(B, { name: "Bob Mixed Merge" });
    const before = snapshotRow("contacts", janeA[0]);

    const res = await asUser(B)(
      request(app)
        .post("/api/contacts/merge")
        .send({ primaryId: mine, duplicateId: janeA[0] }),
    );
    expect(res.status).toBeLessThan(500);
    expect(snapshotRow("contacts", janeA[0])).toEqual(before);
    expect(rowsOwnedBy("dedupe_merge_log", B.user.id)).toBe(0);
  });

  it("shows the merge log and refuses B's undo of A's entry", async () => {
    // A soft merge is the shape the scan's auto-merger writes, and the only
    // shape undo accepts. Driven through the service against the real database,
    // exactly as the auto-merger drives it.
    softMergeContacts(
      A.scope,
      roeA[0],
      roeA[1],
      0.95,
      "two-owner check",
      "test",
    );

    const logA = await asUser(A)(request(app).get("/api/dedupe/merge-log"));
    const logB = await asUser(B)(request(app).get("/api/dedupe/merge-log"));
    const entry = logA.body.entries.find(
      (e: { primaryId: string }) => e.primaryId === roeA[0],
    );
    expect(entry).toBeTruthy();
    expect(entry.mergeType).toBe("soft");
    mergeLogIdA = entry.id;
    // The names come back hydrated, and B's log holds none of it.
    expect(entry.primaryName).toBe("John Roe Primary");
    expect(logB.body.entries.map((e: { id: string }) => e.id)).not.toContain(
      mergeLogIdA,
    );

    const foreign = await asUser(B)(
      request(app).post(`/api/dedupe/merge-log/${mergeLogIdA}/undo`),
    );
    const missing = await asUser(B)(
      request(app).post(`/api/dedupe/merge-log/${randomId()}/undo`),
    );
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(comparableError(foreign.body).code).toBe(
      comparableError(missing.body).code,
    );

    // The duplicate is still merged away, and the audit row is still open.
    const dup = snapshotRow("contacts", roeA[1]);
    expect(dup?.canonicalId).toBe(roeA[0]);
    expect(
      sqlite
        .prepare("SELECT undoneAt FROM dedupe_merge_log WHERE id = ?")
        .get(mergeLogIdA),
    ).toEqual({ undoneAt: null });
  });

  it("lets A undo A's own merge", async () => {
    const res = await asUser(A)(
      request(app).post(`/api/dedupe/merge-log/${mergeLogIdA}/undo`),
    );
    expect(res.status).toBe(200);
    expect(snapshotRow("contacts", roeA[1])?.canonicalId).toBeNull();
  });

  it("reports embedding coverage for the caller's own contacts", async () => {
    const forA = await asUser(A)(
      request(app).get("/api/dedupe/embedding-status"),
    );
    const forC = await asUser(C)(
      request(app).get("/api/dedupe/embedding-status"),
    );

    expect(forA.body.total).toBe(activeCount(A.user.id));
    // C has written nothing, so an instance-wide count would have told C its
    // index was complete while none of its own contacts were embedded.
    expect(forC.body).toEqual({
      embedded: 0,
      total: 0,
      missing: 0,
      coverage: 0,
    });
  });

  it("clears one account's dedupe vectors and leaves the other account's", async () => {
    const vector = Buffer.from(new Float32Array(768).buffer);
    const insert = sqlite.prepare(
      `INSERT INTO contact_embeddings (contactId, ownerId, embedding)
       VALUES (?, ?, ?)`,
    );
    const count = (owner: string) =>
      (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS n FROM contact_embeddings WHERE ownerId = ?",
          )
          .get(owner) as { n: number }
      ).n;

    insert.run(janeA[0], A.user.id, vector);
    insert.run(janeB[0], B.user.id, vector);
    insert.run(janeB[1], B.user.id, vector);
    expect(count(A.user.id)).toBe(1);
    expect(count(B.user.id)).toBe(2);

    // A full-mode scan starts by throwing its own vectors away. Until 2e that
    // was one unqualified DELETE, so one person choosing "full" erased every
    // other account's dedupe index and made their next scan pay to rebuild it.
    const before = count(B.user.id);
    const full = await scan(A, { mode: "full", autoMergeThreshold: 0.99 });
    expect(full.status).toBe(200);
    await eventually(async () => {
      const res = await status(A, full.body.scanId);
      return res.body.phase === "complete" ? res.body : null;
    });
    expect(count(B.user.id)).toBe(before);

    // With no provider configured the scan skips the embedding stage, so the
    // reset itself is called directly. It is the same call the scan makes.
    clearOwnerEmbeddings(A.scope);
    expect(count(A.user.id)).toBe(0);
    expect(count(B.user.id)).toBe(before);
  });

  it("stamps dev-seeded duplicates with the account that asked for them", async () => {
    const beforeA = rowsOwnedBy("contacts", A.user.id);
    const beforeC = rowsOwnedBy("contacts", C.user.id);

    const res = await asUser(C)(request(app).post("/api/dev/seed-duplicates"));
    expect(res.status).toBe(200);

    expect(rowsOwnedBy("contacts", C.user.id)).toBe(beforeC + 4);
    expect(rowsOwnedBy("contacts", A.user.id)).toBe(beforeA);
  });
});

// =============================================================================
// Trash, export, and the MCP surface
// =============================================================================
// The three groups sub-phase 2g converted. The export is the widest read in
// the app: one request returns six tables at once, so it is the one place a
// single missing predicate hands over somebody's whole account.
// =============================================================================

describe("the trash holds one account's deleted contacts", () => {
  const create = async (actor: Actor, name: string) => {
    const res = await asUser(actor)(
      request(app).post("/api/contacts").send({ name }),
    );
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const discard = async (actor: Actor, name: string) => {
    const id = await create(actor, name);
    const res = await asUser(actor)(request(app).delete(`/api/contacts/${id}`));
    expect(res.status).toBe(200);
    return id;
  };

  let trashedA: string;
  let trashedB: string[];

  beforeAll(async () => {
    trashedA = await discard(A, "Alice Discarded");
    trashedB = [
      await discard(B, "Bob Discarded 1"),
      await discard(B, "Bob Discarded 2"),
    ];
  });

  it("GET /api/trash: returns only the caller's rows", async () => {
    const forB = await asUser(B)(request(app).get("/api/trash"));
    const forA = await asUser(A)(request(app).get("/api/trash"));

    expect(forB.status).toBe(200);
    // Earlier tests in this file put rows of their own in each trash, so the
    // claim is ownership rather than an exact id list.
    for (const row of forB.body.items as { id: string }[]) {
      expect(snapshotRow("contacts", row.id)?.ownerId).toBe(B.user.id);
    }
    for (const row of forA.body.items as { id: string }[]) {
      expect(snapshotRow("contacts", row.id)?.ownerId).toBe(A.user.id);
    }
    for (const id of trashedB) expect(ids(forB.body.items)).toContain(id);
    expect(ids(forA.body.items)).toContain(trashedA);
    expect(ids(forB.body.items)).not.toContain(trashedA);
    for (const id of trashedB) {
      expect(ids(forA.body.items)).not.toContain(id);
    }
  });

  it("POST /api/trash/:id/restore: refuses a foreign id and leaves it trashed", async () => {
    const before = snapshotRow("contacts", trashedA);

    const foreign = await asUser(B)(
      request(app).post(`/api/trash/${trashedA}/restore`),
    );
    const unknown = await asUser(B)(
      request(app).post(`/api/trash/${randomId()}/restore`),
    );

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
    expect(snapshotRow("contacts", trashedA)).toEqual(before);
  });

  it("DELETE /api/trash/:id: refuses a foreign id and the row survives", async () => {
    const before = snapshotRow("contacts", trashedA);

    const foreign = await asUser(B)(
      request(app).delete(`/api/trash/${trashedA}`),
    );
    const unknown = await asUser(B)(
      request(app).delete(`/api/trash/${randomId()}`),
    );

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(comparableError(foreign.body)).toEqual(
      comparableError(unknown.body),
    );
    // A purge is the one delete with no undo behind it.
    expect(snapshotRow("contacts", trashedA)).toEqual(before);
  });

  it("POST /api/trash/bulk-restore: restores only the caller's ids from a mixed list", async () => {
    const before = snapshotRow("contacts", trashedA);

    const res = await asUser(B)(
      request(app)
        .post("/api/trash/bulk-restore")
        .send({ ids: [trashedA, ...trashedB] }),
    );

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(trashedB.length);
    expect(snapshotRow("contacts", trashedA)).toEqual(before);
    for (const id of trashedB) {
      expect(snapshotRow("contacts", id)?.deletedAt).toBeNull();
    }
  });

  it("still restores the caller's own trashed contact", async () => {
    const res = await asUser(A)(
      request(app).post(`/api/trash/${trashedA}/restore`),
    );
    expect(res.status).toBe(200);
    expect(snapshotRow("contacts", trashedA)?.deletedAt).toBeNull();
  });
});

describe("an export carries one account's rows and nothing else", () => {
  /** Give an account a row in every table the export reads. */
  const fill = async (actor: Actor, label: string) => {
    const list = await asUser(actor)(
      request(app)
        .post("/api/lists")
        .send({ name: `${label} Export List` }),
    );
    expect([200, 201]).toContain(list.status);
    const anchor = await asUser(actor)(
      request(app)
        .post("/api/contacts")
        .send({ name: `${label} Exported` }),
    );
    expect(anchor.status).toBe(201);
    await asUser(actor)(
      request(app)
        .post(`/api/lists/${list.body.id}/members`)
        .send({ contactId: anchor.body.id }),
    );
    await asUser(actor)(
      request(app)
        .post(`/api/contacts/${anchor.body.id}/interactions`)
        .send({ type: "note", title: `${label} export note` }),
    );
    await asUser(actor)(
      request(app)
        .post(`/api/contacts/${anchor.body.id}/action-items`)
        .send({ title: `${label} export task`, dueAt: "2027-03-03" }),
    );
    // A merge writes the audit row, which is the sixth table.
    const duplicate = await asUser(actor)(
      request(app)
        .post("/api/contacts")
        .send({ name: `${label} Exported` }),
    );
    expect(duplicate.status).toBe(201);
    const merged = await asUser(actor)(
      request(app)
        .post("/api/contacts/merge")
        .send({ primaryId: anchor.body.id, duplicateId: duplicate.body.id }),
    );
    expect(merged.status).toBe(200);
    return {
      listId: list.body.id as string,
      contactId: anchor.body.id as string,
    };
  };

  let filledA: { listId: string; contactId: string };
  let filledB: { listId: string; contactId: string };

  beforeAll(async () => {
    filledA = await fill(A, "alice");
    filledB = await fill(B, "bob");
  });

  it("GET /api/export/json: every table holds only the caller's rows", async () => {
    const res = await asUser(B)(request(app).get("/api/export/json"));
    expect(res.status).toBe(200);

    const payload = JSON.parse(res.text) as {
      contacts: { id: string; ownerId: string }[];
      interactions: { ownerId: string }[];
      lists: { id: string; ownerId: string }[];
      listMembers: { listId: string }[];
      actionItems: { ownerId: string }[];
      mergeLog: { ownerId: string }[];
    };

    // Every table has to be non-empty, or "only B's rows" is a claim about
    // six empty arrays.
    expect(payload.contacts.length).toBeGreaterThan(0);
    expect(payload.interactions.length).toBeGreaterThan(0);
    expect(payload.lists.length).toBeGreaterThan(0);
    expect(payload.listMembers.length).toBeGreaterThan(0);
    expect(payload.actionItems.length).toBeGreaterThan(0);
    expect(payload.mergeLog.length).toBeGreaterThan(0);

    for (const row of payload.contacts) expect(row.ownerId).toBe(B.user.id);
    for (const row of payload.interactions) expect(row.ownerId).toBe(B.user.id);
    for (const row of payload.lists) expect(row.ownerId).toBe(B.user.id);
    for (const row of payload.actionItems) expect(row.ownerId).toBe(B.user.id);
    for (const row of payload.mergeLog) expect(row.ownerId).toBe(B.user.id);

    // list_members carries no owner of its own, so its proof is that every
    // membership names a list this export already returned.
    const listIds = new Set(payload.lists.map((l) => l.id));
    for (const row of payload.listMembers) {
      expect(listIds.has(row.listId)).toBe(true);
    }

    // B's own rows are there, so "no id of A's" is not passing because the
    // export is empty.
    expect(res.text).toContain(filledB.contactId);
    expect(res.text).toContain(filledB.listId);

    // The blunt form of the same claim: not one of A's ids appears anywhere
    // in the bytes, in any table, at any nesting depth.
    expect(res.text).not.toContain(zebulonId);
    expect(res.text).not.toContain(filledA.contactId);
    expect(res.text).not.toContain(filledA.listId);
    for (const id of seedA.contactIds) expect(res.text).not.toContain(id);
    for (const id of seedA.listIds) expect(res.text).not.toContain(id);
  });

  it("GET /api/export/json: names the account in the download filename", async () => {
    const res = await asUser(B)(request(app).get("/api/export/json"));
    expect(res.headers["content-disposition"]).toContain(
      `contrack-export-${B.user.username}-`,
    );
  });

  it("GET /api/export/csv: lists only the caller's contacts", async () => {
    const res = await asUser(B)(request(app).get("/api/export/csv"));
    expect(res.status).toBe(200);
    expect(res.text).toContain("bob Exported");
    expect(res.text).not.toContain(ZEBULON);
    expect(res.text).not.toContain("alice Contact");
    expect(res.headers["content-disposition"]).toContain(
      `contrack-contacts-${B.user.username}-`,
    );
  });

  it("GET /api/export/json: still gives the owner their own rows", async () => {
    const res = await asUser(A)(request(app).get("/api/export/json"));
    expect(res.status).toBe(200);
    expect(res.text).toContain(zebulonId);
    expect(res.text).toContain(filledA.contactId);
  });
});

describe("the MCP surface answers for the caller's own account", () => {
  const RARE_TAG = "quarrington-actuary";
  const RARE_INDUSTRY = "Actuarial Cartography";
  const RARE_NOTE = "Zebulonian quarterly synopsis";

  let dueA: string;
  let dueB: string;
  let ghostB: string;
  let trashedB: string;
  let mergedB: string;

  beforeAll(async () => {
    const post = async (actor: Actor, body: Record<string, unknown>) => {
      const res = await asUser(actor)(
        request(app).post("/api/contacts").send(body),
      );
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    dueA = await post(A, {
      name: "Quarrington Tagholder",
      industry: RARE_INDUSTRY,
      tags: [RARE_TAG],
      nextFollowUpAt: "2020-01-01",
    });
    dueB = await post(B, { name: "Bob Due", nextFollowUpAt: "2020-01-01" });

    const note = await asUser(A)(
      request(app)
        .post(`/api/contacts/${dueA}/interactions`)
        .send({ type: "note", title: RARE_NOTE }),
    );
    expect([200, 201]).toContain(note.status);

    // Two rows the MCP query must skip, both B's own.
    trashedB = await post(B, { name: "Bob Binned" });
    const gone = await asUser(B)(
      request(app).delete(`/api/contacts/${trashedB}`),
    );
    expect(gone.status).toBe(200);
    ghostB = await post(B, { name: "Bob Ghost" });
    sqlite.prepare("UPDATE contacts SET isGhost = 1 WHERE id = ?").run(ghostB);

    // A soft merge is the third kind of row the app hides. It sets
    // canonicalId and leaves deletedAt and isGhost alone, so neither of the
    // other two filters reaches it.
    const keeper = await post(B, { name: "Bob Twin" });
    mergedB = await post(B, { name: "Bob Twin" });
    softMergeContacts(B.scope, keeper, mergedB, 0.99, "same person", "test");
    expect(snapshotRow("contacts", mergedB)?.canonicalId).toBe(keeper);
    expect(snapshotRow("contacts", mergedB)?.deletedAt).toBeNull();
  });

  const query = (actor: Actor) =>
    asUser(actor)(
      request(app).get("/api/query/contacts").query({ limit: 200 }),
    );

  it("GET /api/query/contacts: returns only the caller's rows", async () => {
    const forB = await query(B);
    expect(forB.status).toBe(200);
    expect(forB.body.length).toBeGreaterThan(0);
    for (const row of forB.body as { ownerId: string }[]) {
      expect(row.ownerId).toBe(B.user.id);
    }
    expect(ids(forB.body)).not.toContain(zebulonId);
    expect(ids(forB.body)).not.toContain(dueA);
  });

  it("GET /api/query/contacts: leaves out the caller's trashed, ghost and merged rows", async () => {
    const forB = await query(B);
    expect(ids(forB.body)).not.toContain(trashedB);
    expect(ids(forB.body)).not.toContain(ghostB);
    expect(ids(forB.body)).not.toContain(mergedB);
    // All three rows are still B's, so this is a visibility fix and not a
    // scope one. An MCP client acting on a merged id would write an
    // interaction onto a record the app never shows again.
    expect(snapshotRow("contacts", trashedB)?.ownerId).toBe(B.user.id);
    expect(snapshotRow("contacts", ghostB)?.ownerId).toBe(B.user.id);
    expect(snapshotRow("contacts", mergedB)?.ownerId).toBe(B.user.id);
  });

  it("GET /api/contacts/action-items: returns only the caller's due contacts", async () => {
    const forB = await asUser(B)(
      request(app).get("/api/contacts/action-items"),
    );
    const forA = await asUser(A)(
      request(app).get("/api/contacts/action-items"),
    );

    expect(forB.status).toBe(200);
    expect(ids(forB.body)).toContain(dueB);
    expect(ids(forB.body)).not.toContain(dueA);
    expect(ids(forA.body)).toContain(dueA);
    expect(ids(forA.body)).not.toContain(dueB);
  });

  it("GET /api/tags: does not carry another account's tag", async () => {
    const forB = await asUser(B)(request(app).get("/api/tags"));
    const forA = await asUser(A)(request(app).get("/api/tags"));

    expect(forB.status).toBe(200);
    expect(forA.body).toContain(RARE_TAG);
    expect(forB.body).not.toContain(RARE_TAG);
  });

  it("GET /api/industries: does not carry another account's industry", async () => {
    const forB = await asUser(B)(request(app).get("/api/industries"));
    const forA = await asUser(A)(request(app).get("/api/industries"));

    expect(forB.status).toBe(200);
    expect(forA.body).toContain(RARE_INDUSTRY);
    expect(forB.body).not.toContain(RARE_INDUSTRY);
  });

  it("GET /api/interactions/search: finds nothing of another account's", async () => {
    const forB = await asUser(B)(
      request(app).get("/api/interactions/search").query({ q: "Zebulonian" }),
    );
    const forA = await asUser(A)(
      request(app).get("/api/interactions/search").query({ q: "Zebulonian" }),
    );

    expect(forB.status).toBe(200);
    expect(forB.body).toEqual([]);
    expect(forA.body.length).toBeGreaterThan(0);
    expect((forA.body as { title: string }[]).map((r) => r.title)).toContain(
      RARE_NOTE,
    );
  });

  it("GET /api/timeline: returns only the caller's interactions", async () => {
    const forB = await asUser(B)(
      request(app).get("/api/timeline").query({ limit: 200 }),
    );
    expect(forB.status).toBe(200);
    expect(forB.body.length).toBeGreaterThan(0);
    for (const row of forB.body as { ownerId: string; contactId: string }[]) {
      expect(row.ownerId).toBe(B.user.id);
      expect(snapshotRow("contacts", row.contactId)?.ownerId).toBe(B.user.id);
    }
    for (const id of seedA.interactionIds) {
      expect(ids(forB.body)).not.toContain(id);
    }
  });

  it("answers a personal token for that token's own account", async () => {
    // Phase 3 adds the endpoint that mints one. The lookup already works, so
    // the row goes in by hand, the way api.auth.test.ts does it.
    const secret = "ctk_" + "m".repeat(43);
    const hash = crypto.createHash("sha256").update(secret).digest("hex");
    sqlite
      .prepare(
        `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, expiresAt, revokedAt)
         VALUES ('tok-mcp', ?, 'An MCP client', ?, ?, NULL, NULL)`,
      )
      .run(B.user.id, hash, secret.slice(0, 12));

    try {
      const res = await request(app)
        .get("/api/query/contacts")
        .query({ limit: 200 })
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const row of res.body as { ownerId: string }[]) {
        expect(row.ownerId).toBe(B.user.id);
      }
      expect(ids(res.body)).not.toContain(zebulonId);

      const timeline = await request(app)
        .get("/api/timeline")
        .query({ limit: 200 })
        .set("Authorization", `Bearer ${secret}`);
      expect(timeline.status).toBe(200);
      // Without this the loop below runs zero times on an empty body and the
      // assertion reports green for a route that returned nothing.
      expect(timeline.body.length).toBeGreaterThan(0);
      for (const row of timeline.body as { ownerId: string }[]) {
        expect(row.ownerId).toBe(B.user.id);
      }
    } finally {
      sqlite.prepare("DELETE FROM api_tokens WHERE id = 'tok-mcp'").run();
    }
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

/**
 * Phase 2 generated one `it.todo` here per scoped route it had not reached,
 * so a route added mid-phase arrived as a todo rather than as nothing at all.
 * Sub-phase 2i closed the phase with none left, and the generator became the
 * assertion it had been standing in for.
 *
 * What this can check is that every `scoped` route is `isolated`, and
 * `isolated` flips only when a test for it is added to `COVERED` above. What
 * it cannot check is the kind of test: a collection needs a second proof
 * beyond "B cannot read A's row by id", because a per-id check says nothing
 * about whether A's rows appear in B's list. Nothing in the manifest can
 * express that difference, so it stays a review rule, and the collections are
 * listed here to name what the rule applies to.
 */
describe("no scoped route is waiting for its sub-phase", () => {
  it("has a matrix test for every scoped route", () => {
    const waiting = scoped.filter((r) => !r.isolated).map(key);
    expect(waiting, "scoped routes with no test in this file").toEqual([]);
  });

  it("counts the collections that owe a list test as well as a 404 test", () => {
    const collections = scoped
      .filter((r) => r.method === "GET" && !r.path.includes("/:"))
      .map(key);
    // Every one of them is covered above. The number is here so that adding a
    // collection route shows up in the diff of this file.
    expect(collections).toHaveLength(31);
    for (const k of collections) expect(COVERED).toContain(k);
  });
});

// =============================================================================
// Integration Tests — GET /api/admin/health
// =============================================================================
// `/healthz` answers `SELECT 1`, which is the right answer for a probe that
// anybody who can reach the port may ask. This route is the other half: the
// questions an operator has when four people share an instance, and which
// until now were answerable only by reading the server log or opening the
// database.
//
// Two things are tested and they are different in kind. That a member cannot
// reach it is a guard. That the numbers in it are real is the reason it
// exists: a health panel full of zeros because every query threw is worse
// than no panel, because somebody will believe it.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite, TENANCY_SCHEMA_VERSION } = await import("../../server/db.ts");
const { FTS_SCHEMA_VERSION } =
  await import("../../server/services/search/ftsIndex.ts");
const { dedupeQueue } =
  await import("../../server/services/dedupe/jobQueue.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");

const app = makeTestApp();

interface Actor {
  user: { id: string; email: string; username: string };
  cookie: string[];
  scope: ReturnType<typeof scopeForOwnerId>;
}

let admin: Actor;
let member: Awaited<ReturnType<typeof createActor>>;

/**
 * The first admin, made the way production makes one.
 *
 * `POST /api/auth/setup` converts the local owner into the first admin rather
 * than adding a second account. `createActor` cannot do it: it only reaches
 * setup when the instance holds no accounts at all, and `resetAccounts` puts
 * the local owner back, so every actor it makes is a member.
 */
async function setUpAdmin(username: string): Promise<Actor> {
  const res = await request(app)
    .post("/api/auth/setup")
    .send({
      email: `${username}@example.com`,
      username,
      password: "correct horse battery staple",
      displayName: username,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.user.role).toBe("admin");
  return {
    user: { id: res.body.user.id, email: `${username}@example.com`, username },
    cookie: (res.headers["set-cookie"] as unknown as string[]) ?? [],
    scope: scopeForOwnerId(res.body.user.id),
  };
}

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  admin = await setUpAdmin("healthadmin");
  member = await createActor(app, { username: "healthmember" });
  sqlite
    .prepare("UPDATE users SET role = 'member' WHERE id = ?")
    .run(member.user.id);
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  dedupeQueue.__resetForTests();
  resetAccounts();
});

/** The payload, as an admin. */
async function health(): Promise<Record<string, never>> {
  const res = await asUser(admin)(request(app).get("/api/admin/health"));
  expect(res.status).toBe(200);
  return res.body;
}

describe("who can read it", () => {
  it("refuses a member", async () => {
    const res = await asUser(member)(request(app).get("/api/admin/health"));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
  });

  it("refuses a caller with no credential at all", async () => {
    const res = await request(app).get("/api/admin/health");

    expect(res.status).toBe(401);
  });

  it("answers an admin", async () => {
    const res = await asUser(admin)(request(app).get("/api/admin/health"));

    expect(res.status).toBe(200);
  });
});

describe("what it says", () => {
  it("reports the schema this database is actually on", async () => {
    const body = (await health()) as unknown as {
      schema: {
        tenancy: number;
        tenancyExpected: number;
        fts: number;
        ftsExpected: number;
        vec: string;
        upToDate: boolean;
      };
    };

    expect(body.schema.tenancy).toBe(TENANCY_SCHEMA_VERSION);
    expect(body.schema.tenancyExpected).toBe(TENANCY_SCHEMA_VERSION);
    expect(body.schema.fts).toBe(FTS_SCHEMA_VERSION);
    expect(body.schema.ftsExpected).toBe(FTS_SCHEMA_VERSION);
    // The one version that comes from a native extension rather than a row we
    // wrote. Anything is acceptable except nothing.
    expect(body.schema.vec).toMatch(/^v?\d+\.\d+\.\d+/);
    expect(body.schema.upToDate).toBe(true);
  });

  it("reports a database that is really there", async () => {
    const body = (await health()) as unknown as {
      database: {
        bytes: number;
        walBytes: number;
        busyErrors: number;
        rows: Record<string, number>;
      };
    };

    // Every one of these is a number the panel prints. A zero would be
    // printed just as confidently as the truth.
    expect(body.database.bytes).toBeGreaterThan(0);
    expect(body.database.rows.users).toBeGreaterThanOrEqual(2);
    expect(body.database.rows.contacts).toBeGreaterThanOrEqual(0);
    expect(Object.keys(body.database.rows)).toHaveLength(9);
    expect(body.database.busyErrors).toBe(0);
  });

  it("names the account a scan is running for, and who is behind it", async () => {
    dedupeQueue.setProcessing(true);
    dedupeQueue.createScan(admin.scope, "quick");
    dedupeQueue.enqueue(member.scope, "queued-scan", () => undefined);

    try {
      const body = (await health()) as unknown as {
        queues: {
          dedupe: {
            running: { id: string; username: string } | null;
            pending: { id: string; username: string }[];
          };
        };
      };

      // "A scan is running" is not an answer an operator can act on when four
      // people share an instance and one of them is waiting.
      expect(body.queues.dedupe.running?.username).toBe("healthadmin");
      expect(body.queues.dedupe.pending.map((p) => p.username)).toEqual([
        "healthmember",
      ]);
    } finally {
      dedupeQueue.__resetForTests();
    }
  });

  it("says nothing is running when nothing is", async () => {
    dedupeQueue.__resetForTests();

    const body = (await health()) as unknown as {
      queues: {
        dedupe: { running: unknown; pending: unknown[] };
        aiSearch: { running: unknown; activeBatches: number };
      };
    };

    expect(body.queues.dedupe.running).toBeNull();
    expect(body.queues.dedupe.pending).toEqual([]);
    expect(body.queues.aiSearch.running).toBeNull();
    expect(body.queues.aiSearch.activeBatches).toBe(0);
  });

  it("counts each account's contacts against its search vectors", async () => {
    await asUser(admin)(
      request(app)
        .post("/api/contacts")
        .send({ name: "Health Contact" })
        .expect(201),
    );

    const body = (await health()) as unknown as {
      embeddings: {
        available: boolean;
        byUser: {
          user: { username: string };
          contacts: number;
          embedded: number;
        }[];
      };
    };

    const row = body.embeddings.byUser.find(
      (entry) => entry.user.username === "healthadmin",
    );
    expect(row?.contacts).toBeGreaterThan(0);
    // No model is loaded in a test, so nothing is embedded. The point of the
    // pair is that an operator can see exactly that.
    expect(row?.embedded).toBe(0);
  });

  it("reports uptime and the cache", async () => {
    const body = (await health()) as unknown as {
      uptimeSeconds: number;
      startedAt: string;
      aiCache: Record<string, { entries: number; hitRate: number }>;
      provider: { aiTier: string; circuitBreakers: string[] };
    };

    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Date.parse(body.startedAt)).not.toBeNaN();
    expect(Object.keys(body.aiCache).length).toBeGreaterThan(0);
    // The tier bucket is not a cache tier and must not be reported as one.
    expect(body.aiCache.batchMode).toBeUndefined();
    expect(body.provider.circuitBreakers).toEqual([]);
  });

  it("carries no secret", async () => {
    const res = await asUser(admin)(request(app).get("/api/admin/health"));
    const text = JSON.stringify(res.body).toLowerCase();

    // The payload describes an instance to somebody who administers it. It
    // must not describe a credential to anybody.
    for (const forbidden of [
      "apikey",
      "api_key",
      "password",
      "passwordhash",
      "tokenhash",
      "secret",
      "ctk_",
      "sessionid",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

// =============================================================================
// Integration: server-side user preferences
// =============================================================================
// These settings used to live in `localStorage`, which is keyed by origin and
// not by account. The two things this file has to prove are therefore not the
// same thing: that a preference survives a round trip, and that it belongs to
// one account.
//
// The second is the reason the feature exists, so it is tested from both ends:
// two signed-in accounts, and a personal token acting for one of them.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import {
  defaultPreferences,
  getPreferences,
  MAX_SEARCH_HISTORY,
  PREFERENCE_KEYS,
} from "../../server/services/userPreferencesService.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let A: Actor;
let B: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  A = await createActor(app, { username: "prefa", email: "prefa@test.dev" });
  B = await createActor(app, { username: "prefb", email: "prefb@test.dev" });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const get = (actor: Actor) =>
  asUser(actor)(request(app).get("/api/auth/preferences"));

const patch = (actor: Actor, body: object) =>
  asUser(actor)(request(app).patch("/api/auth/preferences").send(body));

describe("GET /api/auth/preferences", () => {
  it("answers with every preference, and says none were chosen", async () => {
    const res = await get(A);
    expect(res.status).toBe(200);
    expect(res.body.preferences).toEqual(defaultPreferences());
    expect(res.body.stored).toEqual([]);
    // Every key the service knows is in the answer, so the browser never has
    // to carry a default of its own.
    expect(Object.keys(res.body.preferences).sort()).toEqual(
      [...PREFERENCE_KEYS].sort(),
    );
  });

  it("refuses a request with no credential at all", async () => {
    const res = await request(app).get("/api/auth/preferences");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/auth/preferences", () => {
  it("writes one preference and leaves the rest alone", async () => {
    const res = await patch(A, { listDensity: "compact" });
    expect(res.status).toBe(200);
    expect(res.body.preferences.listDensity).toBe("compact");
    expect(res.body.preferences.recentLimit).toBe(3);
    expect(res.body.stored).toEqual(["listDensity"]);

    const again = await get(A);
    expect(again.body.preferences.listDensity).toBe("compact");
    expect(again.body.stored).toEqual(["listDensity"]);
  });

  it("writes several at once", async () => {
    const res = await patch(A, {
      theme: "dark",
      accent: "#7A1FA2",
      recentLimit: 0,
      dedupePreset: "conservative",
      tempUnit: "fahrenheit",
    });
    expect(res.status).toBe(200);
    expect(res.body.preferences).toMatchObject({
      theme: "dark",
      // Stored lower-case, so two spellings of one colour are one value.
      accent: "#7a1fa2",
      recentLimit: 0,
      dedupePreset: "conservative",
      tempUnit: "fahrenheit",
      listDensity: "compact",
    });
    expect(res.body.stored.sort()).toEqual([
      "accent",
      "dedupePreset",
      "listDensity",
      "recentLimit",
      "tempUnit",
      "theme",
    ]);
  });

  it("refuses a preference it does not know", async () => {
    const res = await patch(A, { colourScheme: "neon" });
    expect(res.status).toBe(400);
    // And nothing was written on the way to refusing.
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM user_settings WHERE userId = ? AND key = 'pref.colourScheme'",
        )
        .get(A.user.id),
    ).toEqual({ n: 0 });
  });

  it("refuses the whole patch when one key in it is unknown", async () => {
    // The case that makes the schema strict rather than merely validating.
    // Zod's default is to STRIP an unknown key, so without `.strict()` this
    // request succeeds, the density changes, and the typo is never reported —
    // a client asking for `colorScheme` instead of `theme` would be told it
    // worked.
    const before = getPreferences(A.user.id);
    const res = await patch(A, {
      listDensity: before.listDensity === "compact" ? "comfortable" : "compact",
      colourScheme: "neon",
    });
    expect(res.status).toBe(400);
    expect(getPreferences(A.user.id)).toEqual(before);
  });

  it.each([
    ["a theme that is not a theme", { theme: "neon" }],
    ["an accent that is not a colour", { accent: "blue" }],
    ["an accent with no hash", { accent: "7a1fa2" }],
    ["a recent limit past the maximum", { recentLimit: 11 }],
    ["a recent limit below zero", { recentLimit: -1 }],
    ["a fractional recent limit", { recentLimit: 2.5 }],
    ["a density that is not a density", { listDensity: "roomy" }],
    ["a preset that is not a preset", { dedupePreset: "reckless" }],
    ["an empty body", {}],
  ])("refuses %s", async (_label, body) => {
    const res = await patch(A, body);
    expect(res.status).toBe(400);
  });

  it("leaves the stored value alone when a patch is refused", async () => {
    const before = getPreferences(A.user.id);
    await patch(A, { listDensity: "roomy" });
    expect(getPreferences(A.user.id)).toEqual(before);
  });
});

describe("search history", () => {
  const entry = (query: string, timestamp = 1) => ({
    query,
    mode: "normal" as const,
    timestamp,
  });

  it("stores entries and hands them back in order", async () => {
    const res = await patch(B, {
      searchHistory: [entry("vcs in sf", 3), entry("alumni", 2)],
    });
    expect(res.status).toBe(200);
    expect(res.body.preferences.searchHistory).toEqual([
      { query: "vcs in sf", mode: "normal", timestamp: 3 },
      { query: "alumni", mode: "normal", timestamp: 2 },
    ]);
  });

  it("accepts the maximum and refuses one more", async () => {
    const full = Array.from({ length: MAX_SEARCH_HISTORY }, (_, i) =>
      entry(`query ${i}`, i),
    );
    expect((await patch(B, { searchHistory: full })).status).toBe(200);
    expect(
      (await patch(B, { searchHistory: [...full, entry("one too many")] }))
        .status,
    ).toBe(400);
  });

  it("refuses a query long enough to be a payload", async () => {
    const res = await patch(B, { searchHistory: [entry("x".repeat(201))] });
    expect(res.status).toBe(400);
  });

  it("refuses a mode nothing in the app produces", async () => {
    const res = await patch(B, {
      searchHistory: [{ query: "x", mode: "telepathy", timestamp: 1 }],
    });
    expect(res.status).toBe(400);
  });

  it("clears with an empty list", async () => {
    const res = await patch(B, { searchHistory: [] });
    expect(res.status).toBe(200);
    expect(res.body.preferences.searchHistory).toEqual([]);
    // Cleared, not forgotten: the key stays chosen so the browser does not
    // treat an emptied history as "never set" and migrate the old one back.
    expect(res.body.stored).toContain("searchHistory");
  });
});

describe("one account's preferences are its own", () => {
  it("does not show A's choices to B", async () => {
    await patch(A, { listDensity: "compact", theme: "dark" });
    await patch(B, { listDensity: "comfortable" });

    const mine = await get(A);
    const theirs = await get(B);

    expect(mine.body.preferences.listDensity).toBe("compact");
    expect(mine.body.preferences.theme).toBe("dark");
    expect(theirs.body.preferences.listDensity).toBe("comfortable");
    expect(theirs.body.preferences.theme).toBe("system");
  });

  it("writes rows under the account that asked, and nobody else", async () => {
    await patch(A, { tempUnit: "fahrenheit" });
    const rows = sqlite
      .prepare("SELECT DISTINCT userId FROM user_settings")
      .all() as { userId: string }[];
    expect(rows.map((r) => r.userId).sort()).toEqual(
      [A.user.id, B.user.id].sort(),
    );
  });

  it("lets a personal token read and write its own account's settings", async () => {
    const created = await asUser(A)(
      request(app).post("/api/auth/tokens").send({ name: "prefs" }),
    );
    expect(created.status).toBe(201);
    const token = created.body.token as string;

    const read = await request(app)
      .get("/api/auth/preferences")
      .set("Authorization", `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.preferences.listDensity).toBe("compact");

    const write = await request(app)
      .patch("/api/auth/preferences")
      .set("Authorization", `Bearer ${token}`)
      .send({ tempUnit: "celsius" });
    expect(write.status).toBe(200);
    expect(getPreferences(B.user.id).tempUnit).toBe("celsius");
    expect(getPreferences(A.user.id).tempUnit).toBe("celsius");
  });
});

describe("rows this version cannot read", () => {
  it("ignores a key it does not know and a value it will not accept", async () => {
    sqlite
      .prepare(
        `INSERT INTO user_settings (userId, key, value) VALUES (?, ?, ?)
         ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
      )
      .run(A.user.id, "pref.fromTheFuture", '"whatever"');
    sqlite
      .prepare(
        `INSERT INTO user_settings (userId, key, value) VALUES (?, ?, ?)
         ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
      )
      .run(A.user.id, "pref.recentLimit", "99");
    sqlite
      .prepare(
        `INSERT INTO user_settings (userId, key, value) VALUES (?, ?, ?)
         ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
      )
      .run(A.user.id, "pref.theme", "not json at all");

    const res = await get(A);
    expect(res.status).toBe(200);
    expect(res.body.preferences.recentLimit).toBe(3);
    expect(res.body.preferences.theme).toBe("system");
    expect(res.body.stored).not.toContain("fromTheFuture");
    // The readable choices are untouched by the unreadable ones beside them.
    expect(res.body.preferences.listDensity).toBe("compact");
  });

  it("ignores a row that belongs to something other than preferences", async () => {
    sqlite
      .prepare(
        `INSERT INTO user_settings (userId, key, value) VALUES (?, ?, ?)
         ON CONFLICT(userId, key) DO UPDATE SET value = excluded.value`,
      )
      .run(A.user.id, "nudges.channel", '"slack"');

    const res = await get(A);
    expect(res.status).toBe(200);
    expect(res.body.stored).not.toContain("channel");
    expect(res.body.stored).not.toContain("nudges.channel");
  });
});

describe("an instance with sign-in switched off", () => {
  it("lets the local owner choose, with no session anywhere", async () => {
    // The reason these two routes do not use `requireSession`. The default
    // single-user setup runs as the local owner, whose principal is implicit,
    // and a gate asking for a session would answer 403 SESSION_REQUIRED to
    // somebody trying to turn on dark mode.
    delete process.env.AUTH_REQUIRED;
    try {
      const read = await request(app).get("/api/auth/preferences");
      expect(read.status).toBe(200);

      const write = await request(app)
        .patch("/api/auth/preferences")
        .send({ theme: "dark" });
      expect(write.status).toBe(200);
      expect(write.body.preferences.theme).toBe("dark");

      const again = await request(app).get("/api/auth/preferences");
      expect(again.body.preferences.theme).toBe("dark");
      // And it landed on the local owner, who is an account of their own.
      expect(getPreferences(ensureLocalOwner()).theme).toBe("dark");
      expect(getPreferences(B.user.id).theme).toBe("system");
    } finally {
      process.env.AUTH_REQUIRED = "true";
    }
  });
});

describe("closing an account", () => {
  it("takes its preferences with it", async () => {
    const doomed = await createActor(app, {
      username: "prefgone",
      email: "prefgone@test.dev",
    });
    await patch(doomed, { theme: "dark" });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM user_settings WHERE userId = ?")
        .get(doomed.user.id),
    ).toEqual({ n: 1 });

    sqlite.prepare("DELETE FROM users WHERE id = ?").run(doomed.user.id);

    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM user_settings WHERE userId = ?")
        .get(doomed.user.id),
    ).toEqual({ n: 0 });
  });
});

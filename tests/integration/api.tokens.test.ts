// =============================================================================
// Integration Tests — personal tokens, open registration, instance settings
// =============================================================================
// The second half of Phase 3. A person signs in and gets a cookie; a script
// carries a personal token instead. This file proves the token is a credential
// for exactly one account, that it cannot be used to manage that account, and
// that revoking it stops the script and nothing else.
//
// Registration and the instance settings sit here too, because they are the
// other two ways an account comes into being and the one place an admin turns
// the first of them on.
//
// Authentication is on throughout. With it off the caller with no credential
// is the local owner, which is an admin, and half of these assertions would
// pass for the wrong reason.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";

const app = makeTestApp();
const PASSWORD = "correct horse battery staple";

interface Handle {
  id: string;
  username: string;
  cookie: string[];
}

function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

function as(who: Handle) {
  return (r: request.Test): request.Test => r.set("Cookie", who.cookie);
}

async function signIn(identifier: string, password: string): Promise<string[]> {
  __resetAuthRateLimits();
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier, password });
  if (res.status !== 200) {
    throw new Error(
      `signIn(${identifier}) failed with ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return cookieFrom(res);
}

/** Wipe every account and secure the instance, as production does. */
async function freshInstance(username: string): Promise<Handle> {
  resetAccounts();
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
  sqlite.prepare("DELETE FROM app_settings WHERE key LIKE 'auth.%'").run();
  clearSettingsCache();
  __resetAuthRateLimits();
  const res = await request(app)
    .post("/api/auth/setup")
    .send({
      email: `${username}@example.com`,
      username,
      password: PASSWORD,
      displayName: username,
    });
  if (res.status !== 201) {
    throw new Error(
      `freshInstance(${username}) failed with ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return { id: res.body.user.id, username, cookie: cookieFrom(res) };
}

async function createAndActivate(
  by: Handle,
  username: string,
  role: "admin" | "member" = "member",
): Promise<Handle> {
  const created = await as(by)(
    request(app)
      .post("/api/admin/users")
      .send({ email: `${username}@example.com`, username, role }),
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const cookie = await signIn(username, created.body.temporaryPassword);
  const changed = await request(app)
    .post("/api/auth/change-password")
    .set("Cookie", cookie)
    .send({
      currentPassword: created.body.temporaryPassword,
      newPassword: PASSWORD,
    });
  expect(changed.status).toBe(200);
  return { id: created.body.user.id, username, cookie };
}

/** Mint a token through the API and return the plaintext. */
async function mintToken(who: Handle, name = "A script"): Promise<string> {
  const res = await as(who)(
    request(app).post("/api/auth/tokens").send({ name }),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.token as string;
}

const withToken = (secret: string) => (r: request.Test) =>
  r.set("Authorization", `Bearer ${secret}`);

beforeAll(() => {
  process.env.AUTH_REQUIRED = "true";
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  delete process.env.API_TOKEN;
  resetAccounts();
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
  __resetAuthWarnings();
});

beforeEach(() => {
  __resetAuthRateLimits();
});

// =============================================================================
// 3.6 Personal tokens
// =============================================================================

describe("a personal token", () => {
  let owner: Handle;
  let other: Handle;

  beforeAll(async () => {
    owner = await freshInstance("tokenadmin");
    other = await createAndActivate(owner, "tokenmember");
    // One contact each, so a scoped read has something to be right about.
    for (const who of [owner, other]) {
      await as(who)(
        request(app)
          .post("/api/contacts")
          .send({ name: `${who.username} Contact`, company: "Acme" }),
      );
    }
  });

  it("is returned once and stored only as a hash", async () => {
    const res = await as(owner)(
      request(app).post("/api/auth/tokens").send({ name: "My script" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^ctk_[A-Za-z0-9_-]{43}$/);
    expect(res.body.tokenPrefix).toBe(res.body.token.slice(0, 12));

    const row = sqlite
      .prepare(
        "SELECT tokenHash, tokenPrefix, name FROM api_tokens WHERE id = ?",
      )
      .get(res.body.id) as {
      tokenHash: string;
      tokenPrefix: string;
      name: string;
    };
    expect(row.tokenHash).toBe(
      crypto.createHash("sha256").update(res.body.token).digest("hex"),
    );
    expect(row.tokenHash).not.toContain(res.body.token);
    expect(row.name).toBe("My script");

    // The list never gives it back, only enough to tell two tokens apart.
    const list = await as(owner)(request(app).get("/api/auth/tokens"));
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(list.body.tokens[0]).toMatchObject({
      name: "My script",
      tokenPrefix: res.body.tokenPrefix,
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("acts as its own account on a data route", async () => {
    const secret = await mintToken(other);
    const res = await withToken(secret)(request(app).get("/api/contacts"));
    expect(res.status).toBe(200);
    const names = (res.body.contacts ?? res.body).map(
      (c: { name: string }) => c.name,
    );
    expect(names).toEqual(["tokenmember Contact"]);
  });

  it("acts as its own account on every MCP route", async () => {
    const secret = await mintToken(other);
    for (const url of [
      "/api/query/contacts",
      "/api/contacts/action-items",
      "/api/tags",
      "/api/industries",
      "/api/interactions/search?q=anything",
      "/api/timeline",
    ]) {
      const res = await withToken(secret)(request(app).get(url));
      expect(res.status, url).toBe(200);
    }

    // And reads one account's rows there, not the instance's.
    const contacts = await withToken(secret)(
      request(app).get("/api/query/contacts"),
    );
    const names = (
      (contacts.body.contacts ?? contacts.body) as { name: string }[]
    ).map((c) => c.name);
    expect(names).toEqual(["tokenmember Contact"]);
  });

  it("cannot reach a route that manages the account", async () => {
    const secret = await mintToken(other);
    for (const [method, url] of [
      ["GET", "/api/auth/me"],
      ["GET", "/api/auth/tokens"],
      ["GET", "/api/auth/sessions"],
    ] as const) {
      const res = await withToken(secret)(
        method === "GET" ? request(app).get(url) : request(app).post(url),
      );
      expect(res.status, url).toBe(403);
      expect(res.body.error.code, url).toBe("SESSION_REQUIRED");
    }
  });

  it("cannot mint another token", async () => {
    // A script that could mint tokens could outlive the revocation of its own.
    const secret = await mintToken(other);
    const res = await withToken(secret)(
      request(app).post("/api/auth/tokens").send({ name: "Sneaky" }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SESSION_REQUIRED");
  });

  it("stops working the moment it is revoked", async () => {
    const secret = await mintToken(other, "Short lived");
    const list = await as(other)(request(app).get("/api/auth/tokens"));
    const id = (list.body.tokens as { id: string; name: string }[]).find(
      (t) => t.name === "Short lived",
    )!.id;

    expect(
      (await withToken(secret)(request(app).get("/api/contacts"))).status,
    ).toBe(200);

    const revoked = await as(other)(
      request(app).delete(`/api/auth/tokens/${id}`),
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body).toEqual({ revoked: true });

    expect(
      (await withToken(secret)(request(app).get("/api/contacts"))).status,
    ).toBe(401);

    // The row stays, so the list can still explain why the script stopped.
    const after = await as(other)(request(app).get("/api/auth/tokens"));
    const row = (after.body.tokens as { id: string; revokedAt: string }[]).find(
      (t) => t.id === id,
    );
    expect(row?.revokedAt).not.toBeNull();
  });

  it("refuses to revoke a token belonging to somebody else", async () => {
    await mintToken(owner, "Not yours");
    const mine = await as(owner)(request(app).get("/api/auth/tokens"));
    const id = (mine.body.tokens as { id: string; name: string }[]).find(
      (t) => t.name === "Not yours",
    )!.id;

    const res = await as(other)(request(app).delete(`/api/auth/tokens/${id}`));
    expect(res.status).toBe(404);
    // And the token is untouched.
    const row = sqlite
      .prepare("SELECT revokedAt FROM api_tokens WHERE id = ?")
      .get(id) as { revokedAt: string | null };
    expect(row.revokedAt).toBeNull();
  });

  it("refuses an expired token and one whose account is disabled", async () => {
    const expired = await mintToken(other, "Expiring");
    sqlite
      .prepare(
        "UPDATE api_tokens SET expiresAt = '2020-01-01 00:00:00' WHERE name = 'Expiring'",
      )
      .run();
    expect(
      (await withToken(expired)(request(app).get("/api/contacts"))).status,
    ).toBe(401);

    // An expiry an hour ago, written the way createToken writes one. The
    // stamp above cannot catch a format mismatch, because its year differs
    // and the date bytes alone settle the comparison. This one differs from
    // `datetime('now')` first at the `T`, which sorts after a space, so
    // without `datetime()` around the column the token was still live.
    const today = await mintToken(other, "Expired an hour ago");
    sqlite
      .prepare("UPDATE api_tokens SET expiresAt = ? WHERE name = ?")
      .run(
        new Date(Date.now() - 3600_000).toISOString(),
        "Expired an hour ago",
      );
    expect(
      (await withToken(today)(request(app).get("/api/contacts"))).status,
    ).toBe(401);

    // And one that expires in an hour still works, so the fix did not simply
    // refuse everything with an expiry.
    const soon = await mintToken(other, "Expires in an hour");
    sqlite
      .prepare("UPDATE api_tokens SET expiresAt = ? WHERE name = ?")
      .run(new Date(Date.now() + 3600_000).toISOString(), "Expires in an hour");
    expect(
      (await withToken(soon)(request(app).get("/api/contacts"))).status,
    ).toBe(200);

    const live = await mintToken(other, "Live one");
    await as(owner)(request(app).post(`/api/admin/users/${other.id}/disable`));
    expect(
      (await withToken(live)(request(app).get("/api/contacts"))).status,
    ).toBe(401);

    await as(owner)(request(app).post(`/api/admin/users/${other.id}/enable`));
    expect(
      (await withToken(live)(request(app).get("/api/contacts"))).status,
    ).toBe(200);
    // Enabling gave the token back, so the session has to be made again.
    other.cookie = await signIn(other.username, PASSWORD);
  });

  it("stamps lastUsedAt at most once an hour", async () => {
    const secret = await mintToken(other, "Timed");
    const id = (
      sqlite
        .prepare("SELECT id FROM api_tokens WHERE name = 'Timed'")
        .get() as {
        id: string;
      }
    ).id;
    const lastUsed = () =>
      (
        sqlite
          .prepare("SELECT lastUsedAt FROM api_tokens WHERE id = ?")
          .get(id) as { lastUsedAt: string | null }
      ).lastUsedAt;
    const setLastUsed = (modifier: string) =>
      sqlite
        .prepare(
          "UPDATE api_tokens SET lastUsedAt = datetime('now', ?) WHERE id = ?",
        )
        .run(modifier, id);

    expect(lastUsed()).toBeNull();
    await withToken(secret)(request(app).get("/api/contacts"));
    expect(lastUsed()).not.toBeNull();

    // Half an hour ago, and distinctly not now. A second request inside the
    // hour must leave it exactly where it is. Asserting on two requests a
    // millisecond apart would not do: CURRENT_TIMESTAMP has one-second
    // resolution, so a stamp on every request looks identical to no stamp.
    setLastUsed("-30 minutes");
    const halfHourAgo = lastUsed();
    await withToken(secret)(request(app).get("/api/contacts"));
    expect(lastUsed()).toBe(halfHourAgo);

    // Past the hour, and it moves.
    setLastUsed("-2 hours");
    const twoHoursAgo = lastUsed();
    await withToken(secret)(request(app).get("/api/contacts"));
    expect(lastUsed()).not.toBe(twoHoursAgo);
  });

  it("refuses the eleventh token in an hour, with a Retry-After", async () => {
    const spender = await createAndActivate(owner, "tokenspender");
    for (let i = 0; i < 10; i++) {
      const res = await as(spender)(
        request(app)
          .post("/api/auth/tokens")
          .send({ name: `Script ${i}` }),
      );
      expect(res.status, `token ${i}`).toBe(201);
    }
    const refused = await as(spender)(
      request(app).post("/api/auth/tokens").send({ name: "One too many" }),
    );
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);

    // The window is that account's own, so a colleague is unaffected.
    const colleague = await as(owner)(
      request(app).post("/api/auth/tokens").send({ name: "Mine" }),
    );
    expect(colleague.status).toBe(201);
  });

  it("refuses a name-less token and an impossible expiry", async () => {
    for (const body of [
      {},
      { name: "   " },
      { name: "ok", expiresInDays: 0 },
      { name: "ok", expiresInDays: 100000 },
    ]) {
      const res = await as(owner)(
        request(app).post("/api/auth/tokens").send(body),
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("records the creation and the revocation, and never the token", async () => {
    const rows = sqlite
      .prepare(
        `SELECT action, details FROM audit_log
          WHERE action IN ('auth.token.created', 'auth.token.revoked')`,
      )
      .all() as { action: string; details: string | null }[];
    expect(rows.some((r) => r.action === "auth.token.created")).toBe(true);
    expect(rows.some((r) => r.action === "auth.token.revoked")).toBe(true);
    for (const row of rows) {
      expect(row.details ?? "").not.toContain("ctk_");
    }
  });
});

// =============================================================================
// 3.7 Open registration
// =============================================================================

describe("open registration", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("regadmin");
  });

  const register = (username: string) =>
    request(app)
      .post("/api/auth/register")
      .send({
        email: `${username}@example.com`,
        username,
        password: PASSWORD,
      });

  it("is closed on an instance nobody opened", async () => {
    const res = await register("uninvited");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REGISTRATION_CLOSED");
    expect(
      sqlite.prepare("SELECT id FROM users WHERE username = 'uninvited'").get(),
    ).toBeUndefined();
  });

  it("says so on the status endpoint", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body.registrationOpen).toBe(false);
  });

  it("creates a member once an admin opens it", async () => {
    const opened = await as(admin)(
      request(app).put("/api/admin/settings").send({ registrationOpen: true }),
    );
    expect(opened.status).toBe(200);
    expect(opened.body.registrationOpen).toBe(true);

    const status = await request(app).get("/api/auth/status");
    expect(status.body.registrationOpen).toBe(true);

    const res = await register("selfmade");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // A member, never an admin, and signed in on the spot.
    expect(res.body.user).toMatchObject({
      username: "selfmade",
      role: "member",
      mustChangePassword: false,
    });
    expect(cookieFrom(res).length).toBeGreaterThan(0);
  });

  it("closes again when the admin turns it off", async () => {
    const closed = await as(admin)(
      request(app).put("/api/admin/settings").send({ registrationOpen: false }),
    );
    expect(closed.status).toBe(200);
    expect(closed.body.registrationOpen).toBe(false);

    const res = await register("toolate");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REGISTRATION_CLOSED");
  });

  it("refuses a member who tries to open it", async () => {
    const member = await createAndActivate(admin, "regmember");
    const res = await as(member)(
      request(app).put("/api/admin/settings").send({ registrationOpen: true }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
    expect(
      (await request(app).get("/api/auth/status")).body.registrationOpen,
    ).toBe(false);
  });
});

// =============================================================================
// 3.7 Instance settings
// =============================================================================

describe("instance settings", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("settingsadmin");
  });

  it("reads back what it wrote, in one shape", async () => {
    const before = await as(admin)(request(app).get("/api/admin/settings"));
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({
      registrationOpen: false,
      sessionTtlDays: expect.any(Number),
      sessionTtlRange: {
        min: expect.any(Number),
        max: expect.any(Number),
        default: expect.any(Number),
      },
    });

    const written = await as(admin)(
      request(app)
        .put("/api/admin/settings")
        .send({ sessionTtlDays: 14, registrationOpen: true }),
    );
    expect(written.status).toBe(200);
    expect(written.body).toMatchObject({
      sessionTtlDays: 14,
      registrationOpen: true,
    });

    const after = await as(admin)(request(app).get("/api/admin/settings"));
    expect(after.body).toEqual(written.body);
  });

  it("still answers on the endpoint it replaces", async () => {
    // PUT /api/auth/session-policy writes the same value and is removed in
    // 3.0. Both are admin, and both have to agree until then.
    const legacy = await as(admin)(
      request(app).put("/api/auth/session-policy").send({ sessionTtlDays: 21 }),
    );
    expect(legacy.status).toBe(200);
    const settings = await as(admin)(request(app).get("/api/admin/settings"));
    expect(settings.body.sessionTtlDays).toBe(21);
  });

  it("refuses a value outside the supported range", async () => {
    for (const body of [
      { sessionTtlDays: 0 },
      { sessionTtlDays: 100000 },
      { registrationOpen: "yes" },
      {},
    ]) {
      const res = await as(admin)(
        request(app).put("/api/admin/settings").send(body),
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("records each key that changed, and not its value", async () => {
    sqlite.prepare("DELETE FROM audit_log").run();
    await as(admin)(
      request(app)
        .put("/api/admin/settings")
        .send({ sessionTtlDays: 30, registrationOpen: false }),
    );
    const rows = sqlite
      .prepare(
        `SELECT targetId, details FROM audit_log WHERE action = 'settings.changed'
          ORDER BY targetId`,
      )
      .all() as { targetId: string; details: string | null }[];
    expect(rows.map((r) => r.targetId)).toEqual([
      "auth.registrationOpen",
      "auth.sessionTtlDays",
    ]);
    for (const row of rows) expect(row.details).toBeNull();
  });
});

// =============================================================================
// 3.11 and 3.12 Status, profile, and the environment token
// =============================================================================

describe("what the status endpoint reports", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("statusadmin");
  });

  afterAll(() => {
    delete process.env.API_TOKEN;
    __resetAuthWarnings();
  });

  it("says the local owner is gone once the instance is secured", async () => {
    const res = await request(app).get("/api/auth/status");
    // Setup converts the local owner rather than adding a second account, so
    // a secured instance has none.
    expect(res.body.localOwnerPresent).toBe(false);
    expect(res.body.legacyTokenConfigured).toBe(false);
  });

  it("keeps both names for the contact count through this release", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body).toHaveProperty("deviceContacts");
    expect(res.body).toHaveProperty("existingContacts");
    expect(res.body.existingContacts).toBe(res.body.deviceContacts);
  });

  it("says how the caller proved who they are", async () => {
    const res = await as(admin)(request(app).get("/api/auth/me"));
    expect(res.status).toBe(200);
    expect(res.body.via).toBe("session");
    expect(res.body.user).toMatchObject({
      role: "admin",
      status: "active",
      credentialState: "password",
      mustChangePassword: false,
    });
  });

  it("reports the deprecated environment token, and it acts as the first admin", async () => {
    process.env.API_TOKEN = "an-instance-wide-secret";
    __resetAuthWarnings();
    try {
      const status = await request(app).get("/api/auth/status");
      expect(status.body.legacyTokenConfigured).toBe(true);

      const res = await request(app)
        .get("/api/auth/status")
        .set("Authorization", "Bearer an-instance-wide-secret");
      expect(res.body.user.id).toBe(admin.id);
      expect(res.body.authenticated).toBe(true);

      // It is not a session, so it manages no account.
      const me = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer an-instance-wide-secret");
      expect(me.status).toBe(403);
      expect(me.body.error.code).toBe("SESSION_REQUIRED");
    } finally {
      delete process.env.API_TOKEN;
      __resetAuthWarnings();
    }
  });
});

// =============================================================================
// 3.10 Instance-wide AI stats
// =============================================================================

describe("the instance view of AI usage", () => {
  let admin: Handle;
  let member: Handle;

  beforeAll(async () => {
    admin = await freshInstance("statsadmin");
    member = await createAndActivate(admin, "statsmember");
    sqlite.prepare("DELETE FROM ai_invocations").run();
    const insert = sqlite.prepare(
      `INSERT INTO ai_invocations
         (id, operation, model, tokenCount, latencyMs, cached, description, ownerId)
       VALUES (?, 'searchExpansion', 'gpt-4o-mini', 1000, 5, 0, ?, ?)`,
    );
    for (let i = 0; i < 3; i++) {
      insert.run(crypto.randomUUID(), "admin asked about Acme", admin.id);
    }
    insert.run(crypto.randomUUID(), "member asked about Beta", member.id);
  });

  it("refuses a member who asks for the instance", async () => {
    for (const url of [
      "/api/ai/stats/summary?scope=all",
      "/api/ai/stats/feed?scope=all",
    ]) {
      const res = await as(member)(request(app).get(url));
      expect(res.status, url).toBe(403);
      expect(res.body.error.code).toBe("ADMIN_REQUIRED");
    }
  });

  it("still gives a member their own numbers", async () => {
    const res = await as(member)(request(app).get("/api/ai/stats/summary"));
    expect(res.status).toBe(200);
    expect(res.body.session.totalInvocations).toBe(1);
    // The shared cache belongs to the instance, so a member does not see it.
    expect(res.body.cacheTiers).toBeUndefined();
  });

  it("gives an admin the totals and the breakdown", async () => {
    const res = await as(admin)(
      request(app).get("/api/ai/stats/summary?scope=all"),
    );
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("all");
    expect(res.body.session.totalInvocations).toBe(4);
    expect(res.body.session.estimatedCostUsd).toBeGreaterThan(0);

    const byUser = res.body.byUser as {
      username: string;
      totalInvocations: number;
    }[];
    expect(
      Object.fromEntries(byUser.map((u) => [u.username, u.totalInvocations])),
    ).toEqual({ statsadmin: 3, statsmember: 1 });
  });

  it("names the account on each row of the instance feed and shows no description", async () => {
    const res = await as(admin)(
      request(app).get("/api/ai/stats/feed?scope=all&limit=50"),
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.totalCount).toBe(4);

    const usernames = new Set(
      (res.body.items as { username: string }[]).map((i) => i.username),
    );
    expect([...usernames].sort()).toEqual(["statsadmin", "statsmember"]);

    // A description can hold a fragment of what somebody asked about. The
    // billing view has no business showing it.
    for (const item of res.body.items as Record<string, unknown>[]) {
      expect(item).not.toHaveProperty("description");
    }
    expect(JSON.stringify(res.body)).not.toContain("asked about");
  });
});

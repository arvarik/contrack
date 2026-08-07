// =============================================================================
// Integration: the credential layer — setup, sign-in, sessions, gating
// =============================================================================
// The middleware reads env per request, so enforcement is toggled inside the
// tests rather than at import time, and reset in afterAll so ordering never
// leaks into other files.
//
// Every test that changes accounts cleans up after itself: the database is
// shared across the whole file (one temp DATA_DIR per file, per the setup),
// so a stray user row would make the next describe block's `setupRequired`
// assertion wrong for reasons it cannot see.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";

const app = makeTestApp();

const ACCOUNT = {
  email: "Owner@Example.COM",
  username: "TheOwner",
  password: "correct horse battery staple",
  displayName: "The Owner",
};

/** Remove every account (and, by cascade, every session). */
function wipeAccounts(): void {
  sqlite.exec("DELETE FROM sessions; DELETE FROM users;");
}

/**
 * Create the first account and return its session cookie.
 *
 * Clears the rate-limit window immediately before the call rather than relying
 * on the file-level `beforeEach`. Both credential endpoints are guarded by a
 * fixed window shared by every test in this file, and a test that legitimately
 * calls setup more than five times (the invalid-input loops do) would trip it.
 * A tripped limiter returns 429 with no Set-Cookie, so `cookie` came back
 * undefined and the *next* request failed with a baffling status several lines
 * away from the actual cause — which is exactly the shape of flake that eats an
 * afternoon.
 */
async function setupAccount(overrides: Partial<typeof ACCOUNT> = {}) {
  __resetAuthRateLimits();
  const res = await request(app)
    .post("/api/auth/setup")
    .send({ ...ACCOUNT, ...overrides });
  return { res, cookie: cookieFrom(res) };
}

/** Sign in and return the session cookie. */
async function signIn(identifier: string, password: string) {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier, password });
  return { res, cookie: cookieFrom(res) };
}

/**
 * Pull the Set-Cookie header off a response.
 *
 * Returns an empty array rather than undefined when there is none: supertest's
 * `.set("Cookie", undefined)` does not fail, it sends something malformed and
 * the failure surfaces as an unrelated status code. An empty array sends no
 * cookie, so an unauthenticated request reads as 401 — which is the truth.
 */
function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

beforeAll(() => {
  process.env.AUTH_REQUIRED = "true";
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  delete process.env.API_TOKEN;
  delete process.env.AUTH_TOKEN;
  wipeAccounts();
});

beforeEach(() => {
  __resetAuthRateLimits();
  __resetAuthWarnings();
});

// =============================================================================

describe("first-run setup", () => {
  beforeEach(wipeAccounts);

  it("reports setupRequired when gated with no accounts", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      authRequired: true,
      authenticated: false,
      setupRequired: true,
      hasAccounts: false,
      user: null,
    });
  });

  it("refuses every other request until an account exists", async () => {
    const res = await request(app).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("creates the first account, makes it admin, and signs it in", async () => {
    const { res, cookie } = await setupAccount();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: "theowner",
      email: "owner@example.com",
      displayName: "The Owner",
      role: "admin",
    });
    // The hash must never leave the server.
    expect(JSON.stringify(res.body)).not.toContain("scrypt");
    expect(res.body.user.passwordHash).toBeUndefined();

    expect(cookie.join(";")).toContain("contrack_session=");
    const authed = await request(app)
      .get("/api/contacts")
      .set("Cookie", cookie);
    expect(authed.status).toBe(200);
  });

  it("lowercases the username and email so sign-in is case-insensitive", async () => {
    await setupAccount();
    for (const identifier of [
      "TheOwner",
      "theowner",
      "OWNER@EXAMPLE.COM",
      "owner@example.com",
    ]) {
      const { res } = await signIn(identifier, ACCOUNT.password);
      expect(res.status, `identifier ${identifier}`).toBe(200);
    }
  });

  it("closes setup once an account exists", async () => {
    await setupAccount();
    const second = await request(app).post("/api/auth/setup").send({
      email: "intruder@example.com",
      username: "intruder",
      password: "another long password",
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SETUP_COMPLETE");
    expect(countUsers()).toBe(1);
  });

  it("rejects a short password", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ ...ACCOUNT, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least 8/i);
    expect(countUsers()).toBe(0);
  });

  it("rejects an invalid username", async () => {
    for (const username of ["a", "has spaces", "-leading", "UPPER CASE!"]) {
      const res = await request(app)
        .post("/api/auth/setup")
        .send({ ...ACCOUNT, username });
      expect(res.status, `username ${username}`).toBe(400);
    }
    expect(countUsers()).toBe(0);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ ...ACCOUNT, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(countUsers()).toBe(0);
  });
});

// =============================================================================

describe("sign in", () => {
  beforeEach(async () => {
    wipeAccounts();
    await setupAccount();
    __resetAuthRateLimits();
  });

  it("accepts the right password", async () => {
    const { res, cookie } = await signIn("theowner", ACCOUNT.password);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("theowner");
    expect(cookie.join(";")).toContain("contrack_session=");
    expect(cookie.join(";")).toContain("HttpOnly");
    expect(cookie.join(";")).toContain("SameSite=Strict");
  });

  it("rejects the wrong password", async () => {
    const { res } = await signIn("theowner", "not the password");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("gives the same answer for an unknown account, so accounts can't be enumerated", async () => {
    const unknown = await signIn("nobody", "not the password");
    const wrong = await signIn("theowner", "not the password");
    expect(unknown.res.status).toBe(wrong.res.status);
    expect(unknown.res.body.error.message).toBe(wrong.res.body.error.message);
  });

  it("records lastLoginAt", async () => {
    const before = sqlite
      .prepare("SELECT lastLoginAt FROM users LIMIT 1")
      .get() as { lastLoginAt: string | null };
    expect(before.lastLoginAt).toBeNull();

    await signIn("theowner", ACCOUNT.password);

    const after = sqlite
      .prepare("SELECT lastLoginAt FROM users LIMIT 1")
      .get() as { lastLoginAt: string | null };
    expect(after.lastLoginAt).not.toBeNull();
  });

  it("rate-limits repeated failures", async () => {
    let sawLimit = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const { res } = await signIn("theowner", `guess-${attempt}`);
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit).toBe(true);

    // The limit must not outlive its window's reset — a locked-out owner has
    // to be able to get back in.
    __resetAuthRateLimits();
    const { res } = await signIn("theowner", ACCOUNT.password);
    expect(res.status).toBe(200);
  });
});

// =============================================================================

describe("gating", () => {
  let cookie: string[];

  beforeEach(async () => {
    wipeAccounts();
    const created = await setupAccount();
    cookie = created.cookie;
    __resetAuthRateLimits();
  });

  it("rejects unauthenticated API requests", async () => {
    const res = await request(app).get("/api/contacts");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("gates /uploads too", async () => {
    const res = await request(app).get("/uploads/anything.jpg");
    expect(res.status).toBe(401);
  });

  it("gates writes", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Should Not Exist" });
    expect(res.status).toBe(401);
  });

  it("accepts a valid session cookie", async () => {
    const res = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("rejects a forged session cookie", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Cookie", ["contrack_session=made-up-value"]);
    expect(res.status).toBe(401);
  });

  it("leaves everything open when AUTH_REQUIRED is off", async () => {
    process.env.AUTH_REQUIRED = "";
    try {
      const res = await request(app).get("/api/contacts");
      expect(res.status).toBe(200);
      const status = await request(app).get("/api/auth/status");
      expect(status.body).toMatchObject({
        authRequired: false,
        authenticated: true,
        setupRequired: false,
      });
    } finally {
      process.env.AUTH_REQUIRED = "true";
    }
  });

  it("does not push an ungated instance through setup even with no accounts", async () => {
    wipeAccounts();
    process.env.AUTH_REQUIRED = "";
    try {
      const status = await request(app).get("/api/auth/status");
      expect(status.body.setupRequired).toBe(false);
    } finally {
      process.env.AUTH_REQUIRED = "true";
    }
  });
});

// =============================================================================

describe("API token", () => {
  const TOKEN = "integration-test-api-token-12345";

  beforeEach(() => {
    wipeAccounts();
    process.env.API_TOKEN = TOKEN;
    __resetAuthRateLimits();
  });

  afterAll(() => {
    delete process.env.API_TOKEN;
  });

  it("admits a bearer token without any account existing", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it("rejects a wrong bearer token", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("enforces auth on its own, without AUTH_REQUIRED", async () => {
    process.env.AUTH_REQUIRED = "";
    try {
      const res = await request(app).get("/api/contacts");
      expect(res.status).toBe(401);
    } finally {
      process.env.AUTH_REQUIRED = "true";
    }
  });

  it("still honours the deprecated AUTH_TOKEN name", async () => {
    delete process.env.API_TOKEN;
    process.env.AUTH_TOKEN = "legacy-token-value";
    try {
      const res = await request(app)
        .get("/api/contacts")
        .set("Authorization", "Bearer legacy-token-value");
      expect(res.status).toBe(200);
    } finally {
      delete process.env.AUTH_TOKEN;
    }
  });

  it("cannot reach account endpoints — there is no account behind a token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("USER_REQUIRED");
  });
});

// =============================================================================

describe("the signed-in account", () => {
  let cookie: string[];

  beforeEach(async () => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    const created = await setupAccount();
    cookie = created.cookie;
    __resetAuthRateLimits();
  });

  it("returns the current account", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe("theowner");
  });

  it("updates the profile", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ displayName: "Renamed", username: "renamed" });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      displayName: "Renamed",
      username: "renamed",
      email: "owner@example.com", // untouched fields stay put
    });
  });

  it("rejects an invalid profile update without partially applying it", async () => {
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .send({ displayName: "Kept", username: "no spaces allowed" });
    expect(res.status).toBe(400);

    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.user.displayName).toBe("The Owner");
  });

  it("changes the password and invalidates the old one", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: ACCOUNT.password,
        newPassword: "a brand new long password",
      });
    expect(res.status).toBe(200);

    __resetAuthRateLimits();
    const old = await signIn("theowner", ACCOUNT.password);
    expect(old.res.status).toBe(401);

    __resetAuthRateLimits();
    const fresh = await signIn("theowner", "a brand new long password");
    expect(fresh.res.status).toBe(200);
  });

  it("refuses a password change without the current password", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: "wrong",
        newPassword: "a long enough password",
      });
    expect(res.status).toBe(401);
  });

  it("refuses a new password that is too short", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: ACCOUNT.password, newPassword: "abc" });
    expect(res.status).toBe(400);
  });

  it("needs a credential", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

// =============================================================================

describe("sessions", () => {
  let cookie: string[];

  beforeEach(async () => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    const created = await setupAccount();
    cookie = created.cookie;
    __resetAuthRateLimits();
  });

  it("lists the current session and marks it current", async () => {
    const res = await request(app)
      .get("/api/auth/sessions")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].current).toBe(true);
  });

  it("signs out, and the cookie stops working", async () => {
    const out = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(out.status).toBe(200);

    const after = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("stores only the hash of the session secret, never the secret", async () => {
    const secret = decodeURIComponent(
      cookie.join(";").match(/contrack_session=([^;]+)/)![1],
    );
    const rows = sqlite.prepare("SELECT id FROM sessions").all() as {
      id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(secret);
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("revokes other sessions while keeping the current one", async () => {
    const second = await signIn("theowner", ACCOUNT.password);
    const third = await signIn("theowner", ACCOUNT.password);
    expect(
      (sqlite.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number })
        .n,
    ).toBe(3);

    const res = await request(app)
      .delete("/api/auth/sessions")
      .set("Cookie", third.cookie);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(2);

    // The one that issued the request still works; the others do not.
    expect(
      (await request(app).get("/api/contacts").set("Cookie", third.cookie))
        .status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/contacts").set("Cookie", second.cookie))
        .status,
    ).toBe(401);
  });

  it("ends every other session when the password changes", async () => {
    const other = await signIn("theowner", ACCOUNT.password);
    await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: ACCOUNT.password,
        newPassword: "yet another long password",
      });

    expect(
      (await request(app).get("/api/contacts").set("Cookie", other.cookie))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get("/api/contacts").set("Cookie", cookie)).status,
    ).toBe(200);
  });

  it("rejects an expired session", async () => {
    sqlite
      .prepare("UPDATE sessions SET expiresAt = datetime('now', '-1 day')")
      .run();
    const res = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(res.status).toBe(401);
    // ...and cleans it up rather than leaving dead rows behind.
    expect(
      (sqlite.prepare("SELECT COUNT(*) n FROM sessions").get() as { n: number })
        .n,
    ).toBe(0);
  });
});

// =============================================================================

describe("data ownership", () => {
  beforeEach(() => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
  });

  it("claims pre-existing unowned contacts for the first account", async () => {
    // A contact written before any account existed — the state every current
    // installation is in.
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, ownerId) VALUES ('own-1', 'Legacy Contact', NULL)",
      )
      .run();

    const { res } = await setupAccount();
    expect(res.status).toBe(201);
    const userId = res.body.user.id;

    const row = sqlite
      .prepare("SELECT ownerId FROM contacts WHERE id = 'own-1'")
      .get() as { ownerId: string | null };
    expect(row.ownerId).toBe(userId);

    sqlite.prepare("DELETE FROM contacts WHERE id = 'own-1'").run();
  });

  it("claims unowned lists as well", async () => {
    sqlite
      .prepare(
        "INSERT INTO lists (id, name, ownerId) VALUES ('own-list', 'Legacy List', NULL)",
      )
      .run();

    const { res } = await setupAccount();
    const row = sqlite
      .prepare("SELECT ownerId FROM lists WHERE id = 'own-list'")
      .get() as { ownerId: string | null };
    expect(row.ownerId).toBe(res.body.user.id);

    sqlite.prepare("DELETE FROM lists WHERE id = 'own-list'").run();
  });

  it("carries ownership on every table that has it", () => {
    for (const table of [
      "contacts",
      "lists",
      "ai_invocations",
      "dedupe_merge_log",
    ]) {
      const columns = sqlite.pragma(`table_info(${table})`) as {
        name: string;
      }[];
      expect(
        columns.some((c) => c.name === "ownerId"),
        `${table} should carry ownerId`,
      ).toBe(true);
    }
  });
});

/** Count accounts directly — the service caches nothing, so this is truth. */
function countUsers(): number {
  return (sqlite.prepare("SELECT COUNT(*) n FROM users").get() as { n: number })
    .n;
}

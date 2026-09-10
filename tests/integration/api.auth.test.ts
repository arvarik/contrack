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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeTestApp } from "./helpers.ts";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import {
  requireAdmin,
  __resetAuthWarnings,
} from "../../server/middleware/auth.ts";
import type { AppError } from "../../server/utils/AppError.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";

const app = makeTestApp();

const ACCOUNT = {
  email: "Owner@Example.COM",
  username: "TheOwner",
  password: "correct horse battery staple",
  displayName: "The Owner",
};

/**
 * Remove every account and every row it owns, then put the local owner back.
 *
 * `DELETE FROM users` on its own stopped working in Phase 1. Owned rows
 * reference `users` with ON DELETE RESTRICT, and the local owner owns
 * everything written with auth off, so the delete fails on the first contact.
 * Recreating the local owner afterwards is not tidiness: with auth off,
 * attachPrincipal has no principal without it, and every direct INSERT in this
 * file needs an owner to name.
 */
function wipeAccounts(): void {
  sqlite.exec(`
    DELETE FROM dedupe_merge_log;
    DELETE FROM dedupe_exclusions;
    DELETE FROM dedupe_suggestions;
    DELETE FROM ai_invocations;
    DELETE FROM action_items;
    DELETE FROM interactions;
    DELETE FROM lists;
    DELETE FROM contacts;
    DELETE FROM sessions;
    DELETE FROM api_tokens;
    DELETE FROM users;
  `);
  ensureLocalOwner();
}

/** The account every row belongs to while nobody has signed in. */
function localOwner(): { id: string; username: string } {
  return sqlite
    .prepare(
      "SELECT id, username FROM users WHERE credentialState = 'none' LIMIT 1",
    )
    .get() as { id: string; username: string };
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
    expect(countSignInAccounts()).toBe(0);
  });

  it("rejects an invalid username", async () => {
    for (const username of ["a", "has spaces", "-leading", "UPPER CASE!"]) {
      const res = await request(app)
        .post("/api/auth/setup")
        .send({ ...ACCOUNT, username });
      expect(res.status, `username ${username}`).toBe(400);
    }
    expect(countSignInAccounts()).toBe(0);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ ...ACCOUNT, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(countSignInAccounts()).toBe(0);
  });

  it("refuses to register the reserved `local` username", async () => {
    // `local` is the account every instance already has. Registering it would
    // collide on the UNIQUE index, and reading it back would be ambiguous with
    // the implicit principal.
    const res = await request(app)
      .post("/api/auth/setup")
      .send({ ...ACCOUNT, username: "local" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/reserved/i);
    expect(countSignInAccounts()).toBe(0);
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

  it("leaves everything open when AUTH_REQUIRED is off, as the local owner", async () => {
    wipeAccounts();
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
      // The caller is no longer anonymous. It is the account that owns this
      // device's data, which is what makes every write stampable.
      expect(status.body.user.username).toBe("local");
      expect(status.body.user.credentialState).toBe("none");
      // How they authenticated is nobody's business but the server's.
      expect(status.body.user.via).toBeUndefined();
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

  it("admits a bearer token, acting as the primary admin", async () => {
    // Before Phase 1 the env token was a `service` principal with no account
    // behind it. There is always an account now, so it resolves to the admin
    // with the earliest createdAt, which on a fresh instance is the local
    // owner. That is what gives its writes an owner.
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);

    const status = await request(app)
      .get("/api/auth/status")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(status.body.user.id).toBe(localOwner().id);
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

  it("cannot reach account endpoints — a token is not a session", async () => {
    // The account exists now, so the refusal is about the credential rather
    // than the account: a token must not be able to change the password that
    // would revoke it. USER_REQUIRED became SESSION_REQUIRED in Phase 1.
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SESSION_REQUIRED");
  });

  it("still reaches a data endpoint that a session would", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
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

describe("requireAdmin", () => {
  // Phase 1 built the gate, Phase 3 mounted it. These four cases cover the
  // middleware itself; api.admin.test.ts covers what it protects.
  const run = (principal: unknown): { code?: string; status?: number } => {
    let captured: AppError | undefined;
    requireAdmin(
      { principal } as never,
      {} as never,
      ((err?: unknown) => {
        captured = err as AppError;
      }) as never,
    );
    return { code: captured?.code, status: captured?.statusCode };
  };

  it("passes an admin", () => {
    expect(
      run({ kind: "user", user: { role: "admin" }, via: "session" }),
    ).toEqual({ code: undefined, status: undefined });
  });

  it("refuses a member with ADMIN_REQUIRED", () => {
    expect(
      run({ kind: "user", user: { role: "member" }, via: "session" }),
    ).toEqual({ code: "ADMIN_REQUIRED", status: 403 });
  });

  it("refuses an unauthenticated request with UNAUTHORIZED", () => {
    expect(run(undefined)).toEqual({ code: "UNAUTHORIZED", status: 401 });
  });

  it("is mounted in every route file Phase 3 names", () => {
    // Task 3.1 lists the files that hold an admin route. The route manifest
    // test proves the guard sits on each individual route; this proves no
    // whole file was forgotten, which is the mistake that would leave a group
    // of endpoints open at once.
    const named = [
      "admin.ts",
      "auth.ts",
      "ai.ts",
      "aiSettings.ts",
      "dataLifecycle.ts",
      "dedupe/embeddings.ts",
    ];
    const missing = named.filter(
      (file) =>
        !/\brequireAdmin\b/.test(
          fs.readFileSync(path.join("server/routes", file), "utf8"),
        ),
    );
    expect(missing).toEqual([]);
  });
});

// =============================================================================

describe("a personal API token", () => {
  // Phase 3 adds the endpoints that mint these. The lookup exists now because
  // the principal shape has to be final before Phase 2 scopes every read, so
  // the row goes in by hand.
  const SECRET = "ctk_" + "a".repeat(43);
  let userId: string;

  function issue(overrides: Partial<Record<string, string | null>> = {}): void {
    const hash = crypto.createHash("sha256").update(SECRET).digest("hex");
    sqlite
      .prepare(
        `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, expiresAt, revokedAt)
         VALUES ('tok-1', ?, 'A script', ?, ?, ?, ?)`,
      )
      .run(
        userId,
        hash,
        SECRET.slice(0, 12),
        overrides.expiresAt ?? null,
        overrides.revokedAt ?? null,
      );
  }

  beforeEach(async () => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
    const { res } = await setupAccount();
    userId = res.body.user.id;
    sqlite.prepare("DELETE FROM api_tokens").run();
  });

  it("acts as its own account on a data endpoint", async () => {
    issue();
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);

    const status = await request(app)
      .get("/api/auth/status")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(status.body.user.id).toBe(userId);
  });

  it("cannot reach an endpoint that manages the account", async () => {
    // A token must not be able to change the password that would revoke it.
    issue();
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SESSION_REQUIRED");
  });

  it("stamps lastUsedAt so an unused token is visible as unused", async () => {
    issue();
    await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${SECRET}`);
    const row = sqlite
      .prepare("SELECT lastUsedAt FROM api_tokens WHERE id = 'tok-1'")
      .get() as { lastUsedAt: string | null };
    expect(row.lastUsedAt).not.toBeNull();
  });

  it.each([
    ["revoked", { revokedAt: "2020-01-01 00:00:00" }],
    ["expired", { expiresAt: "2020-01-01 00:00:00" }],
  ])("refuses a %s token", async (_label, overrides) => {
    issue(overrides);
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(401);
  });

  it("refuses a token whose account is disabled", async () => {
    issue();
    sqlite
      .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .run(userId);
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(401);
  });

  it("refuses a token that was never issued", async () => {
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ctk_${"z".repeat(43)}`);
    expect(res.status).toBe(401);
  });

  it("stores only the hash, never the token", () => {
    issue();
    const row = sqlite
      .prepare(
        "SELECT tokenHash, tokenPrefix FROM api_tokens WHERE id = 'tok-1'",
      )
      .get() as { tokenHash: string; tokenPrefix: string };
    expect(row.tokenHash).not.toContain(SECRET);
    expect(row.tokenHash).toHaveLength(64);
    // The prefix is short enough to be an identifier rather than a credential.
    expect(SECRET.startsWith(row.tokenPrefix)).toBe(true);
    expect(row.tokenPrefix).toHaveLength(12);
  });
});

// =============================================================================

describe("a disabled account", () => {
  beforeEach(() => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
  });

  it("cannot sign in, and its live session stops working", async () => {
    const { cookie } = await setupAccount();

    // The session works right up until the account is disabled.
    const before = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(before.status).toBe(200);

    sqlite
      .prepare(
        "UPDATE users SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP WHERE credentialState = 'password'",
      )
      .run();

    // No sign-out needed and no session row deleted: attachPrincipal refuses
    // to build a principal for a disabled user, so the cookie it already holds
    // stops resolving on the very next request. That is the point of keeping
    // sessions server-side.
    const after = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHORIZED");

    const data = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(data.status).toBe(401);

    // The right password now gets a straight answer, because whoever holds it
    // has already proved the account is theirs. A wrong one still gets the
    // shared "incorrect username or password", so this cannot enumerate.
    __resetAuthRateLimits();
    const { res } = await signIn(ACCOUNT.username, ACCOUNT.password);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_DISABLED");

    __resetAuthRateLimits();
    const wrong = await signIn(ACCOUNT.username, "not the password at all");
    expect(wrong.res.status).toBe(401);
    expect(wrong.res.body.error.code).toBe("INVALID_CREDENTIALS");
  });
});

// =============================================================================

describe("auth off with a real account", () => {
  beforeEach(() => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
  });

  afterAll(() => {
    __resetAuthWarnings();
    process.env.AUTH_REQUIRED = "true";
  });

  it("forces auth on at boot rather than guessing who the caller is", async () => {
    await setupAccount();

    process.env.AUTH_REQUIRED = "";
    __resetAuthWarnings();
    try {
      // Auth-off mode means "the person at the keyboard is the local owner".
      // With a real account that sentence has no answer, so createApp refuses
      // the premise: it logs an error and enforces auth anyway.
      const gated = makeTestApp();
      const res = await request(gated).get("/api/contacts");
      expect(res.status).toBe(401);

      const status = await request(gated).get("/api/auth/status");
      expect(status.body.authRequired).toBe(true);
      expect(status.body.setupRequired).toBe(false);
    } finally {
      __resetAuthWarnings();
      process.env.AUTH_REQUIRED = "true";
    }
  });

  it("leaves auth off when the local owner is the only account", async () => {
    process.env.AUTH_REQUIRED = "";
    __resetAuthWarnings();
    try {
      const open = makeTestApp();
      const res = await request(open).get("/api/contacts");
      expect(res.status).toBe(200);
      const status = await request(open).get("/api/auth/status");
      expect(status.body.authRequired).toBe(false);
      expect(status.body.user.username).toBe("local");
    } finally {
      __resetAuthWarnings();
      process.env.AUTH_REQUIRED = "true";
    }
  });
});

// =============================================================================

describe("data ownership", () => {
  beforeEach(() => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
  });

  it("keeps this device's contacts by converting the local owner", async () => {
    // A contact written before anyone secured the instance — the state every
    // current installation is in. It belongs to the local owner from boot, so
    // there is nothing to claim: setup converts that account in place and the
    // id never changes, which is what carries the data across.
    const before = localOwner().id;
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, ownerId) VALUES ('own-1', 'Legacy Contact', ?)",
      )
      .run(before);

    const { res } = await setupAccount();
    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe(before);
    expect(res.body.user.credentialState).toBe("password");

    const row = sqlite
      .prepare("SELECT ownerId FROM contacts WHERE id = 'own-1'")
      .get() as { ownerId: string | null };
    expect(row.ownerId).toBe(res.body.user.id);
    // The account converted rather than a second one appearing beside it.
    expect(countUsers()).toBe(1);

    sqlite.prepare("DELETE FROM contacts WHERE id = 'own-1'").run();
  });

  it("keeps lists the same way", async () => {
    sqlite
      .prepare(
        "INSERT INTO lists (id, name, ownerId) VALUES ('own-list', 'Legacy List', ?)",
      )
      .run(localOwner().id);

    const { res } = await setupAccount();
    const row = sqlite
      .prepare("SELECT ownerId FROM lists WHERE id = 'own-list'")
      .get() as { ownerId: string | null };
    expect(row.ownerId).toBe(res.body.user.id);

    sqlite.prepare("DELETE FROM lists WHERE id = 'own-list'").run();
  });

  it("still claims a row written with no owner at all", async () => {
    // The invariant triggers make this state unreachable through SQL, so the
    // claim is proven through the boot path that would meet it: a row from a
    // 1.x database. reconcileOwnership runs on every boot for exactly this.
    const { reconcileOwnership } =
      await import("../../server/services/authService.ts");
    sqlite.exec("DROP TRIGGER contacts_owner_required");
    try {
      sqlite
        .prepare(
          "INSERT INTO contacts (id, name) VALUES ('own-null', 'From 1.x')",
        )
        .run();
    } finally {
      sqlite.exec(`CREATE TRIGGER contacts_owner_required BEFORE INSERT ON contacts
        WHEN NEW.ownerId IS NULL
        BEGIN SELECT RAISE(ABORT, 'contacts.ownerId is required'); END;`);
    }

    reconcileOwnership();
    const row = sqlite
      .prepare("SELECT ownerId FROM contacts WHERE id = 'own-null'")
      .get() as { ownerId: string | null };
    expect(row.ownerId).toBe(localOwner().id);

    sqlite.prepare("DELETE FROM contacts WHERE id = 'own-null'").run();
  });

  it("carries ownership on every table that has it", () => {
    for (const table of [
      "contacts",
      "lists",
      "interactions",
      "action_items",
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
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

/**
 * Accounts somebody can actually sign in to.
 *
 * `countUsers()` is never zero since Phase 1: the local owner exists from
 * boot. "No account yet" now means no account with a password.
 */
function countSignInAccounts(): number {
  return (
    sqlite
      .prepare(
        "SELECT COUNT(*) n FROM users WHERE credentialState = 'password'",
      )
      .get() as { n: number }
  ).n;
}

// =============================================================================

describe("session policy", () => {
  let cookie: string[];

  beforeEach(async () => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    sqlite.exec("DELETE FROM app_settings WHERE key = 'auth.sessionTtlDays'");
    clearSettingsCache();
    const created = await setupAccount();
    cookie = created.cookie;
    __resetAuthRateLimits();
  });

  afterAll(() => {
    sqlite.exec("DELETE FROM app_settings WHERE key = 'auth.sessionTtlDays'");
    clearSettingsCache();
  });

  it("defaults to 30 days and reports its range", async () => {
    const res = await request(app)
      .get("/api/auth/session-policy")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionTtlDays: 30, min: 1, max: 365 });
  });

  it("changes the lifetime of sessions created afterwards", async () => {
    const put = await request(app)
      .put("/api/auth/session-policy")
      .set("Cookie", cookie)
      .send({ sessionTtlDays: 1 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.sessionTtlDays).toBe(1);

    __resetAuthRateLimits();
    await signIn("theowner", ACCOUNT.password);

    // Ordered by rowid, not createdAt: CURRENT_TIMESTAMP has one-second
    // resolution and both sessions are created inside the same second, so
    // ordering by it picks a row at random.
    const row = sqlite
      .prepare("SELECT expiresAt FROM sessions ORDER BY rowid DESC LIMIT 1")
      .get() as { expiresAt: string };
    const days = (new Date(row.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(0.9);
    expect(days).toBeLessThan(1.1);
  });

  it("leaves existing sessions alone, so a change cannot lock you out", async () => {
    const before = sqlite
      .prepare("SELECT expiresAt FROM sessions LIMIT 1")
      .get() as { expiresAt: string };

    await request(app)
      .put("/api/auth/session-policy")
      .set("Cookie", cookie)
      .send({ sessionTtlDays: 1 });

    const after = sqlite
      .prepare("SELECT expiresAt FROM sessions LIMIT 1")
      .get() as { expiresAt: string };
    expect(after.expiresAt).toBe(before.expiresAt);

    // ...and that session still works.
    expect(
      (await request(app).get("/api/contacts").set("Cookie", cookie)).status,
    ).toBe(200);
  });

  it("rejects values outside the supported range", async () => {
    for (const bad of [0, -5, 366, 1.5, "thirty", null]) {
      const res = await request(app)
        .put("/api/auth/session-policy")
        .set("Cookie", cookie)
        .send({ sessionTtlDays: bad });
      expect(res.status, `value ${String(bad)}`).toBe(400);
    }
    // ...and the stored value is untouched.
    const res = await request(app)
      .get("/api/auth/session-policy")
      .set("Cookie", cookie);
    expect(res.body.sessionTtlDays).toBe(30);
  });

  it("needs an account, not just a token", async () => {
    process.env.API_TOKEN = "policy-token";
    try {
      const res = await request(app)
        .get("/api/auth/session-policy")
        .set("Authorization", "Bearer policy-token");
      expect(res.status).toBe(403);
    } finally {
      delete process.env.API_TOKEN;
    }
  });
});

// =============================================================================

describe("setup reports what is waiting", () => {
  beforeEach(() => {
    wipeAccounts();
    delete process.env.API_TOKEN;
    __resetAuthRateLimits();
  });

  it("counts this device's contacts so the setup screen can name them", async () => {
    const owner = localOwner().id;
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, ownerId) VALUES ('cnt-1', 'Waiting One', ?)",
      )
      .run(owner);
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, ownerId) VALUES ('cnt-2', 'Waiting Two', ?)",
      )
      .run(owner);
    const res = await request(app).get("/api/auth/status");
    expect(res.body.setupRequired).toBe(true);
    expect(res.body.deviceContacts).toBeGreaterThanOrEqual(2);
    // The pre-2.0 name is still sent so the current frontend keeps working.
    expect(res.body.existingContacts).toBe(res.body.deviceContacts);
    sqlite.exec("DELETE FROM contacts WHERE id IN ('cnt-1','cnt-2')");
  });

  it("excludes trashed and ghost contacts from that count", async () => {
    const owner = localOwner().id;
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, deletedAt, ownerId) VALUES ('cnt-del', 'Trashed', '2020-01-01', ?)",
      )
      .run(owner);
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, isGhost, ownerId) VALUES ('cnt-ghost', 'Ghosty', 1, ?)",
      )
      .run(owner);
    const res = await request(app).get("/api/auth/status");
    expect(res.body.deviceContacts).toBe(0);
    sqlite.exec("DELETE FROM contacts WHERE id IN ('cnt-del','cnt-ghost')");
  });

  it("reports zero once the instance is secured", async () => {
    await setupAccount();
    const res = await request(app).get("/api/auth/status");
    expect(res.body.setupRequired).toBe(false);
    expect(res.body.deviceContacts).toBe(0);
  });
});

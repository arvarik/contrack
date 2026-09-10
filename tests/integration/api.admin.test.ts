// =============================================================================
// Integration Tests — the admin API
// =============================================================================
// Phase 3 turns a classification into a guard. Fourteen routes carried the
// `admin` class through Phase 2 and nothing enforced it; thirteen more arrive
// here. Every one of them is now closed to a member, and the manifest test
// proves the guard sits on each route. This file proves what happens behind
// the guard: accounts are created, invited, disabled, and finally deleted with
// everything they own.
//
// Two conventions run through the file.
//
//   • Every describe that needs a particular arrangement of accounts starts
//     from a clean instance and holds its own handles. Sharing one admin
//     across the whole file was tried first and made every last-admin case
//     depend on the case above it.
//   • Everything runs with AUTH_REQUIRED on. With authentication off the
//     implicit principal is the local owner, which is an admin, so every
//     assertion about a member being refused would pass for the wrong reason.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { resetAccounts, rowsOwnedBy } from "./tenancy/helpers.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";
import { ROUTE_MANIFEST } from "../../server/tenancy/routeManifest.ts";
import { ownerUploadDir, UPLOADS_DIR } from "../../server/utils/paths.ts";
import { ownerToken, scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { auditService } from "../../server/services/auditService.ts";

const app = makeTestApp();

/** The password every account in this file ends up with. */
const PASSWORD = "correct horse battery staple";

/** One signed-in account: what a test needs to act as somebody. */
interface Handle {
  id: string;
  username: string;
  cookie: string[];
}

// =============================================================================
// Harness
// =============================================================================

function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

/** Attach an account's session to a request. */
function as(who: Handle) {
  return (r: request.Test): request.Test => r.set("Cookie", who.cookie);
}

/** Sign in, clearing the per-IP window this file shares with every test. */
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

/**
 * Wipe every account and secure the instance, which is how the first admin is
 * made in production.
 *
 * `POST /api/auth/setup` converts the local owner rather than adding a second
 * account, so a secured instance has no local owner row at all. The one
 * describe that needs both arranges that state itself.
 */
async function freshInstance(username: string): Promise<Handle> {
  resetAccounts();
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
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
  expect(res.body.user.role).toBe("admin");
  return { id: res.body.user.id, username, cookie: cookieFrom(res) };
}

/**
 * Create an account through the admin API and finish its forced password
 * change, which is what a person does on their first sign-in.
 */
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
  expect(changed.status, JSON.stringify(changed.body)).toBe(200);

  return { id: created.body.user.id, username, cookie };
}

/** Insert a personal token by hand. The endpoints that mint these come next. */
function issueToken(userId: string): string {
  const secret = `ctk_${crypto.randomBytes(32).toString("base64url")}`;
  sqlite
    .prepare(
      `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix)
       VALUES (?, ?, 'A script', ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      userId,
      crypto.createHash("sha256").update(secret).digest("hex"),
      secret.slice(0, 12),
    );
  return secret;
}

function callRoute(method: string, url: string): request.Test {
  const agent = request(app);
  switch (method) {
    case "GET":
      return agent.get(url);
    case "POST":
      return agent.post(url);
    case "PUT":
      return agent.put(url);
    case "PATCH":
      return agent.patch(url);
    case "DELETE":
      return agent.delete(url);
    default:
      throw new Error(`callRoute cannot send ${method}`);
  }
}

/** The token an FTS row carries for this owner. */
function ftsRows(ownerId: string): number {
  return (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM contacts_fts
          WHERE contacts_fts MATCH 'ownerTok:' || ?`,
      )
      .get(ownerToken(scopeForOwnerId(ownerId))) as { n: number }
  ).n;
}

beforeAll(() => {
  process.env.AUTH_REQUIRED = "true";
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  resetAccounts();
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
  __resetAuthWarnings();
});

beforeEach(() => {
  __resetAuthRateLimits();
});

// =============================================================================
// 3.1 Role enforcement
// =============================================================================

const ADMIN_ROUTES = ROUTE_MANIFEST.filter((r) => r.class === "admin");

/** Fill in every path parameter. The guard runs before a handler reads one. */
function concretePath(routePath: string): string {
  return routePath.replace(/:[A-Za-z]+/g, "placeholder");
}

describe("every admin route", () => {
  let admin: Handle;
  let member: Handle;

  beforeAll(async () => {
    admin = await freshInstance("guardadmin");
    member = await createAndActivate(admin, "guardmember");
  });

  it("covers the whole admin class, so the loops below miss nothing", () => {
    expect(ADMIN_ROUTES).toHaveLength(29);
  });

  it.each(ADMIN_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "refuses a member on %s",
    async (_label, route) => {
      const res = await as(member)(
        callRoute(route.method, concretePath(route.path)).send({}),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error.code).toBe("ADMIN_REQUIRED");
    },
  );

  it.each(ADMIN_ROUTES.map((r) => [`${r.method} ${r.path}`, r] as const))(
    "lets an admin past the guard on %s",
    async (_label, route) => {
      // Past the guard, not necessarily to a 200. Several of these do real
      // work with a placeholder id — delete a provider key that is not there,
      // refresh models for a provider that is not configured — and answer
      // 400 or 404. The guard's decision is the one thing asserted here.
      const res = await as(admin)(
        callRoute(route.method, concretePath(route.path)).send({}),
      );
      expect(res.status, JSON.stringify(res.body)).not.toBe(403);
    },
  );

  it("answers 200 to an admin on the routes that only read", async () => {
    for (const url of [
      "/api/backups",
      "/api/ai/diagnostics",
      "/api/ai/grounding-capacity",
      "/api/debug/cache-stats",
      "/api/admin/users",
      "/api/admin/invitations",
      "/api/admin/audit",
    ]) {
      const res = await as(admin)(request(app).get(url));
      expect(res.status, url).toBe(200);
    }
  });

  it("refuses a caller with no credential before it looks at any role", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

// =============================================================================
// 3.2 User management
// =============================================================================

describe("managing accounts", () => {
  let admin: Handle;
  let member: Handle;

  beforeAll(async () => {
    admin = await freshInstance("listadmin");
    member = await createAndActivate(admin, "listmember");
    await as(member)(
      request(app)
        .post("/api/contacts")
        .send({ name: "Counted Contact", company: "Acme" }),
    );
    issueToken(member.id);
  });

  it("names every account with its counts and marks the caller", async () => {
    const res = await as(admin)(request(app).get("/api/admin/users"));
    expect(res.status).toBe(200);

    const byName = Object.fromEntries(
      (
        res.body.users as {
          username: string;
          sessionCount: number;
          tokenCount: number;
        }[]
      ).map((u) => [u.username, u]),
    );
    // Securing the instance converted the local owner, so there is no `local`
    // row left to find. The describe below covers the instance that still has
    // one.
    expect(Object.keys(byName).sort()).toEqual(["listadmin", "listmember"]);
    expect(byName.listadmin).toMatchObject({
      role: "admin",
      status: "active",
      isSelf: true,
      isLocalOwner: false,
    });
    expect(byName.listmember).toMatchObject({
      role: "member",
      isSelf: false,
      contactCount: 1,
      tokenCount: 1,
    });
    expect(byName.listadmin.tokenCount).toBe(0);
    // The member signed in, so they hold a live session.
    expect(byName.listmember.sessionCount).toBeGreaterThan(0);
  });

  it("counts only the sessions that are still live", async () => {
    // `createSession` writes `new Date(...).toISOString()` while the count
    // compares against `datetime('now')`, and SQLite compares TEXT byte by
    // byte: a `T` sorts after a space, so a session that expired earlier
    // today counted as live until the UTC date rolled over. The account's own
    // list at GET /api/auth/sessions reads the same column the same way, so
    // the two would have disagreed if only one of them were fixed.
    const before = await as(admin)(
      request(app).get(`/api/admin/users/${member.id}`),
    );
    const live = before.body.user.sessionCount;
    expect(live).toBeGreaterThan(0);

    sqlite
      .prepare("UPDATE sessions SET expiresAt = ? WHERE userId = ?")
      .run(new Date(Date.now() - 3600_000).toISOString(), member.id);

    const after = await as(admin)(
      request(app).get(`/api/admin/users/${member.id}`),
    );
    expect(after.body.user.sessionCount).toBe(0);

    const inList = await as(admin)(request(app).get("/api/admin/users"));
    expect(
      (inList.body.users as { id: string; sessionCount: number }[]).find(
        (u) => u.id === member.id,
      )?.sessionCount,
    ).toBe(0);
  });

  it("never returns a password hash", async () => {
    const res = await as(admin)(request(app).get("/api/admin/users"));
    const rendered = JSON.stringify(res.body);
    expect(rendered).not.toContain("passwordHash");
    expect(rendered).not.toContain("scrypt$");
  });

  it("reports what one account owns", async () => {
    const res = await as(admin)(
      request(app).get(`/api/admin/users/${member.id}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      contacts: 1,
      interactions: 0,
      lists: 0,
      files: 0,
    });
  });

  it("answers 404 for an account that does not exist", async () => {
    const res = await as(admin)(
      request(app).get(`/api/admin/users/${crypto.randomUUID()}`),
    );
    expect(res.status).toBe(404);
  });

  it("returns a temporary password once and stores only its hash", async () => {
    const res = await as(admin)(
      request(app)
        .post("/api/admin/users")
        .send({ email: "fresh@example.com", username: "freshuser" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(res.body.user).toMatchObject({
      username: "freshuser",
      role: "member",
      mustChangePassword: true,
    });

    const stored = sqlite
      .prepare("SELECT passwordHash, createdBy FROM users WHERE id = ?")
      .get(res.body.user.id) as { passwordHash: string; createdBy: string };
    expect(stored.passwordHash).not.toContain(res.body.temporaryPassword);
    expect(stored.createdBy).toBe(admin.id);

    // Reading the account back never returns the password again.
    const reread = await as(admin)(
      request(app).get(`/api/admin/users/${res.body.user.id}`),
    );
    expect(JSON.stringify(reread.body)).not.toContain(
      res.body.temporaryPassword,
    );
  });

  it("creates an admin when the body asks for one", async () => {
    const res = await as(admin)(
      request(app).post("/api/admin/users").send({
        email: "second@example.com",
        username: "secondadmin",
        role: "admin",
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("admin");
  });

  it("refuses a duplicate username", async () => {
    const res = await as(admin)(
      request(app)
        .post("/api/admin/users")
        .send({ email: "other@example.com", username: "listmember" }),
    );
    expect(res.status).toBe(409);
  });

  it("refuses the username the local owner reserves", async () => {
    const res = await as(admin)(
      request(app)
        .post("/api/admin/users")
        .send({ email: "local2@example.com", username: "local" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses a body with no username", async () => {
    const res = await as(admin)(
      request(app).post("/api/admin/users").send({ email: "x@example.com" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("changes a role and records what changed", async () => {
    const target = await createAndActivate(admin, "promoteme");
    const res = await as(admin)(
      request(app)
        .patch(`/api/admin/users/${target.id}`)
        .send({ role: "admin" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("admin");

    const row = sqlite
      .prepare(
        `SELECT details FROM audit_log
          WHERE action = 'user.role.changed' AND targetId = ?`,
      )
      .get(target.id) as { details: string };
    expect(JSON.parse(row.details)).toMatchObject({
      from: "member",
      to: "admin",
    });
  });

  it("changes a display name", async () => {
    const res = await as(admin)(
      request(app)
        .patch(`/api/admin/users/${member.id}`)
        .send({ displayName: "The Member" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe("The Member");
  });

  it("refuses an empty patch", async () => {
    const res = await as(admin)(
      request(app).patch(`/api/admin/users/${member.id}`).send({}),
    );
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// 3.4 Temporary password and the forced change
// =============================================================================

describe("an account whose password an admin chose", () => {
  let admin: Handle;
  let created: { id: string; temporaryPassword: string };
  let cookie: string[];
  /** A forced-change account that is also an admin. */
  let adminCookie: string[];

  beforeAll(async () => {
    admin = await freshInstance("forceadmin");
    const res = await as(admin)(
      request(app)
        .post("/api/admin/users")
        .send({ email: "forced@example.com", username: "forceduser" }),
    );
    created = {
      id: res.body.user.id,
      temporaryPassword: res.body.temporaryPassword,
    };
    cookie = await signIn("forceduser", created.temporaryPassword);

    // A second account with the same forced change and the admin role, for
    // the routes a member would be refused on for the other reason.
    const asAdminToo = await as(admin)(
      request(app).post("/api/admin/users").send({
        email: "forcedadmin@example.com",
        username: "forcedadmin",
        role: "admin",
      }),
    );
    adminCookie = await signIn(
      "forcedadmin",
      asAdminToo.body.temporaryPassword as string,
    );
  });

  it("signs in with the temporary password", () => {
    expect(cookie.length).toBeGreaterThan(0);
  });

  it.each([
    ["GET", "/api/contacts"],
    ["GET", "/api/dashboard"],
    ["GET", "/api/lists/"],
    ["GET", "/api/export/json"],
    ["GET", "/api/timeline"],
    ["GET", "/api/trash"],
  ])("refuses %s %s until the password changes", async (method, url) => {
    const res = await callRoute(method, url).set("Cookie", cookie);
    expect(res.status, url).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("refuses the upload path too, which the same gate covers", async () => {
    const res = await request(app)
      .get("/uploads/u/does-not-matter/avatars/face.png")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("exempts named paths rather than the whole auth namespace", async () => {
    // The first shape of this gate exempted anything starting with
    // /api/auth/, which quietly covered an unknown path under it as well.
    const res = await request(app)
      .get("/api/auth/no-such-endpoint")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("still reaches its own account, which is where the fix lives", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it("refuses a personal token of the same account for the same reason", async () => {
    const secret = issueToken(created.id);
    const res = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${secret}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("cannot write an instance setting from inside the auth namespace", async () => {
    // PUT /api/auth/session-policy is instance administration that happens to
    // live in the auth router, and that router is mounted ahead of the gate.
    // Somebody holding only a hand-over password could otherwise set every
    // future session on the instance to a year.
    const before = await as(admin)(
      request(app).get("/api/auth/session-policy"),
    );

    const res = await request(app)
      .put("/api/auth/session-policy")
      .set("Cookie", adminCookie)
      .send({ sessionTtlDays: 365 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const after = await as(admin)(request(app).get("/api/auth/session-policy"));
    expect(after.body.sessionTtlDays).toBe(before.body.sessionTtlDays);
  });

  it("still needs the temporary password to replace it", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "not the one", newPassword: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("works everywhere once the password is the person's own", async () => {
    const changed = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({
        currentPassword: created.temporaryPassword,
        newPassword: PASSWORD,
      });
    expect(changed.status).toBe(200);

    const res = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const row = sqlite
      .prepare(
        "SELECT mustChangePassword, passwordChangedAt FROM users WHERE id = ?",
      )
      .get(created.id) as {
      mustChangePassword: number;
      passwordChangedAt: string | null;
    };
    expect(row.mustChangePassword).toBe(0);
    expect(row.passwordChangedAt).not.toBeNull();
  });
});

describe("resetting a password", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("resetadmin");
  });

  it("issues a new temporary password and ends every credential", async () => {
    const target = await createAndActivate(admin, "resetme");
    const secret = issueToken(target.id);

    const before = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${secret}`);
    expect(before.status).toBe(200);

    const res = await as(admin)(
      request(app).post(`/api/admin/users/${target.id}/reset-password`),
    );
    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{20}$/);

    // The cookie that worked a moment ago does not.
    const session = await request(app)
      .get("/api/contacts")
      .set("Cookie", target.cookie);
    expect(session.status).toBe(401);

    // Tokens are revoked outright. A reset happens because the old credential
    // is not trusted, and a token minted under it must not outlive it.
    const token = await request(app)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${secret}`);
    expect(token.status).toBe(401);

    // The new password works, and forces a change of its own.
    const cookie = await signIn("resetme", res.body.temporaryPassword);
    const gated = await request(app).get("/api/contacts").set("Cookie", cookie);
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("answers 404 for an account that is not there", async () => {
    const res = await as(admin)(
      request(app).post(
        `/api/admin/users/${crypto.randomUUID()}/reset-password`,
      ),
    );
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// 3.3 Invitations
// =============================================================================

describe("invitations", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("inviteadmin");
  });

  function tokenFrom(link: string): string {
    return new URL(link).searchParams.get("token")!;
  }

  async function invite(
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; link: string; expiresAt: string }> {
    const res = await as(admin)(
      request(app).post("/api/admin/invitations").send(body),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it("returns a link once and stores only the hash of its secret", async () => {
    const created = await invite({ email: "Invited@Example.com" });
    expect(created.link).toContain("/join?token=");

    const secret = tokenFrom(created.link);
    const row = sqlite
      .prepare("SELECT tokenHash, email, role FROM invitations WHERE id = ?")
      .get(created.id) as { tokenHash: string; email: string; role: string };
    expect(row.tokenHash).toBe(
      crypto.createHash("sha256").update(secret).digest("hex"),
    );
    expect(row.email).toBe("invited@example.com");
    expect(row.role).toBe("member");

    // Nothing reads the secret back, including the list the admin sees.
    const list = await as(admin)(request(app).get("/api/admin/invitations"));
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(list.body.invitations[0]).toMatchObject({ status: "pending" });
  });

  it("builds the link from the host the client reached, proxy included", async () => {
    const direct = await as(admin)(
      request(app).post("/api/admin/invitations").send({}),
    );
    // The test server listens on 127.0.0.1 and an ephemeral port, and the
    // link has to carry the port or it points at the wrong instance.
    expect(direct.body.link).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/join\?token=/,
    );

    // A reverse proxy that rewrites Host would otherwise put its own internal
    // name in the link. Only the one hop `trust proxy` names can set these.
    const proxied = await as(admin)(
      request(app)
        .post("/api/admin/invitations")
        .set("X-Forwarded-Host", "contrack.example.com")
        .set("X-Forwarded-Proto", "https")
        .send({}),
    );
    expect(proxied.body.link).toMatch(
      /^https:\/\/contrack\.example\.com\/join\?token=/,
    );

    // A header with a path in it is not a host, and does not become one.
    const hostile = await as(admin)(
      request(app)
        .post("/api/admin/invitations")
        .set("X-Forwarded-Host", "evil.example.com/steal")
        .send({}),
    );
    expect(hostile.body.link).not.toContain("evil.example.com");
  });

  it("creates an account with the role the invitation carries", async () => {
    const created = await invite({ role: "admin" });
    const res = await request(app)
      .post("/api/auth/accept-invitation")
      .send({
        token: tokenFrom(created.link),
        email: "joiner@example.com",
        username: "joiner",
        password: PASSWORD,
        displayName: "The Joiner",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({
      username: "joiner",
      role: "admin",
      mustChangePassword: false,
    });
    // Signed in on the spot, so the person lands in the app rather than on a
    // sign-in form for the password they typed one field ago.
    expect(cookieFrom(res).length).toBeGreaterThan(0);

    const row = sqlite
      .prepare("SELECT acceptedBy, acceptedAt FROM invitations WHERE id = ?")
      .get(created.id) as { acceptedBy: string; acceptedAt: string };
    expect(row.acceptedBy).toBe(res.body.user.id);
    expect(row.acceptedAt).not.toBeNull();

    // Whoever issued the invitation is recorded on the account it produced.
    const account = sqlite
      .prepare("SELECT createdBy FROM users WHERE id = ?")
      .get(res.body.user.id) as { createdBy: string };
    expect(account.createdBy).toBe(admin.id);
  });

  it("refuses a second use with INVITATION_USED", async () => {
    const created = await invite();
    const token = tokenFrom(created.link);
    const first = await request(app).post("/api/auth/accept-invitation").send({
      token,
      email: "once@example.com",
      username: "onceonly",
      password: PASSWORD,
    });
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/auth/accept-invitation").send({
      token,
      email: "twice@example.com",
      username: "twiceover",
      password: PASSWORD,
    });
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe("INVITATION_USED");
    // The refused attempt left no account behind.
    expect(
      sqlite.prepare("SELECT id FROM users WHERE username = 'twiceover'").get(),
    ).toBeUndefined();
  });

  it("refuses an expired link with INVITATION_EXPIRED", async () => {
    const created = await invite();
    sqlite
      .prepare("UPDATE invitations SET expiresAt = ? WHERE id = ?")
      .run("2020-01-01T00:00:00.000Z", created.id);

    const res = await request(app)
      .post("/api/auth/accept-invitation")
      .send({
        token: tokenFrom(created.link),
        email: "late@example.com",
        username: "latejoiner",
        password: PASSWORD,
      });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("INVITATION_EXPIRED");
  });

  it("refuses a revoked link with INVITATION_REVOKED", async () => {
    const created = await invite();
    const revoked = await as(admin)(
      request(app).delete(`/api/admin/invitations/${created.id}`),
    );
    expect(revoked.status).toBe(200);

    const res = await request(app)
      .post("/api/auth/accept-invitation")
      .send({
        token: tokenFrom(created.link),
        email: "gone@example.com",
        username: "goneaway",
        password: PASSWORD,
      });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("INVITATION_REVOKED");
  });

  it("answers one 404 for every token that is not a live invitation", async () => {
    // Three inputs that take three different paths through the service: a
    // well-formed secret nobody issued, a string of the wrong shape, and an
    // empty one. One body for all three, so the endpoint says nothing about
    // which links exist.
    const bodies: unknown[] = [];
    for (const token of [
      crypto.randomBytes(32).toString("base64url"),
      "not-a-token-at-all",
      "",
    ]) {
      const res = await request(app).post("/api/auth/accept-invitation").send({
        token,
        email: "nobody@example.com",
        username: "nobodyhere",
        password: PASSWORD,
      });
      expect(res.status).toBe(404);
      // requestId is per request by design, and the stack is dev-only noise.
      const { requestId, stack, ...rest } = res.body.error as Record<
        string,
        unknown
      >;
      void requestId;
      void stack;
      bodies.push(rest);
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });

  it("shows every status in the list", async () => {
    const res = await as(admin)(request(app).get("/api/admin/invitations"));
    const statuses = new Set(
      (res.body.invitations as { status: string }[]).map((i) => i.status),
    );
    expect([...statuses].sort()).toEqual([
      "accepted",
      "expired",
      "pending",
      "revoked",
    ]);
  });

  it("refuses to revoke one that was already accepted", async () => {
    const accepted = sqlite
      .prepare(
        "SELECT id FROM invitations WHERE acceptedAt IS NOT NULL LIMIT 1",
      )
      .get() as { id: string };
    const res = await as(admin)(
      request(app).delete(`/api/admin/invitations/${accepted.id}`),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVITATION_USED");
  });

  it("takes every invitation an admin issued with them, accepted ones too", async () => {
    // `invitations.invitedBy` is NOT NULL with ON DELETE CASCADE, so an
    // accepted invitation cannot keep its row with the inviter set to NULL
    // the way an audit row does. The plan says otherwise in two places, and
    // the schema is what decides it. The `user.invitation.accepted` audit row
    // is what survives, so how somebody joined stays on record.
    const inviter = await createAndActivate(admin, "leavinginviter", "admin");
    const created = await as(inviter)(
      request(app).post("/api/admin/invitations").send({}),
    );
    const joined = await request(app)
      .post("/api/auth/accept-invitation")
      .send({
        token: tokenFrom(created.body.link),
        email: "stayed@example.com",
        username: "stayedbehind",
        password: PASSWORD,
      });
    expect(joined.status).toBe(201);

    const gone = await as(admin)(
      request(app)
        .delete(`/api/admin/users/${inviter.id}`)
        .send({ decision: "purge" }),
    );
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);

    expect(
      sqlite
        .prepare("SELECT id FROM invitations WHERE id = ?")
        .get(created.body.id),
    ).toBeUndefined();
    // The account it produced is untouched, and the audit row still names it.
    expect(
      sqlite
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(joined.body.user.id),
    ).toBeDefined();
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM audit_log
            WHERE action = 'user.invitation.accepted' AND actorUserId = ?`,
        )
        .get(joined.body.user.id),
    ).toEqual({ n: 1 });
  });

  it("takes an admin's pending invitations with them when they go", async () => {
    const inviter = await createAndActivate(admin, "theinviter", "admin");
    const created = await as(inviter)(
      request(app)
        .post("/api/admin/invitations")
        .send({ email: "cascade@example.com" }),
    );
    expect(created.status).toBe(201);

    const gone = await as(admin)(
      request(app)
        .delete(`/api/admin/users/${inviter.id}`)
        .send({ decision: "purge" }),
    );
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(
      sqlite
        .prepare("SELECT id FROM invitations WHERE id = ?")
        .get(created.body.id),
    ).toBeUndefined();
  });
});

// =============================================================================
// 3.5 Disable and enable
// =============================================================================

describe("disabling an account", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("disableadmin");
  });

  it("ends its sessions and refuses its tokens, then gives the tokens back", async () => {
    const target = await createAndActivate(admin, "disableme");
    const secret = issueToken(target.id);

    expect(
      (await request(app).get("/api/contacts").set("Cookie", target.cookie))
        .status,
    ).toBe(200);

    const disabled = await as(admin)(
      request(app).post(`/api/admin/users/${target.id}/disable`),
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.user).toMatchObject({ status: "disabled" });

    // The live session is refused on its very next request.
    expect(
      (await request(app).get("/api/contacts").set("Cookie", target.cookie))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/contacts")
          .set("Authorization", `Bearer ${secret}`)
      ).status,
    ).toBe(401);

    // Signing in says why, rather than pretending the password is wrong.
    __resetAuthRateLimits();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ identifier: "disableme", password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_DISABLED");

    const enabled = await as(admin)(
      request(app).post(`/api/admin/users/${target.id}/enable`),
    );
    expect(enabled.status).toBe(200);
    expect(enabled.body.user).toMatchObject({ status: "active" });

    // The token comes back. The session does not, because revoking it was a
    // delete rather than a flag.
    expect(
      (
        await request(app)
          .get("/api/contacts")
          .set("Authorization", `Bearer ${secret}`)
      ).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/contacts").set("Cookie", target.cookie))
        .status,
    ).toBe(401);
  });
});

// =============================================================================
// 3.5 The guards
// =============================================================================

describe("the guards on removing an administrator", () => {
  let sole: Handle;

  beforeAll(async () => {
    sole = await freshInstance("soleadmin");
  });

  it.each([
    ["demote", "PATCH", (id: string) => `/api/admin/users/${id}`],
    ["disable", "POST", (id: string) => `/api/admin/users/${id}/disable`],
    ["delete", "DELETE", (id: string) => `/api/admin/users/${id}`],
  ])("refuses to %s the last administrator", async (action, method, url) => {
    const body =
      action === "demote"
        ? { role: "member" }
        : action === "delete"
          ? { decision: "purge" }
          : {};
    const res = await as(sole)(callRoute(method, url(sole.id)).send(body));
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });

  it("allows all three once a second admin exists", async () => {
    const second = await createAndActivate(sole, "secondadmin", "admin");

    // Aiming at yourself is refused for a different reason now that the
    // instance would still have an administrator.
    const self = await as(sole)(
      request(app).post(`/api/admin/users/${sole.id}/disable`),
    );
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe("CANNOT_TARGET_SELF");

    // Deleting yourself is refused for the same reason as disabling
    // yourself, and it is refused before the data decision is even read.
    const deleteSelf = await as(sole)(
      request(app)
        .delete(`/api/admin/users/${sole.id}`)
        .send({ decision: "purge" }),
    );
    expect(deleteSelf.status).toBe(400);
    expect(deleteSelf.body.error.code).toBe("CANNOT_TARGET_SELF");
    expect(
      sqlite.prepare("SELECT id FROM users WHERE id = ?").get(sole.id),
    ).toBeDefined();

    // The second admin may disable the first, then enable them again.
    const disabled = await as(second)(
      request(app).post(`/api/admin/users/${sole.id}/disable`),
    );
    expect(disabled.status).toBe(200);
    const enabled = await as(second)(
      request(app).post(`/api/admin/users/${sole.id}/enable`),
    );
    expect(enabled.status).toBe(200);

    // And demote them, because they are no longer the only one.
    const demoted = await as(second)(
      request(app)
        .patch(`/api/admin/users/${sole.id}`)
        .send({ role: "member" }),
    );
    expect(demoted.status).toBe(200);
    expect(demoted.body.user.role).toBe("member");

    // Which makes the second admin the last one, and the guard comes back.
    const alone = await as(second)(
      request(app)
        .patch(`/api/admin/users/${second.id}`)
        .send({ role: "member" }),
    );
    expect(alone.status).toBe(409);
    expect(alone.body.error.code).toBe("LAST_ADMIN");
  });
});

// =============================================================================
// The account that owns this device's data
// =============================================================================

describe("an instance nobody has secured", () => {
  // Authentication is off, so the caller with no credential is the local
  // owner and the local owner is an admin. That account owns every row
  // written on this device, and nobody can sign in as it, so disabling or
  // deleting it would lock the instance out of its own data with no way back.
  let localId: string;

  beforeAll(() => {
    delete process.env.AUTH_REQUIRED;
    __resetAuthWarnings();
    resetAccounts();
    sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
    localId = (
      sqlite
        .prepare("SELECT id FROM users WHERE credentialState = 'none'")
        .get() as { id: string }
    ).id;
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = "true";
    __resetAuthWarnings();
  });

  it("shows the local owner for what it is", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(200);
    const local = (res.body.users as { id: string }[]).find(
      (u) => u.id === localId,
    );
    expect(local).toMatchObject({
      username: "local",
      isLocalOwner: true,
      credentialState: "none",
      role: "admin",
      isSelf: true,
      mustChangePassword: false,
    });
  });

  it("has no password on it to reset", async () => {
    const res = await request(app).post(
      `/api/admin/users/${localId}/reset-password`,
    );
    expect(res.status).toBe(400);
  });

  it("refuses to disable it", async () => {
    const res = await request(app).post(`/api/admin/users/${localId}/disable`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LOCAL_OWNER_PROTECTED");
  });

  it("refuses to delete it", async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${localId}`)
      .send({ decision: "purge" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LOCAL_OWNER_PROTECTED");
  });
});

// =============================================================================
// 3.5 Delete with a data decision
// =============================================================================

describe("deleting an account", () => {
  let admin: Handle;
  let victim: Handle;
  let bystander: Handle;

  beforeAll(async () => {
    admin = await freshInstance("purgeadmin");
    victim = await createAndActivate(admin, "leavingsoon");
    bystander = await createAndActivate(admin, "stayingput");

    for (const owner of [victim, bystander]) {
      const contactIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const contact = await as(owner)(
          request(app)
            .post("/api/contacts")
            .send({ name: `${owner.username} Contact ${i}`, company: "Acme" }),
        );
        expect(contact.status).toBe(201);
        contactIds.push(contact.body.id);
        await as(owner)(
          request(app)
            .post(`/api/contacts/${contact.body.id}/interactions`)
            .send({ type: "note", title: `Note ${i}` }),
        );
      }
      await as(owner)(
        request(app)
          .post("/api/lists")
          .send({ name: `${owner.username} List` }),
      );
      seedOwnedExtras(owner.id, contactIds);
    }
  });

  /**
   * Rows in the tables the purge names that the API does not create on its
   * own here: a duplicate suggestion, an exclusion, a merge-log entry, an AI
   * invocation, an action item, and a locally-stored avatar. Without them the
   * purge assertions for those tables would read zero before and after and
   * would prove nothing.
   */
  function seedOwnedExtras(ownerId: string, contactIds: string[]): void {
    const [a, b, c] = contactIds;
    sqlite
      .prepare(
        `INSERT INTO dedupe_suggestions
           (id, contactIdA, contactIdB, matchType, confidence, reasoning, status)
         VALUES (?, ?, ?, 'email', 0.9, 'same address', 'pending')`,
      )
      .run(crypto.randomUUID(), a, b);
    sqlite
      .prepare(
        `INSERT INTO dedupe_exclusions (contactIdA, contactIdB) VALUES (?, ?)`,
      )
      .run(a, c);
    sqlite
      .prepare(
        `INSERT INTO dedupe_merge_log
           (id, primaryId, duplicateId, mergedBy, mergeType, confidence, reasoning, ownerId)
         VALUES (?, ?, ?, 'test', 'manual', 1.0, 'seeded', ?)`,
      )
      .run(crypto.randomUUID(), a, b, ownerId);
    sqlite
      .prepare(
        `INSERT INTO ai_invocations (id, operation, model, tokenCount, latencyMs, cached, ownerId)
         VALUES (?, 'searchExpansion', 'mock', 10, 1, 0, ?)`,
      )
      .run(crypto.randomUUID(), ownerId);
    sqlite
      .prepare(
        `INSERT INTO action_items (id, contactId, title, dueAt) VALUES (?, ?, 'Follow up', '2027-01-01')`,
      )
      .run(crypto.randomUUID(), a);
    // One avatar this instance stores itself and one interaction attachment,
    // so the `files` count is a number rather than always zero.
    sqlite
      .prepare(`UPDATE contacts SET avatarUrl = ? WHERE id = ?`)
      .run(`/uploads/u/${ownerId}/avatars/face.png`, a);
    sqlite
      .prepare(
        `UPDATE interactions SET fileUrl = ? WHERE contactId = ? AND ownerId = ?`,
      )
      .run(`/uploads/u/${ownerId}/files/note.eml`, a, ownerId);
  }

  it("seeds every table the purge names, so the counts below mean something", () => {
    for (const table of [
      "contacts",
      "interactions",
      "action_items",
      "lists",
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
    ]) {
      expect(rowsOwnedBy(table, victim.id), table).toBeGreaterThan(0);
    }
  });

  it("refuses without a decision and says what would go", async () => {
    const res = await as(admin)(
      request(app).delete(`/api/admin/users/${victim.id}`),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USER_HAS_DATA");
    expect(res.body.error.details.counts).toMatchObject({
      contacts: 3,
      interactions: 3,
      lists: 1,
      // One avatar this instance stores and one interaction attachment.
      files: 2,
    });
    // Nothing moved.
    expect(rowsOwnedBy("contacts", victim.id)).toBe(3);
  });

  it("hands the account's data over before it goes", async () => {
    const res = await as(admin)(
      request(app).get(`/api/admin/users/${victim.id}/export`),
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(
      "contrack-export-leavingsoon-",
    );
    const payload = JSON.parse(res.text);
    expect(payload.contacts).toHaveLength(3);
    expect(payload.interactions).toHaveLength(3);
    for (const contact of payload.contacts) {
      expect(contact.ownerId).toBe(victim.id);
    }
  });

  it("removes every row, every vector and the upload directory", async () => {
    // A vector, an embedding meta row and a file on disk. Those three have no
    // foreign key to follow, so nothing removes them unless the purge does.
    const contactId = (
      sqlite
        .prepare("SELECT id FROM contacts WHERE ownerId = ? LIMIT 1")
        .get(victim.id) as { id: string }
    ).id;
    sqlite
      .prepare(
        "INSERT INTO contact_embeddings (contactId, ownerId, embedding) VALUES (?, ?, ?)",
      )
      .run(contactId, victim.id, Buffer.from(new Float32Array(768).buffer));
    sqlite
      .prepare(
        `INSERT INTO dedupe_embedding_meta (contactId, embeddedAt)
         VALUES (?, CURRENT_TIMESTAMP)`,
      )
      .run(contactId);

    const avatars = ownerUploadDir(victim.id, "avatars");
    fs.mkdirSync(avatars, { recursive: true });
    fs.writeFileSync(path.join(avatars, "face.png"), "not really a png");

    expect(ftsRows(victim.id)).toBe(3);

    const res = await as(admin)(
      request(app)
        .delete(`/api/admin/users/${victim.id}`)
        .send({ decision: "purge" }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ deleted: true });
    expect(res.body.counts).toMatchObject({ contacts: 3, interactions: 3 });

    for (const table of [
      "contacts",
      "interactions",
      "action_items",
      "lists",
      "dedupe_suggestions",
      "dedupe_exclusions",
      "dedupe_merge_log",
      "ai_invocations",
    ]) {
      expect(rowsOwnedBy(table, victim.id), table).toBe(0);
    }
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM contact_embeddings WHERE ownerId = ?",
        )
        .get(victim.id),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM dedupe_embedding_meta WHERE contactId = ?",
        )
        .get(contactId),
    ).toEqual({ n: 0 });
    expect(ftsRows(victim.id)).toBe(0);
    expect(
      sqlite.prepare("SELECT id FROM users WHERE id = ?").get(victim.id),
    ).toBeUndefined();
    expect(fs.existsSync(avatars)).toBe(false);
    expect(fs.existsSync(path.join(UPLOADS_DIR, "u", victim.id))).toBe(false);
  });

  it("leaves the other account exactly as it was", () => {
    expect(rowsOwnedBy("contacts", bystander.id)).toBe(3);
    expect(rowsOwnedBy("interactions", bystander.id)).toBe(3);
    expect(rowsOwnedBy("lists", bystander.id)).toBe(1);
    expect(ftsRows(bystander.id)).toBe(3);
  });

  it("cannot lose a row by forgetting a table", () => {
    // Every `ownerId` column references `users(id)` with ON DELETE RESTRICT,
    // so the last statement of the purge is the check on every statement
    // above it: one owned row left anywhere and the delete throws and rolls
    // the transaction back. A purge that misses a table cannot half succeed.
    expect(() =>
      sqlite.prepare("DELETE FROM users WHERE id = ?").run(bystander.id),
    ).toThrow(/FOREIGN KEY/);
    expect(rowsOwnedBy("contacts", bystander.id)).toBe(3);
    expect(
      sqlite.prepare("SELECT id FROM users WHERE id = ?").get(bystander.id),
    ).toBeDefined();
  });

  it("keeps the audit trail of an account that no longer exists", () => {
    const row = sqlite
      .prepare(
        `SELECT actorUserId, details FROM audit_log
          WHERE action = 'user.deleted' AND targetId = ?`,
      )
      .get(victim.id) as { actorUserId: string; details: string };
    expect(row.actorUserId).toBe(admin.id);
    expect(JSON.parse(row.details)).toMatchObject({
      username: "leavingsoon",
      contacts: 3,
    });
  });
});

// =============================================================================
// 3.5 Purge cost
// =============================================================================

describe("the purge budget", () => {
  it(
    "removes an account of 10,000 contacts in under two seconds",
    { timeout: 180_000 },
    async () => {
      const admin = await freshInstance("benchadmin");
      const big = await createAndActivate(admin, "tenthousand");

      const insert = sqlite.prepare(
        `INSERT INTO contacts (id, name, company, ownerId) VALUES (?, ?, ?, ?)`,
      );
      const email = sqlite.prepare(
        `INSERT INTO contact_emails (id, contactId, email) VALUES (?, ?, ?)`,
      );
      sqlite.transaction(() => {
        for (let i = 0; i < 10_000; i++) {
          const id = crypto.randomUUID();
          insert.run(id, `Bulk Person ${i}`, "Acme", big.id);
          email.run(crypto.randomUUID(), id, `bulk${i}@example.com`);
        }
      })();
      expect(rowsOwnedBy("contacts", big.id)).toBe(10_000);

      const started = performance.now();
      const res = await as(admin)(
        request(app)
          .delete(`/api/admin/users/${big.id}`)
          .send({ decision: "purge" }),
      );
      const elapsed = performance.now() - started;

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.counts.contacts).toBe(10_000);
      expect(rowsOwnedBy("contacts", big.id)).toBe(0);
      expect(ftsRows(big.id)).toBe(0);

      // Printed so the number in the pull request is the number this run saw.
      console.log(
        `[purge] 10,000 contacts and 10,000 emails removed in ${elapsed.toFixed(0)}ms`,
      );
      expect(elapsed).toBeLessThan(2000);
    },
  );
});

// =============================================================================
// 3.8 The audit log
// =============================================================================

describe("the audit log", () => {
  let admin: Handle;

  beforeAll(async () => {
    admin = await freshInstance("auditadmin");
  });

  it("records one row for every action this phase names", async () => {
    const target = await createAndActivate(admin, "auditsubject");

    await as(admin)(
      request(app)
        .patch(`/api/admin/users/${target.id}`)
        .send({ role: "admin" }),
    );
    await as(admin)(
      request(app)
        .patch(`/api/admin/users/${target.id}`)
        .send({ role: "member" }),
    );
    await as(admin)(
      request(app).post(`/api/admin/users/${target.id}/reset-password`),
    );
    await as(admin)(request(app).post(`/api/admin/users/${target.id}/disable`));
    await as(admin)(request(app).post(`/api/admin/users/${target.id}/enable`));
    await as(admin)(request(app).get(`/api/admin/users/${target.id}/export`));

    const invitation = await as(admin)(
      request(app).post("/api/admin/invitations").send({}),
    );
    await as(admin)(
      request(app).delete(`/api/admin/invitations/${invitation.body.id}`),
    );
    await as(admin)(
      request(app).put("/api/auth/session-policy").send({ sessionTtlDays: 14 }),
    );
    await as(admin)(request(app).post("/api/backups"));

    // A sign-in that works, one that does not, and a sign-out.
    __resetAuthRateLimits();
    await request(app)
      .post("/api/auth/login")
      .send({ identifier: "auditadmin", password: "not the password" });
    const cookie = await signIn("auditadmin", PASSWORD);
    await request(app).post("/api/auth/logout").set("Cookie", cookie);

    await as(admin)(
      request(app)
        .delete(`/api/admin/users/${target.id}`)
        .send({ decision: "purge" }),
    );

    const actions = new Set(
      (
        sqlite.prepare("SELECT DISTINCT action FROM audit_log").all() as {
          action: string;
        }[]
      ).map((r) => r.action),
    );
    for (const action of [
      "auth.login.success",
      "auth.login.failed",
      "auth.logout",
      "auth.password.changed",
      "user.created",
      "user.invited",
      "user.invitation.revoked",
      "user.role.changed",
      "user.disabled",
      "user.enabled",
      "user.password.reset",
      "user.deleted",
      "user.exported",
      "settings.changed",
      "backup.created",
    ]) {
      expect(actions, action).toContain(action);
    }
  });

  it("records an accepted invitation against the account it made", async () => {
    const created = await as(admin)(
      request(app).post("/api/admin/invitations").send({}),
    );
    const token = new URL(created.body.link).searchParams.get("token")!;
    const joined = await request(app).post("/api/auth/accept-invitation").send({
      token,
      email: "audited@example.com",
      username: "auditedjoiner",
      password: PASSWORD,
    });
    expect(joined.status).toBe(201);

    const row = sqlite
      .prepare(
        `SELECT actorUserId FROM audit_log
          WHERE action = 'user.invitation.accepted' AND targetId = ?`,
      )
      .get(created.body.id) as { actorUserId: string };
    expect(row.actorUserId).toBe(joined.body.user.id);
  });

  it("records an AI settings write by key name and never by value", async () => {
    const res = await as(admin)(
      request(app)
        .put("/api/settings/ai/searxng")
        .send({ url: "https://searx.example.com" }),
    );
    expect(res.status).toBe(200);

    const row = sqlite
      .prepare(
        `SELECT actorUserId, targetType, targetId, details FROM audit_log
          WHERE action = 'settings.changed' AND targetId = 'ai.searxng'`,
      )
      .get() as {
      actorUserId: string;
      targetType: string;
      targetId: string;
      details: string | null;
    };
    expect(row.actorUserId).toBe(admin.id);
    expect(row.targetType).toBe("setting");
    // The key is recorded. What was written to it is not.
    expect(row.details).toBeNull();
  });

  it("pages newest first without skipping or repeating a row", async () => {
    const first = await as(admin)(request(app).get("/api/admin/audit?limit=5"));
    expect(first.status).toBe(200);
    expect(first.body.entries).toHaveLength(5);
    expect(first.body.nextBefore).toBeTruthy();

    type Entry = { id: string; createdAt: string };
    const walked: Entry[] = [...(first.body.entries as Entry[])];
    let cursor: string | null = first.body.nextBefore;
    while (cursor) {
      const page: request.Response = await as(admin)(
        request(app).get(
          `/api/admin/audit?limit=5&before=${encodeURIComponent(cursor)}`,
        ),
      );
      expect(page.status).toBe(200);
      walked.push(...(page.body.entries as Entry[]));
      cursor = page.body.nextBefore;
    }
    const seen = walked.map((e) => e.id);

    // Newest first, across pages as well as inside one. Counting rows and
    // checking for duplicates says nothing about direction, and an audit log
    // that pages oldest first is unreadable.
    for (let i = 1; i < walked.length; i++) {
      expect(
        walked[i - 1].createdAt >= walked[i].createdAt,
        `${walked[i - 1].createdAt} before ${walked[i].createdAt}`,
      ).toBe(true);
    }
    const newest = (
      sqlite
        .prepare(
          "SELECT createdAt FROM audit_log ORDER BY createdAt DESC, id DESC LIMIT 1",
        )
        .get() as { createdAt: string }
    ).createdAt;
    expect(walked[0].createdAt).toBe(newest);

    const total = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as {
        n: number;
      }
    ).n;
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });

  it("names the actor, and keeps a row whose actor is gone", async () => {
    const res = await as(admin)(request(app).get("/api/admin/audit?limit=200"));
    const created = (
      res.body.entries as {
        action: string;
        actor: { username: string } | null;
      }[]
    ).find((e) => e.action === "user.created");
    expect(created?.actor?.username).toBe("auditadmin");

    // The purged account's own rows survive it, with no actor to name.
    const orphaned = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_log
          WHERE actorUserId IS NULL AND action = 'auth.password.changed'`,
      )
      .get() as { n: number };
    expect(orphaned.n).toBeGreaterThan(0);
  });

  it("holds no password, no token and no invitation secret", async () => {
    const res = await as(admin)(request(app).get("/api/admin/audit?limit=200"));
    const rendered = JSON.stringify(res.body);
    expect(rendered).not.toContain("ctk_");
    expect(rendered).not.toContain(PASSWORD);
    expect(rendered).not.toContain("/join?token=");

    // And the same for the table the endpoint pages over.
    const stored = (
      sqlite.prepare("SELECT details FROM audit_log").all() as {
        details: string | null;
      }[]
    )
      .map((r) => r.details ?? "")
      .join(" ");
    expect(stored).not.toContain("ctk_");
    expect(stored).not.toContain(PASSWORD);
    // A temporary password is twenty letters and digits. Nothing that long
    // and that shaped belongs in this table.
    expect(stored).not.toMatch(/[A-Za-z0-9]{20}/);
  });

  it("redacts a credential-shaped field a call site tries to record", () => {
    // Reaching past the typed call sites on purpose: the guard has to hold for
    // a call site nobody has written yet.
    auditService.record({
      actorUserId: null,
      action: "settings.changed",
      details: { apiKey: "sk-live-secret", note: `ctk_${"a".repeat(43)}` },
    });
    const row = sqlite
      .prepare("SELECT details FROM audit_log ORDER BY rowid DESC LIMIT 1")
      .get() as { details: string };
    expect(JSON.parse(row.details)).toEqual({
      apiKey: "[redacted]",
      note: "[redacted]",
    });
  });
});

// Integration: single sign-on with an OIDC provider
// Sign-in, linking from settings and unlinking, against the fake provider in
// ./oidcProvider.ts. Every flow is bound to the browser that started it by the
// `contrack_oidc` cookie, so each callback here carries the cookie the start
// or link response set.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { cookieFrom, resetAccounts } from "./tenancy/helpers.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import { log } from "../../server/utils/logger.ts";
import { setOidcConfig } from "../../server/services/integrationSettings.ts";
import { forgetOidcDiscovery } from "../../server/services/oidcService.ts";
import { createUser } from "../../server/services/authService.ts";
import * as identityService from "../../server/services/identityService.ts";
const { linkIdentity } = identityService;
import {
  startFakeProvider,
  USERINFO_FAILURE,
  type FakeLogin,
} from "./oidcProvider.ts";

const app = makeTestApp();
const PASSWORD = "correct horse battery staple";
const ORIGIN = "https://crm.example.com";
let idp: Awaited<ReturnType<typeof startFakeProvider>>;

beforeAll(async () => {
  idp = await startFakeProvider();
});
afterAll(() => idp.close());

async function setup(matchByEmail = true) {
  resetAccounts();
  sqlite.exec(
    "DELETE FROM audit_log; DELETE FROM sessions; DELETE FROM auth_challenges;",
  );
  __resetAuthRateLimits();
  clearSettingsCache();
  process.env.PUBLIC_URL = ORIGIN;
  const admin = await request(app).post("/api/auth/setup").send({
    email: "admin@example.com",
    username: "adminuser",
    password: PASSWORD,
  });
  expect(admin.status).toBe(201);
  forgetOidcDiscovery();
  setOidcConfig({
    issuer: idp.issuer,
    clientId: "contrack",
    clientSecret: "secret",
    name: "Test IdP",
    matchByEmail,
  });
  const ada = await createUser({
    email: "ada@example.com",
    username: "ada",
    password: PASSWORD,
    role: "member",
  });
  return { adminCookie: cookieFrom(admin), adminId: admin.body.user.id, ada };
}

/** The `contrack_oidc` cookie a response set, as a request sends it. */
function flowCookie(res: request.Response): string {
  const set = cookieFrom(res).find((c) => c.startsWith("contrack_oidc="));
  expect(set).toBeDefined();
  return set!.split(";")[0];
}

function sessionsOf(userId: string): number {
  return (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE userId = ?")
      .get(userId) as { n: number }
  ).n;
}

/** Sessions an OIDC sign-in made. The admin's setup session is not one. */
const oidcSessions = () =>
  (
    sqlite
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE method = 'oidc'")
      .get() as { n: number }
  ).n;

/** Start a sign-in as a browser would: the state and the flow cookie. */
async function startSignIn(query = "") {
  const start = await request(app).get(`/api/auth/oidc/start${query}`);
  expect(start.status).toBe(302);
  const { state } = idp.remember(start.headers.location);
  return { state, cookie: flowCookie(start) };
}

/** Run the browser's part: start, let the IdP "sign in", hit the callback. */
async function signIn(login: FakeLogin, query = "") {
  const { state, cookie } = await startSignIn(query);
  idp.nextLogin(login);
  return request(app)
    .get(`/api/auth/oidc/callback?code=c&state=${state}`)
    .set("Cookie", cookie);
}

async function passwordLogin(identifier: string): Promise<string[]> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return cookieFrom(res).map((c) => c.split(";")[0]);
}

describe("API: OIDC sign-in", () => {
  beforeEach(() => setup());

  it("reports the provider on /status while sign-in is on", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.body.oidc).toEqual({ name: "Test IdP" });
  });

  it("reports no provider when none is set up, or sign-in is off", async () => {
    setOidcConfig(null);
    expect((await request(app).get("/api/auth/status")).body.oidc).toBeNull();
    await setup();
    __resetAuthWarnings();
    expect((await request(app).get("/api/auth/status")).body.oidc).toBeNull();
  });

  it("sets an HttpOnly flow cookie scoped to the OIDC routes", async () => {
    const start = await request(app).get("/api/auth/oidc/start");
    const set = cookieFrom(start).find((c) => c.startsWith("contrack_oidc="))!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/api/auth/oidc");
    expect(set).toContain("Max-Age=600");
  });

  it("signs a linked identity in", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const res = await signIn({ sub: "sub-ada" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(cookieFrom(res).some((c) => c.startsWith("contrack_session="))).toBe(
      true,
    );
    // The flow cookie is cleared.
    expect(cookieFrom(res)).toContainEqual(
      expect.stringMatching(/^contrack_oidc=;.*Max-Age=0/),
    );
    const method = sqlite
      .prepare("SELECT method FROM sessions WHERE userId = ?")
      .get(ada.id) as { method: string };
    expect(method.method).toBe("oidc");
    const audit = sqlite
      .prepare(
        "SELECT details FROM audit_log WHERE action = 'auth.login.success' AND actorUserId = ?",
      )
      .get(ada.id) as { details: string };
    expect(JSON.parse(audit.details).method).toBe("oidc");
  });

  it("matches a verified email and links it", async () => {
    const { ada } = await setup();
    const res = await signIn({
      sub: "sub-new",
      email: "ADA@example.com",
      email_verified: true,
    });
    expect(res.headers.location).toBe("/");
    expect(sessionsOf(ada.id)).toBe(1);
    const row = sqlite
      .prepare("SELECT userId FROM user_identities WHERE subject = 'sub-new'")
      .get() as { userId: string };
    expect(row.userId).toBe(ada.id);
  });

  it("does not move an existing link to another provider account by email", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-old", "ada@example.com");
    const res = await signIn({
      sub: "sub-new",
      email: "ada@example.com",
      email_verified: true,
    });
    expect(res.headers.location).toBe("/?oidc=no-account");
    expect(sessionsOf(ada.id)).toBe(0);
    expect(
      sqlite
        .prepare("SELECT subject FROM user_identities WHERE userId = ?")
        .all(ada.id),
    ).toEqual([{ subject: "sub-old" }]);
  });

  it("refuses an unverified email", async () => {
    const res = await signIn({
      sub: "sub-new",
      email: "ada@example.com",
      email_verified: false,
    });
    expect(res.headers.location).toBe("/?oidc=no-account");
    expect(cookieFrom(res).some((c) => c.startsWith("contrack_session="))).toBe(
      false,
    );
    expect(oidcSessions()).toBe(0);
  });

  it("refuses email matching when the admin turned it off", async () => {
    await setup(false);
    const res = await signIn({
      sub: "sub-new",
      email: "ada@example.com",
      email_verified: true,
    });
    expect(res.headers.location).toBe("/?oidc=no-account");
    expect(oidcSessions()).toBe(0);
  });

  it("refuses a disabled account", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    sqlite
      .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
      .run(ada.id);
    const res = await signIn({ sub: "sub-ada" });
    expect(res.headers.location).toBe("/?oidc=disabled");
    expect(sessionsOf(ada.id)).toBe(0);
  });

  it("refuses a callback without the flow cookie, and leaves the flow alive", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const { state, cookie } = await startSignIn();
    idp.nextLogin({ sub: "sub-ada" });
    const res = await request(app).get(
      `/api/auth/oidc/callback?code=c&state=${state}`,
    );
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(oidcSessions()).toBe(0);
    // The refused callback did not consume the state: the real browser's works.
    const real = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", cookie);
    expect(real.headers.location).toBe("/");
    expect(sessionsOf(ada.id)).toBe(1);
  });

  it("refuses a callback whose flow cookie holds another state", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const victim = await startSignIn();
    const attacker = await startSignIn();
    idp.nextLogin({ sub: "sub-ada" });
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${attacker.state}`)
      .set("Cookie", victim.cookie);
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(oidcSessions()).toBe(0);
    expect(cookieFrom(res)).toContainEqual(
      expect.stringMatching(/^contrack_oidc=;/),
    );
  });

  it("answers failed for a state used once already", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const { state, cookie } = await startSignIn();
    idp.nextLogin({ sub: "sub-ada" });
    const url = `/api/auth/oidc/callback?code=c&state=${state}`;
    await request(app).get(url).set("Cookie", cookie);
    const replay = await request(app).get(url).set("Cookie", cookie);
    expect(replay.headers.location).toBe("/?oidc=failed");
  });

  it("answers expired for a flow past its ten minutes", async () => {
    const { state, cookie } = await startSignIn();
    sqlite
      .prepare("UPDATE auth_challenges SET expiresAt = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), state);
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/?oidc=expired");
  });

  it("answers denied when the provider refused, and uses up the flow", async () => {
    const { state, cookie } = await startSignIn();
    const res = await request(app)
      .get(`/api/auth/oidc/callback?error=access_denied&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/?oidc=denied");
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM auth_challenges").get(),
    ).toEqual({ n: 0 });
  });

  it("answers failed for a used state, even with a provider error", async () => {
    const { state, cookie } = await startSignIn();
    sqlite.prepare("DELETE FROM auth_challenges WHERE id = ?").run(state);
    const res = await request(app)
      .get(`/api/auth/oidc/callback?error=access_denied&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/?oidc=failed");
  });

  it("sends the token request the redirect URI the start sent", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    await signIn({ sub: "sub-ada" });
    expect(idp.tokenRedirectUri()).toBe(`${ORIGIN}/api/auth/oidc/callback`);
  });

  it("records lastLoginAt", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    await signIn({ sub: "sub-ada" });
    const row = sqlite
      .prepare("SELECT lastLoginAt FROM users WHERE id = ?")
      .get(ada.id) as { lastLoginAt: string | null };
    expect(row.lastLoginAt).not.toBeNull();
  });

  it("signs a linked account in when userinfo fails, and logs no provider body", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    idp.failNextUserinfo();
    const warn = vi.spyOn(log, "warn");
    try {
      // The ID token carries no email, so the server asks userinfo.
      const res = await signIn({
        sub: "sub-ada",
        userinfo: { email: "ada@example.com", email_verified: true },
      });
      expect(res.headers.location).toBe("/");
      expect(sessionsOf(ada.id)).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        "Auth",
        "OIDC userinfo failed, so the sign-in has no email",
        { error: expect.any(String) },
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(USERINFO_FAILURE);
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps the session to this browser when keep me signed in is off", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const session = (res: request.Response) =>
      cookieFrom(res).find((c) => c.startsWith("contrack_session="))!;
    const remembered = await signIn({ sub: "sub-ada" });
    expect(session(remembered)).toMatch(/Max-Age=\d+/);
    const once = await signIn({ sub: "sub-ada" }, "?remember=0");
    expect(session(once)).toBeDefined();
    expect(session(once)).not.toMatch(/Max-Age/);
    const expiries = sqlite
      .prepare(
        "SELECT expiresAt FROM sessions WHERE userId = ? ORDER BY expiresAt",
      )
      .all(ada.id) as { expiresAt: string }[];
    expect(
      new Date(expiries[0].expiresAt).getTime() - Date.now(),
    ).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("lands a sign-in on the path it started from, and only on this site", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const landing = async (returnTo: string) =>
      (
        await signIn(
          { sub: "sub-ada" },
          `?returnTo=${encodeURIComponent(returnTo)}`,
        )
      ).headers.location;
    expect(await landing("/contacts/abc?x=1")).toBe("/contacts/abc?x=1");
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "/contacts\r\nSet-Cookie: x=1",
    ]) {
      expect(await landing(bad), bad).toBe("/");
    }
    // A failure still lands on the sign-in page.
    const failed = await signIn({ sub: "sub-nobody" }, "?returnTo=%2Fcontacts");
    expect(failed.headers.location).toBe("/?oidc=no-account");
  });

  it("refuses an account that must change its password, before any write", async () => {
    const { ada } = await setup();
    sqlite
      .prepare("UPDATE users SET mustChangePassword = 1 WHERE id = ?")
      .run(ada.id);
    const res = await signIn({
      sub: "sub-new",
      email: "ada@example.com",
      email_verified: true,
    });
    expect(res.headers.location).toBe("/?oidc=must-change-password");
    expect(sessionsOf(ada.id)).toBe(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM user_identities").get(),
    ).toEqual({ n: 0 });
    const audit = sqlite
      .prepare(
        "SELECT details FROM audit_log WHERE action = 'auth.login.failed' AND actorUserId = ?",
      )
      .get(ada.id) as { details: string };
    expect(JSON.parse(audit.details)).toMatchObject({
      method: "oidc",
      reason: "must-change-password",
    });
  });

  it("limits starts on their own, and leaves the callback and password sign-in alone", async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await request(app).get("/api/auth/oidc/start");
      expect(ok.headers.location).toMatch(/\/authorize\?/);
    }
    const refused = await request(app).get("/api/auth/oidc/start");
    expect(refused.status).toBe(302);
    expect(refused.headers.location).toBe("/?oidc=failed");
    // Callbacks are not counted against anything.
    for (let i = 0; i < 12; i++) {
      const cb = await request(app).get(
        "/api/auth/oidc/callback?code=c&state=x",
      );
      expect(cb.headers.location).toBe("/?oidc=failed");
    }
    await passwordLogin("ada");
  });
});

describe("API: linking OIDC from settings", () => {
  it("links the signed-in account, lists it, and unlinks it", async () => {
    const { ada, adminId } = await setup();
    linkIdentity(adminId, idp.issuer, "sub-admin", null);
    const cookie = await passwordLogin("ada");

    expect((await request(app).post("/api/auth/oidc/link")).status).toBe(401);
    const link = await request(app)
      .post("/api/auth/oidc/link")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(link.status).toBe(200);
    const { state } = idp.remember(link.body.url);
    idp.nextLogin({ sub: "sub-ada", email: "ada@idp.example" });
    const done = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", [...cookie, flowCookie(link)]);
    expect(done.headers.location).toBe(
      "/settings/account?oidc=linked#password",
    );

    const list = await request(app)
      .get("/api/auth/identities")
      .set("Cookie", cookie);
    expect(list.body.identities).toHaveLength(1);
    expect(typeof list.body.matchByEmail).toBe("boolean");
    expect(list.body.identities[0].email).toBe("ada@idp.example");
    const del = await request(app)
      .delete(`/api/auth/identities/${list.body.identities[0].id}`)
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(del.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM user_identities WHERE userId = ?")
        .get(ada.id),
    ).toEqual({ n: 0 });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.oidc.unlinked' AND actorUserId = ?",
        )
        .get(ada.id),
    ).toEqual({ n: 1 });
  });

  it("will not unlink another account's identity", async () => {
    const { adminId } = await setup();
    const theirs = linkIdentity(adminId, idp.issuer, "sub-admin", null);
    const cookie = await passwordLogin("ada");
    const del = await request(app)
      .delete(`/api/auth/identities/${theirs.id}`)
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(del.status).toBe(404);
  });

  it("refuses a link callback opened by another account", async () => {
    const { adminCookie } = await setup();
    const cookie = await passwordLogin("ada");
    const link = await request(app)
      .post("/api/auth/oidc/link")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    const { state } = idp.remember(link.body.url);
    idp.nextLogin({ sub: "sub-x" });
    const done = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", [
        ...adminCookie.map((c) => c.split(";")[0]),
        flowCookie(link),
      ]);
    expect(done.headers.location).toBe(
      "/settings/account?oidc=failed#password",
    );
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM user_identities").get(),
    ).toEqual({ n: 0 });
  });

  it("refuses to link an identity another account holds", async () => {
    const { adminId } = await setup();
    linkIdentity(adminId, idp.issuer, "sub-x", null);
    const cookie = await passwordLogin("ada");
    const link = await request(app)
      .post("/api/auth/oidc/link")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    const { state } = idp.remember(link.body.url);
    idp.nextLogin({ sub: "sub-x" });
    const done = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", [...cookie, flowCookie(link)]);
    expect(done.headers.location).toBe("/settings/account?oidc=taken#password");
    expect(
      sqlite
        .prepare("SELECT userId FROM user_identities WHERE subject = 'sub-x'")
        .get(),
    ).toEqual({ userId: adminId });
  });
});

describe("API: OIDC link flow landings", () => {
  async function startLink() {
    await setup();
    const cookie = await passwordLogin("ada");
    const link = await request(app)
      .post("/api/auth/oidc/link")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(link.status).toBe(200);
    const { state } = idp.remember(link.body.url);
    return { state, cookie: [...cookie, flowCookie(link)] };
  }

  it("lands a denied link on Account settings", async () => {
    const { state, cookie } = await startLink();
    const res = await request(app)
      .get(`/api/auth/oidc/callback?error=access_denied&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/settings/account?oidc=denied#password");
  });

  it("lands an expired link on Account settings", async () => {
    const { state, cookie } = await startLink();
    sqlite
      .prepare("UPDATE auth_challenges SET expiresAt = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), state);
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe(
      "/settings/account?oidc=expired#password",
    );
  });

  it("lands a link whose code exchange fails on Account settings", async () => {
    const { state, cookie } = await startLink();
    // Nothing queued: the provider answers 400 invalid_grant.
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/settings/account?oidc=failed#password");
  });

  it("marks the identity at the current provider", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, `${idp.issuer}/`, "sub-ada", null);
    linkIdentity(ada.id, "https://old.example.com", "sub-old", null);
    const cookie = await passwordLogin("ada");
    const list = await request(app)
      .get("/api/auth/identities")
      .set("Cookie", cookie);
    const byIssuer = Object.fromEntries(
      list.body.identities.map((i: { issuer: string; current: boolean }) => [
        i.issuer,
        i.current,
      ]),
    );
    expect(byIssuer).toEqual({
      [`${idp.issuer}/`]: true,
      "https://old.example.com": false,
    });
  });

  it("marks the identity current when the admin saved the discovery URL as the issuer", async () => {
    const { adminCookie } = await setup();
    const cookie = adminCookie.map((c) => c.split(";")[0]);
    const discoveryUrl = `${idp.issuer}/.well-known/openid-configuration`;
    // No secret: the discovery URL names the saved provider, so it stays.
    const saved = await request(app)
      .put("/api/admin/integrations")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({
        oidc: {
          issuer: discoveryUrl,
          clientId: "contrack",
          name: "Test IdP",
          matchByEmail: false,
        },
      });
    expect(saved.status).toBe(200);
    expect(saved.body.oidc.issuer).toBe(discoveryUrl);

    const link = await request(app)
      .post("/api/auth/oidc/link")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    const { state } = idp.remember(link.body.url);
    idp.nextLogin({ sub: "sub-admin" });
    const done = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", [...cookie, flowCookie(link)]);
    expect(done.headers.location).toBe(
      "/settings/account?oidc=linked#password",
    );
    const list = await request(app)
      .get("/api/auth/identities")
      .set("Cookie", cookie);
    expect(list.body.identities).toMatchObject([
      { issuer: idp.issuer, current: true },
    ]);
  });
});

describe("API: OIDC failures on browser routes", () => {
  beforeEach(() => setup());

  it("sends a start that cannot reach the provider back to sign-in", async () => {
    setOidcConfig({
      issuer: "http://127.0.0.1:9",
      clientId: "contrack",
      clientSecret: "secret",
      name: "Test IdP",
      matchByEmail: true,
    });
    forgetOidcDiscovery();
    const res = await request(app).get("/api/auth/oidc/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(cookieFrom(res).some((c) => /^contrack_oidc=[^;]/.test(c))).toBe(
      false,
    );
  });

  it("gives up on a token answer that never ends after ten seconds", async () => {
    const { state, cookie } = await startSignIn();
    idp.stallNextToken();
    const started = Date.now();
    const res = await request(app)
      .get(`/api/auth/oidc/callback?code=c&state=${state}`)
      .set("Cookie", cookie);
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(Date.now() - started).toBeLessThan(11_000);
  }, 15_000);

  it("logs the OAuth error when the token endpoint refuses the code", async () => {
    const warn = vi.spyOn(log, "warn");
    try {
      const { state, cookie } = await startSignIn();
      // Nothing queued: the provider answers 400 invalid_grant.
      const res = await request(app)
        .get(`/api/auth/oidc/callback?code=c&state=${state}`)
        .set("Cookie", cookie);
      expect(res.headers.location).toBe("/?oidc=failed");
      expect(warn).toHaveBeenCalledWith(
        "Auth",
        "OIDC sign-in did not finish",
        expect.objectContaining({ oauthError: "invalid_grant" }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("sends a start with no provider back to sign-in", async () => {
    setOidcConfig(null);
    const res = await request(app).get("/api/auth/oidc/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/?oidc=failed");
  });

  it("sends a callback that throws after the provider answered back to sign-in", async () => {
    const { ada } = await setup();
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const spy = vi
      .spyOn(identityService, "touchIdentity")
      .mockImplementationOnce(() => {
        throw new Error("boom");
      });
    try {
      const res = await signIn({ sub: "sub-ada" });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/?oidc=failed");
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM sessions WHERE userId = ?")
          .get(ada.id),
      ).toEqual({ n: 0 });
    } finally {
      spy.mockRestore();
    }
  });

  it("leaves no link and no session when an email sign-in fails part way", async () => {
    const { ada } = await setup();
    const auditRows = () =>
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get();
    const auditBefore = auditRows();
    const spy = vi
      .spyOn(identityService, "touchIdentity")
      .mockImplementationOnce(() => {
        throw new Error("boom");
      });
    try {
      const res = await signIn({
        sub: "sub-new",
        email: "ada@example.com",
        email_verified: true,
      });
      expect(res.headers.location).toBe("/?oidc=failed");
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM user_identities WHERE userId = ?")
          .get(ada.id),
      ).toEqual({ n: 0 });
      expect(
        sqlite
          .prepare("SELECT COUNT(*) AS n FROM sessions WHERE userId = ?")
          .get(ada.id),
      ).toEqual({ n: 0 });
      // The auth.oidc.linked row rolled back with the link.
      expect(auditRows()).toEqual(auditBefore);
    } finally {
      spy.mockRestore();
    }
  });
});

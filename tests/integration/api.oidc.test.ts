// Integration: single sign-on with an OIDC provider
// Sign-in, linking from settings and unlinking, against the fake provider in
// ./oidcProvider.ts. Every flow is bound to the browser that started it by its
// own `contrack_oidc_<id>` cookie, which holds a secret, so each callback here
// carries the cookie the start or link response set.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
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
import {
  setOidcConfig,
  type OidcConfigInput,
} from "../../server/services/integrationSettings.ts";
import { forgetOidcDiscovery } from "../../server/services/oidcService.ts";
import { createUser } from "../../server/services/authService.ts";
import { createAuthLink } from "../../server/services/authLinkService.ts";
import * as identityService from "../../server/services/identityService.ts";
const { linkIdentity, listIdentities } = identityService;
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
afterEach(() => vi.restoreAllMocks());

/** Set-Cookie lines as a browser sends them back. */
const pairs = (setCookie: string[]) => setCookie.map((c) => c.split(";")[0]);

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
    emailTrusted: true,
  });
  return {
    adminCookie: pairs(cookieFrom(admin)),
    adminId: admin.body.user.id as string,
    ada,
  };
}

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

/** The rows `COUNT(*) FROM <from>` counts. */
const count = (from: string, ...args: unknown[]) =>
  (
    sqlite.prepare(`SELECT COUNT(*) AS n FROM ${from}`).get(...args) as {
      n: number;
    }
  ).n;

/** The details of the first audit row that matches. */
const auditDetails = (where: string, ...args: unknown[]) =>
  JSON.parse(
    (
      sqlite
        .prepare(`SELECT details FROM audit_log WHERE ${where}`)
        .get(...args) as { details: string }
    ).details,
  );

const sessionsOf = (userId: string) =>
  count("sessions WHERE userId = ?", userId);

/** Sessions an OIDC sign-in made. The admin's setup session is not one. */
const oidcSessions = () => count("sessions WHERE method = 'oidc'");

/** The flow cookie a response set, as a request sends it. */
function flowCookie(res: request.Response): string {
  const set = cookieFrom(res).find((c) => c.startsWith("contrack_oidc_"));
  expect(set).toBeDefined();
  return set!.split(";")[0];
}

/**
 * The flow cookie a browser still sends `seconds` after `res` set it: none
 * once its Max-Age has run out.
 */
function flowCookieAfter(res: request.Response, seconds: number): string[] {
  const set = cookieFrom(res).find((c) => c.startsWith("contrack_oidc_"))!;
  const maxAge = Number(/Max-Age=(\d+)/.exec(set)?.[1]);
  return maxAge > seconds ? [set.split(";")[0]] : [];
}

/** The browser coming back from the provider with this query. */
function callback(query: string, cookie?: string | string[]) {
  const req = request(app).get(`/api/auth/oidc/callback?${query}`);
  return cookie ? req.set("Cookie", [cookie].flat()) : req;
}

/** Where a link flow lands on Account settings. */
const linkLanding = (outcome: string) =>
  `/settings/account?oidc=${outcome}#password`;

/** Start a sign-in as a browser would: the state and the flow cookie. */
async function startSignIn(query = "") {
  const start = await request(app).get(`/api/auth/oidc/start${query}`);
  expect(start.status).toBe(302);
  const { state } = idp.remember(start.headers.location);
  return { state, cookie: flowCookie(start), start };
}

/** Run the browser's part: start, let the IdP "sign in", hit the callback. */
async function signIn(login: FakeLogin, query = "") {
  const { state, cookie } = await startSignIn(query);
  idp.nextLogin(login);
  return callback(`code=c&state=${state}`, cookie);
}

/** Start linking the account `session` signs in, as Account settings does. */
async function startLink(session: string[]) {
  const link = await request(app)
    .post("/api/auth/oidc/link")
    .set("Cookie", session)
    .set("Origin", ORIGIN);
  expect(link.status).toBe(200);
  const { state } = idp.remember(link.body.url);
  const flow = flowCookie(link);
  return { state, flow, cookie: [...session, flow], link };
}

async function passwordLogin(identifier: string): Promise<string[]> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return pairs(cookieFrom(res));
}

const asAdmin = (req: request.Test) =>
  req.set("Cookie", ctx.adminCookie).set("Origin", ORIGIN);

describe("API: OIDC sign-in", () => {
  it("reports the provider on /status only while sign-in is on and one is set up", async () => {
    const status = async () =>
      (await request(app).get("/api/auth/status")).body.oidc;
    expect(await status()).toEqual({ name: "Test IdP" });
    setOidcConfig(null);
    expect(await status()).toBeNull();
    await setup();
    __resetAuthWarnings();
    expect(await status()).toBeNull();
  });

  it("signs a linked identity in with a flow cookie that outlives the flow, and keeps the provider's current email", async () => {
    const { ada } = ctx;
    linkIdentity(ada.id, idp.issuer, "sub-ada", "old@idp.example");
    const { state, cookie, start } = await startSignIn();
    const set = cookieFrom(start).find((c) => c.startsWith("contrack_oidc_"))!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/api/auth/oidc");
    const { expiresAt } = sqlite
      .prepare("SELECT expiresAt FROM auth_challenges WHERE kind = 'oidc'")
      .get() as { expiresAt: string };
    // Whole seconds, so a cookie that ends with the flow does not pass.
    const flowSeconds = Math.ceil(
      (new Date(expiresAt).getTime() - Date.now()) / 1000,
    );
    expect(Number(/Max-Age=(\d+)/.exec(set)![1])).toBeGreaterThan(flowSeconds);

    idp.nextLogin({ sub: "sub-ada", email: "ada@idp.example" });
    const res = await callback(`code=c&state=${state}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(cookieFrom(res).some((c) => c.startsWith("contrack_session="))).toBe(
      true,
    );
    // The flow cookie is cleared.
    expect(cookieFrom(res)).toContainEqual(
      expect.stringMatching(/^contrack_oidc_[0-9a-f]{12}=;.*Max-Age=0/),
    );
    // The token request names the redirect URI the start sent.
    expect(idp.tokenRedirectUri()).toBe(`${ORIGIN}/api/auth/oidc/callback`);
    expect(listIdentities(ada.id)).toMatchObject([
      { email: "ada@idp.example" },
    ]);
    expect(
      sqlite
        .prepare("SELECT method FROM sessions WHERE userId = ?")
        .get(ada.id),
    ).toEqual({ method: "oidc" });
    const { lastLoginAt } = sqlite
      .prepare("SELECT lastLoginAt FROM users WHERE id = ?")
      .get(ada.id) as { lastLoginAt: string | null };
    expect(lastLoginAt).not.toBeNull();
    expect(
      auditDetails("action = 'auth.login.success' AND actorUserId = ?", ada.id)
        .method,
    ).toBe("oidc");
  });

  it("matches a verified email in any case to the account setup made, and links it", async () => {
    const res = await signIn({
      sub: "sub-new",
      email: "ADMIN@example.com",
      email_verified: true,
    });
    expect(res.headers.location).toBe("/");
    expect(oidcSessions()).toBe(1);
    expect(
      sqlite
        .prepare("SELECT userId FROM user_identities WHERE subject = 'sub-new'")
        .get(),
    ).toEqual({ userId: ctx.adminId });
  });

  it("does not move an existing link to another provider account by email", async () => {
    const { ada } = ctx;
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

  it.each([
    ["an unverified email", true, false],
    ["email matching that the admin turned off", false, true],
  ])("refuses %s", async (_case, matchByEmail, emailVerified) => {
    await setup(matchByEmail);
    const res = await signIn({
      sub: "sub-new",
      email: "ada@example.com",
      email_verified: emailVerified,
    });
    expect(res.headers.location).toBe("/?oidc=no-account");
    expect(cookieFrom(res).some((c) => c.startsWith("contrack_session="))).toBe(
      false,
    );
    expect(oidcSessions()).toBe(0);
  });

  it.each([
    ["disabled", "status = 'disabled'"],
    ["must-change-password", "mustChangePassword = 1"],
  ])(
    "refuses a %s account before anything is written",
    async (reason, change) => {
      const { ada } = ctx;
      sqlite.prepare(`UPDATE users SET ${change} WHERE id = ?`).run(ada.id);
      const res = await signIn({
        sub: "sub-new",
        email: "ada@example.com",
        email_verified: true,
      });
      expect(res.headers.location).toBe(`/?oidc=${reason}`);
      expect(sessionsOf(ada.id)).toBe(0);
      expect(count("user_identities")).toBe(0);
      expect(
        auditDetails(
          "action = 'auth.login.failed' AND actorUserId = ?",
          ada.id,
        ),
      ).toMatchObject({ method: "oidc", reason });
    },
  );

  it("finishes a flow once, and only in the browser that holds its flow cookie", async () => {
    const { ada } = ctx;
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const other = await startSignIn();
    const { state, cookie } = await startSignIn();
    idp.nextLogin({ sub: "sub-ada" });
    const url = `code=c&state=${state}`;
    // Somebody holds the callback URL, and so the state the cookie's name
    // comes from, but not the secret in this browser's cookie.
    for (const [wrong, sent] of [
      ["no flow cookie", undefined],
      ["a cookie made from the state", `${cookie.split("=")[0]}=${state}`],
      ["another flow's cookie", other.cookie],
    ]) {
      const refused = await callback(url, sent);
      expect(refused.headers.location, wrong).toBe("/?oidc=failed");
      expect(oidcSessions(), wrong).toBe(0);
      expect(cookieFrom(refused), wrong).toContainEqual(
        expect.stringMatching(/^contrack_oidc_[0-9a-f]{12}=;/),
      );
    }
    // The refusals left the flow, so the real browser's callback works, once.
    expect((await callback(url, cookie)).headers.location).toBe("/");
    expect(sessionsOf(ada.id)).toBe(1);
    expect((await callback(url, cookie)).headers.location).toBe(
      "/?oidc=failed",
    );
  });

  it("keeps two flows in one browser apart", async () => {
    const { ada } = ctx;
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const first = await startSignIn();
    const second = await startSignIn();
    const jar = [first.cookie, second.cookie];
    for (const flow of [first, second]) {
      idp.remember(flow.start.headers.location);
      idp.nextLogin({ sub: "sub-ada" });
      const res = await callback(`code=c&state=${flow.state}`, jar);
      expect(res.headers.location).toBe("/");
    }
    expect(sessionsOf(ada.id)).toBe(2);
  });

  it("signs a linked account in when userinfo fails, and logs no provider body", async () => {
    const { ada } = ctx;
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    idp.failNextUserinfo();
    const warn = vi.spyOn(log, "warn");
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
  });

  it("keeps the session to this browser when keep me signed in is off", async () => {
    const { ada } = ctx;
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
    linkIdentity(ctx.ada.id, idp.issuer, "sub-ada", null);
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

  it("limits starts and callbacks apart, and leaves password sign-in alone", async () => {
    linkIdentity(ctx.ada.id, idp.issuer, "sub-ada", null);
    const { state, cookie } = await startSignIn();
    for (let i = 1; i < 20; i++) {
      const ok = await request(app).get("/api/auth/oidc/start");
      expect(ok.headers.location).toMatch(/\/authorize\?/);
    }
    const refused = await request(app).get("/api/auth/oidc/start");
    expect(refused.status).toBe(302);
    expect(refused.headers.location).toBe("/?oidc=failed");
    // The callback has its own window, and a refusal leaves the flow unused.
    for (let i = 0; i < 20; i++) {
      const cb = await callback("code=c&state=x");
      expect(cb.headers.location).toBe("/?oidc=failed");
    }
    idp.nextLogin({ sub: "sub-ada" });
    const limited = await callback(`code=c&state=${state}`, cookie);
    expect(limited.headers.location).toBe("/?oidc=failed");
    expect(oidcSessions()).toBe(0);
    await passwordLogin("ada");
    __resetAuthRateLimits();
    const ok = await callback(`code=c&state=${state}`, cookie);
    expect(ok.headers.location).toBe("/");
    expect(oidcSessions()).toBe(1);
  });
});

describe("API: where an OIDC callback lands", () => {
  /** A flow as a browser starts it: a sign-in, or a link from settings. */
  async function begin(kind: "sign-in" | "link") {
    if (kind === "sign-in") {
      const { state, start } = await startSignIn();
      return { state, session: [], res: start };
    }
    const session = await passwordLogin("ada");
    const { state, link } = await startLink(session);
    return { state, session, res: link };
  }
  /** What happens before the callback, and the seconds it takes. */
  const asIs = () => 0;
  const usedUp = (state: string) => {
    sqlite.prepare("DELETE FROM auth_challenges WHERE id = ?").run(state);
    return 0;
  };
  // Eleven minutes on, the flow has run out and the browser keeps only the
  // cookies whose Max-Age has not.
  const elevenMinutesOn = (state: string) => {
    sqlite
      .prepare("UPDATE auth_challenges SET expiresAt = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), state);
    return 11 * 60;
  };

  it.each<
    [string, "sign-in" | "link", string, (state: string) => number, string]
  >([
    [
      "a denied sign-in",
      "sign-in",
      "error=access_denied",
      asIs,
      "/?oidc=denied",
    ],
    [
      "another provider error",
      "sign-in",
      "error=server_error",
      asIs,
      "/?oidc=failed",
    ],
    [
      "a provider error for a used state",
      "sign-in",
      "error=access_denied",
      usedUp,
      "/?oidc=failed",
    ],
    [
      "a sign-in eleven minutes after its start",
      "sign-in",
      "code=c",
      elevenMinutesOn,
      "/?oidc=expired",
    ],
    [
      "a denied link",
      "link",
      "error=access_denied",
      asIs,
      linkLanding("denied"),
    ],
    [
      "a link eleven minutes after its start",
      "link",
      "code=c",
      elevenMinutesOn,
      linkLanding("expired"),
    ],
    // Nothing queued: the provider answers 400 invalid_grant.
    [
      "a link whose code exchange fails",
      "link",
      "code=c",
      asIs,
      linkLanding("failed"),
    ],
  ])(
    "lands %s, and uses up the flow",
    async (_case, kind, query, before, landing) => {
      const { state, session, res } = await begin(kind);
      const seconds = before(state);
      const done = await callback(`${query}&state=${state}`, [
        ...session,
        ...flowCookieAfter(res, seconds),
      ]);
      expect(done.headers.location).toBe(landing);
      expect(count("auth_challenges WHERE kind = 'oidc'")).toBe(0);
    },
  );
});

describe("API: linking OIDC from settings", () => {
  it("links the signed-in account, lists it, and unlinks it, but never another account's", async () => {
    const { ada, adminId } = ctx;
    linkIdentity(adminId, idp.issuer, "sub-admin", null);
    const cookie = await passwordLogin("ada");

    expect((await request(app).post("/api/auth/oidc/link")).status).toBe(401);
    const { state, cookie: withFlow } = await startLink(cookie);
    idp.nextLogin({ sub: "sub-ada", email: "ada@idp.example" });
    const done = await callback(`code=c&state=${state}`, withFlow);
    expect(done.headers.location).toBe(linkLanding("linked"));

    const list = await request(app)
      .get("/api/auth/identities")
      .set("Cookie", cookie);
    expect(list.body.identities).toHaveLength(1);
    expect(typeof list.body.matchByEmail).toBe("boolean");
    expect(list.body.identities[0].email).toBe("ada@idp.example");
    const unlink = (id: string) =>
      request(app)
        .delete(`/api/auth/identities/${id}`)
        .set("Cookie", cookie)
        .set("Origin", ORIGIN);
    expect((await unlink(listIdentities(adminId)[0].id)).status).toBe(404);
    expect((await unlink(list.body.identities[0].id)).status).toBe(200);
    expect(count("user_identities WHERE userId = ?", ada.id)).toBe(0);
    expect(count("user_identities WHERE userId = ?", adminId)).toBe(1);
    expect(
      count(
        "audit_log WHERE action = 'auth.oidc.unlinked' AND actorUserId = ?",
        ada.id,
      ),
    ).toBe(1);
  });

  it("refuses a link callback opened by another account, and logs it", async () => {
    const warn = vi.spyOn(log, "warn");
    const { state, flow } = await startLink(await passwordLogin("ada"));
    idp.nextLogin({ sub: "sub-x" });
    const done = await callback(`code=c&state=${state}`, [
      ...ctx.adminCookie,
      flow,
    ]);
    expect(done.headers.location).toBe(linkLanding("failed"));
    expect(count("user_identities")).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      "Auth",
      "OIDC link finished without the session that started it",
      expect.anything(),
    );
  });

  it("refuses to link an identity another account holds", async () => {
    linkIdentity(ctx.adminId, idp.issuer, "sub-x", null);
    const { state, cookie } = await startLink(await passwordLogin("ada"));
    idp.nextLogin({ sub: "sub-x" });
    const done = await callback(`code=c&state=${state}`, cookie);
    expect(done.headers.location).toBe(linkLanding("taken"));
    expect(
      sqlite
        .prepare("SELECT userId FROM user_identities WHERE subject = 'sub-x'")
        .get(),
    ).toEqual({ userId: ctx.adminId });
  });

  it("marks an identity current at the provider set up now, however its issuer is written", async () => {
    const { ada, adminCookie } = ctx;
    linkIdentity(ada.id, `${idp.issuer}/`, "sub-ada", null);
    linkIdentity(ada.id, "https://old.example.com", "sub-old", null);
    const cookie = await passwordLogin("ada");
    const current = async (session: string[]) =>
      Object.fromEntries(
        (
          await request(app).get("/api/auth/identities").set("Cookie", session)
        ).body.identities.map((i: { issuer: string; current: boolean }) => [
          i.issuer,
          i.current,
        ]),
      );
    const adas = { [`${idp.issuer}/`]: true, "https://old.example.com": false };
    expect(await current(cookie)).toEqual(adas);

    // No secret: the discovery URL names the saved provider, so it stays.
    const discoveryUrl = `${idp.issuer}/.well-known/openid-configuration`;
    const saved = await asAdmin(
      request(app)
        .put("/api/admin/integrations")
        .send({
          oidc: {
            issuer: discoveryUrl,
            clientId: "contrack",
            name: "Test IdP",
            matchByEmail: false,
          },
        }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.oidc.issuer).toBe(discoveryUrl);
    expect(await current(cookie)).toEqual(adas);

    // A link made now keeps the issuer that discovery names.
    const { state, cookie: withFlow } = await startLink(adminCookie);
    idp.nextLogin({ sub: "sub-admin" });
    const done = await callback(`code=c&state=${state}`, withFlow);
    expect(done.headers.location).toBe(linkLanding("linked"));
    expect(await current(adminCookie)).toEqual({ [idp.issuer]: true });
  });
});

describe("API: a password reset", () => {
  it("unlinks every identity, by mailed link or by an admin", async () => {
    const { ada } = ctx;
    const identities = () => count("user_identities WHERE userId = ?", ada.id);
    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const link = createAuthLink("reset", ada.id, 3600)!;
    const reset = await request(app)
      .post("/api/auth/password-reset/complete")
      .send({ token: link.token, password: `${PASSWORD} again` });
    expect(reset.status).toBe(200);
    expect(identities()).toBe(0);
    expect(
      auditDetails("action = 'auth.oidc.unlinked' AND targetId = ?", ada.id),
    ).toMatchObject({ reason: "password-reset" });

    linkIdentity(ada.id, idp.issuer, "sub-ada", null);
    const byAdmin = await asAdmin(
      request(app).post(`/api/admin/users/${ada.id}/reset-password`),
    );
    expect(byAdmin.status).toBe(200);
    expect(identities()).toBe(0);
    const res = await signIn({ sub: "sub-ada" });
    expect(res.headers.location).toBe("/?oidc=no-account");
  });
});

describe("API: OIDC failures on browser routes", () => {
  it.each<[string, OidcConfigInput | null]>([
    ["no provider", null],
    [
      "a provider it cannot reach",
      {
        issuer: "http://127.0.0.1:9",
        clientId: "contrack",
        clientSecret: "secret",
        name: "Test IdP",
        matchByEmail: true,
      },
    ],
  ])(
    "sends a start with %s back to sign-in, with no flow cookie",
    async (_case, config) => {
      setOidcConfig(config);
      forgetOidcDiscovery();
      const res = await request(app).get("/api/auth/oidc/start");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/?oidc=failed");
      expect(
        cookieFrom(res).some((c) => /^contrack_oidc_\w+=[^;]/.test(c)),
      ).toBe(false);
    },
  );

  it("gives up on a token answer that never ends after ten seconds", async () => {
    const { state, cookie } = await startSignIn();
    idp.stallNextToken();
    const started = Date.now();
    const res = await callback(`code=c&state=${state}`, cookie);
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(Date.now() - started).toBeLessThan(11_000);
  }, 15_000);

  it("logs the OAuth error code, and no provider text that can name the person", async () => {
    // The lines as the log writes them.
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const email = "ada.lovelace@example.com";
    const denied = await startSignIn();
    await callback(
      `state=${denied.state}&error=${email}&error_description=${email}`,
      denied.cookie,
    );
    const refused = await startSignIn();
    idp.refuseNextToken({
      error: "invalid_grant",
      error_description: `No consent from ${email}`,
    });
    const res = await callback(`code=c&state=${refused.state}`, refused.cookie);
    expect(res.headers.location).toBe("/?oidc=failed");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /\[WARN\].*OIDC provider returned an error \{"error":"other"\}/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /\[WARN\].*OIDC sign-in did not finish.*"oauthError":"invalid_grant"/,
      ),
    );
    expect(lines.filter((line) => line.includes("@"))).toEqual([]);
  });

  it.each<[string, FakeLogin, boolean]>([
    ["a linked sign-in", { sub: "sub-ada" }, true],
    [
      "an email sign-in",
      { sub: "sub-new", email: "ada@example.com", email_verified: true },
      false,
    ],
  ])(
    "leaves nothing half made when %s fails after the provider answered",
    async (_case, login, linked) => {
      const { ada } = ctx;
      if (linked) linkIdentity(ada.id, idp.issuer, "sub-ada", null);
      const rows = () => ({
        identities: count("user_identities"),
        audit: count("audit_log"),
      });
      const before = rows();
      vi.spyOn(identityService, "touchIdentity").mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const res = await signIn(login);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/?oidc=failed");
      expect(sessionsOf(ada.id)).toBe(0);
      // An email link and its auth.oidc.linked row roll back with the rest.
      expect(rows()).toEqual(before);
    },
  );
});

describe("API: OIDC email matching needs a trusted email", () => {
  /** Where a provider sign-in with this verified email lands. */
  async function landingFor(email: string): Promise<string> {
    const res = await signIn({
      sub: `sub-${email}`,
      email,
      email_verified: true,
    });
    return res.headers.location;
  }

  async function changeOwnEmail(identifier: string, email: string) {
    const cookie = await passwordLogin(identifier);
    const res = await request(app)
      .patch("/api/auth/me")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ email });
    expect(res.status).toBe(200);
  }

  it("trusts an account an admin made", async () => {
    const made = await asAdmin(
      request(app).post("/api/admin/users").send({
        email: "bob@example.com",
        username: "bob",
        role: "member",
      }),
    );
    expect(made.status).toBe(201);
    // Found by email, then refused until the temporary password is replaced.
    expect(await landingFor("bob@example.com")).toBe(
      "/?oidc=must-change-password",
    );
  });

  it("trusts an invited account only at the invited address", async () => {
    const join = async (invited: string, typed: string, username: string) => {
      const invitation = await asAdmin(
        request(app)
          .post("/api/admin/invitations")
          .send({ email: invited, role: "member" }),
      );
      expect(invitation.status).toBe(201);
      const token = new URL(invitation.body.link).searchParams.get("token");
      const accepted = await request(app)
        .post("/api/auth/accept-invitation")
        .send({ token, email: typed, username, password: PASSWORD });
      expect(accepted.status).toBe(201);
    };
    await join("carol@example.com", "Carol@example.com", "carol");
    await join("someone@example.com", "dave@example.com", "dave");
    expect(await landingFor("carol@example.com")).toBe("/");
    expect(await landingFor("dave@example.com")).toBe("/?oidc=no-account");
  });

  it("does not trust an account from open registration", async () => {
    const open = (registrationOpen: boolean) =>
      asAdmin(
        request(app).put("/api/admin/settings").send({ registrationOpen }),
      );
    expect((await open(true)).status).toBe(200);
    try {
      const registered = await request(app).post("/api/auth/register").send({
        email: "erin@example.com",
        username: "erin",
        password: PASSWORD,
      });
      expect(registered.status).toBe(201);
      expect(await landingFor("erin@example.com")).toBe("/?oidc=no-account");
    } finally {
      await open(false);
    }
  });

  it("does not hand a member's typed address somebody else's sign-in", async () => {
    // Ada types the address of somebody who has no account here yet.
    await changeOwnEmail("ada", "victim@corp.example");
    expect(await landingFor("victim@corp.example")).toBe("/?oidc=no-account");
    expect(count("user_identities")).toBe(0);
  });

  it("trusts a changed address once a link mailed to it is followed, and stops a link mailed before", async () => {
    for (const kind of ["reset", "magic"] as const) {
      const { ada } = await setup();
      const follow = async (token: string) =>
        (
          await request(app)
            .post(
              `/api/auth/${kind === "reset" ? "password-reset" : "magic-link"}/complete`,
            )
            .send({ token, password: `${PASSWORD} again` })
        ).status;
      const mailedBefore = createAuthLink(kind, ada.id, 900)!;
      await changeOwnEmail("ada", "ada@new.example");
      expect(await follow(mailedBefore.token), kind).toBe(410);
      expect(await landingFor("ada@new.example"), kind).toBe(
        "/?oidc=no-account",
      );
      expect(await follow(createAuthLink(kind, ada.id, 900)!.token), kind).toBe(
        200,
      );
      expect(await landingFor("ada@new.example"), kind).toBe("/");
    }
  });

  it("folds only ASCII, so a Kelvin sign never stands for k", async () => {
    const kate = await createUser({
      email: "kate@example.com",
      username: "kate",
      password: PASSWORD,
      role: "member",
      emailTrusted: true,
    });
    // U+212A lowercases to "k" in JavaScript.
    expect(await landingFor("Kate@example.com")).toBe("/?oidc=no-account");
    expect(sessionsOf(kate.id)).toBe(0);
    expect(await landingFor("KATE@example.com")).toBe("/");
    expect(sessionsOf(kate.id)).toBe(1);
  });
});

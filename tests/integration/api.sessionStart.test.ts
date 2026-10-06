// Integration: the session each sign-in route starts.
// Seven routes start a session through `startSession` in server/routes/auth.ts.
// Each one must set a cookie that lasts the session lifetime, unless the caller
// sends `remember: false` to a route that reads it, and must record how the
// person signed in and from what client. The passkey route has the same check
// in api.passkeys.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { cookieFrom, resetAccounts } from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAdminRateLimits } from "../../server/routes/admin.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import { createAuthLink } from "../../server/services/authLinkService.ts";
import * as authService from "../../server/services/authService.ts";

const app = makeTestApp();
const PASSWORD = "correct horse battery staple";
const CLIENT = "SessionStartTest/1.0";
const REFUSAL =
  "This account has been disabled. Ask an administrator to re-enable it.";
const NEWCOMER = {
  email: "joiner@example.com",
  username: "joiner",
  password: PASSWORD,
  displayName: "Joiner",
};

beforeAll(() => {
  process.env.AUTH_REQUIRED = "true";
});
afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  resetAccounts();
});
beforeEach(() => {
  resetAccounts();
  sqlite.exec(
    "DELETE FROM sessions; DELETE FROM auth_links; DELETE FROM invitations; DELETE FROM audit_log;",
  );
  authService.setRegistrationOpen(false);
  clearSettingsCache();
  __resetAuthRateLimits();
  __resetAdminRateLimits();
  __resetAuthWarnings();
});

const post = (path: string, body: object = {}, cookie: string[] = []) =>
  request(app)
    .post(path)
    .set("Host", "localhost:3210")
    .set("User-Agent", CLIENT)
    .set("Cookie", cookie)
    .send(body);

const member = () =>
  authService.createUser({
    email: "alice@example.com",
    username: "alice",
    password: PASSWORD,
    displayName: "Alice",
    role: "member",
  });

const lastSession = () =>
  sqlite
    .prepare(
      "SELECT method, userAgent, expiresAt FROM sessions ORDER BY rowid DESC LIMIT 1",
    )
    .get() as
    | { method: string | null; userAgent: string | null; expiresAt: string }
    | undefined;

type Flow = [
  name: string,
  method: string,
  run: (extra?: object) => Promise<request.Response>,
];

const flows: Flow[] = [
  [
    "setup",
    "password",
    (extra) => post("/api/auth/setup", { ...NEWCOMER, ...extra }),
  ],
  [
    "register",
    "password",
    async (extra) => {
      await member();
      authService.setRegistrationOpen(true);
      clearSettingsCache();
      return post("/api/auth/register", { ...NEWCOMER, ...extra });
    },
  ],
  [
    "invitation",
    "password",
    async (extra) => {
      const admin = cookieFrom(
        await post("/api/auth/setup", {
          ...NEWCOMER,
          email: "admin@example.com",
          username: "admin",
        }),
      );
      const made = await post(
        "/api/admin/invitations",
        { role: "member" },
        admin,
      );
      const token = new URL(made.body.link).searchParams.get("token");
      __resetAuthRateLimits();
      return post("/api/auth/accept-invitation", {
        token,
        ...NEWCOMER,
        ...extra,
      });
    },
  ],
  [
    "password reset",
    "email-link",
    async (extra) => {
      const user = await member();
      const link = createAuthLink("reset", user.id, 3600)!;
      return post("/api/auth/password-reset/complete", {
        token: link.token,
        password: "an entirely different passphrase 42",
        ...extra,
      });
    },
  ],
  [
    "magic link",
    "email-link",
    async (extra) => {
      const user = await member();
      const link = createAuthLink("magic", user.id, 900)!;
      return post("/api/auth/magic-link/complete", {
        token: link.token,
        ...extra,
      });
    },
  ],
  [
    "login",
    "password",
    async (extra) => {
      await member();
      return post("/api/auth/login", {
        identifier: "alice",
        password: PASSWORD,
        ...extra,
      });
    },
  ],
];

describe("the session each sign-in route starts", () => {
  it.each(flows)(
    "%s lasts the full session lifetime and records %s and the client",
    async (_name, method, run) => {
      const res = await run();
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      const maxAge = Number(
        /Max-Age=(\d+)/.exec(cookieFrom(res).join(";"))?.[1],
      );
      const lifetime = authService.getSessionTtlDays() * 86_400;
      expect(Math.abs(maxAge - lifetime)).toBeLessThan(10);
      expect(lastSession()).toMatchObject({ method, userAgent: CLIENT });
    },
  );

  it.each(flows.filter(([name]) => name === "login" || name === "magic link"))(
    "%s with remember false sets a session cookie and a session under one day",
    async (_name, _method, run) => {
      const res = await run({ remember: false });
      expect(res.status).toBe(200);
      expect(cookieFrom(res).join(";")).not.toContain("Max-Age");
      const days =
        (new Date(lastSession()!.expiresAt).getTime() - Date.now()) /
        86_400_000;
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(1);
    },
  );

  it.each([
    [
      "login",
      () =>
        post("/api/auth/login", { identifier: "alice", password: PASSWORD }),
    ],
    [
      "magic link",
      (id: string) =>
        post("/api/auth/magic-link/complete", {
          token: createAuthLink("magic", id, 900)!.token,
        }),
    ],
  ])(
    "%s refuses a disabled account and starts no session",
    async (_name, run) => {
      const user = await member();
      sqlite
        .prepare(
          "UPDATE users SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(user.id);
      const res = await run(user.id);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: "ACCOUNT_DISABLED",
        message: REFUSAL,
      });
      expect(cookieFrom(res)).toEqual([]);
      expect(lastSession()).toBeUndefined();
    },
  );
});

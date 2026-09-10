// =============================================================================
// Integration Tests — the two AI rate limiters, with both switched on
// =============================================================================
// Every other integration file builds its app with `disableRateLimit: true`,
// because a fixed window shared by a whole test file turns an unrelated
// assertion into a 429. This file is the exception: it builds the app with
// both limiters mounted, which is the only way to prove the second one is
// wired at all.
//
// The two answer different questions. The per-IP limiter asks whether one
// machine is hammering the instance and runs before anybody is identified.
// The per-account one asks whether one person is spending more than their
// share of a shared provider key, and can only run once `attachPrincipal` has
// said who is asking. The case that matters is several people behind one
// office address: the per-IP limiter alone lets one of them exhaust
// everybody's budget.
//
// The requests go to a path that matches the cost patterns and has no route
// behind it. Both limiters are app-level middleware mounted ahead of the
// routers, so a request is counted before routing, and counting is the whole
// of what this file is about. Sending thirty real provider calls to prove a
// counter would be slower and would test the provider.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import http from "http";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { sqlite } from "../../server/db.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { __resetAuthWarnings } from "../../server/middleware/auth.ts";
import { __resetAiRateLimits } from "../../server/middleware/rateLimit.ts";

/** The app with the limiters left on, unlike every other integration file. */
function makeLimitedApp(): http.Server {
  const app = createApp({ disableRateLimit: false });
  app.use(notFoundHandler);
  const server = http.createServer(finalizeApp(app));
  server.listen(0, "127.0.0.1");
  server.unref();
  return server;
}

const app = makeLimitedApp();
const PASSWORD = "correct horse battery staple";

/** A cost path with no route behind it: counted, then answered 404. */
const COUNTED_PATH = "/api/link-preview/no-such-endpoint";

interface Handle {
  id: string;
  username: string;
  cookie: string[];
}

function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

const as = (who: Handle) => (r: request.Test) => r.set("Cookie", who.cookie);

let alice: Handle;
let bob: Handle;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  resetAccounts();
  __resetAuthRateLimits();

  const first = await request(app).post("/api/auth/setup").send({
    email: "alice@example.com",
    username: "alice",
    password: PASSWORD,
    displayName: "Alice",
  });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  alice = {
    id: first.body.user.id,
    username: "alice",
    cookie: cookieFrom(first),
  };

  const created = await request(app)
    .post("/api/admin/users")
    .set("Cookie", alice.cookie)
    .send({ email: "bob@example.com", username: "bob" });
  expect(created.status).toBe(201);
  __resetAuthRateLimits();
  const signedIn = await request(app)
    .post("/api/auth/login")
    .send({ identifier: "bob", password: created.body.temporaryPassword });
  const cookie = cookieFrom(signedIn);
  await request(app)
    .post("/api/auth/change-password")
    .set("Cookie", cookie)
    .send({
      currentPassword: created.body.temporaryPassword,
      newPassword: PASSWORD,
    });
  bob = { id: created.body.user.id, username: "bob", cookie };
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  resetAccounts();
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
  __resetAuthWarnings();
  __resetAiRateLimits();
});

beforeEach(() => {
  __resetAiRateLimits();
  __resetAuthRateLimits();
});

describe("the per-account AI limiter", () => {
  it("refuses the thirty-first request in a minute with a Retry-After", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await as(alice)(request(app).get(COUNTED_PATH));
      expect(res.status, `request ${i + 1}`).not.toBe(429);
    }

    const refused = await as(alice)(request(app).get(COUNTED_PATH));
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
    expect(refused.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    // A client that sleeps for the header and retries must find it open.
    const header = Number(refused.headers["retry-after"]);
    expect(header).toBeGreaterThan(0);
    expect(header).toBeLessThanOrEqual(60);
  });

  it("leaves another account on the same address alone", async () => {
    // This is the case the per-IP limiter cannot answer. Both requests come
    // from 127.0.0.1, and the per-IP window has 60 in it, so nothing but the
    // per-account limiter can tell these two apart.
    for (let i = 0; i < 31; i++) {
      await as(alice)(request(app).get(COUNTED_PATH));
    }
    expect((await as(alice)(request(app).get(COUNTED_PATH))).status).toBe(429);

    const other = await as(bob)(request(app).get(COUNTED_PATH));
    expect(other.status).not.toBe(429);
  });

  it("counts one window across every cost path, not one per path", async () => {
    // The two paths risks question Q16 added are the ones to prove here: a
    // per-path counter would let somebody spend thirty on each.
    for (let i = 0; i < 30; i++) {
      await as(alice)(request(app).get(COUNTED_PATH));
    }
    const insight = await as(alice)(request(app).get("/api/dashboard/insight"));
    expect(insight.status).toBe(429);

    const scan = await as(alice)(
      request(app).post("/api/dedupe/scan").send({ mode: "quick" }),
    );
    expect(scan.status).toBe(429);
  });

  it("leaves a path that is not an AI cost path alone", async () => {
    for (let i = 0; i < 40; i++) {
      const res = await as(alice)(request(app).get("/api/contacts"));
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
  });

  it("does not pool the requests nobody has identified", async () => {
    // A caller with no credential has no account to charge. The per-IP
    // limiter has already seen them, and lumping every such request into one
    // window would let the first of a minute exhaust it for the rest.
    for (let i = 0; i < 40; i++) {
      const res = await request(app).get(COUNTED_PATH);
      // 401 from requireAuth, never 429 from the per-account limiter.
      expect(res.status, `request ${i + 1}`).toBe(401);
    }
  });
});

describe("the per-IP AI limiter", () => {
  it("still refuses one machine at sixty a minute, whoever is signed in", async () => {
    // Split across two accounts so neither reaches its own thirty first. The
    // sixty-first request from this address is refused by the older limiter,
    // which runs before anybody is identified.
    for (let i = 0; i < 30; i++) {
      expect((await as(alice)(request(app).get(COUNTED_PATH))).status).not.toBe(
        429,
      );
    }
    for (let i = 0; i < 30; i++) {
      expect((await as(bob)(request(app).get(COUNTED_PATH))).status).not.toBe(
        429,
      );
    }

    const refused = await as(bob)(request(app).get(COUNTED_PATH));
    expect(refused.status).toBe(429);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
  });
});

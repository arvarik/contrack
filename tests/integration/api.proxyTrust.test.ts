// =============================================================================
// Integration: forwarded headers
// =============================================================================
// The server used to trust one proxy hop always. With no proxy in front, that
// hop is the client, so a client's own X-Forwarded-For chose the address the
// login and reset-link limits counted and the audit log wrote down.
// TRUST_PROXY_HOPS now defaults to 0. These tests prove the difference through
// the real pipeline: the failed sign-in's audit row, and HSTS, which follows
// `req.secure` and so X-Forwarded-Proto.
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";

// Sign-in only answers on an instance that requires it. This file runs in its
// own process (the integration project uses forks), so the variable stays here.
process.env.AUTH_REQUIRED = "true";

function lastFailedSignInIp(): string | null {
  const row = sqlite
    .prepare(
      "SELECT ip FROM audit_log WHERE action = 'auth.login.failed' ORDER BY rowid DESC LIMIT 1",
    )
    .get() as { ip: string | null } | undefined;
  return row?.ip ?? null;
}

async function failSignIn(app: ReturnType<typeof makeTestApp>) {
  await request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-For", "203.0.113.9")
    .send({ identifier: "nobody", password: "not the password" })
    .expect(401);
}

describe("TRUST_PROXY_HOPS", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY_HOPS;
    __resetAuthRateLimits();
  });

  it("ignores a client's X-Forwarded-For by default", async () => {
    const app = makeTestApp();
    try {
      await failSignIn(app);
      expect(lastFailedSignInIp()).toMatch(/127\.0\.0\.1$/);
    } finally {
      app.close();
    }
  });

  it("believes X-Forwarded-For from one trusted proxy", async () => {
    process.env.TRUST_PROXY_HOPS = "1";
    const app = makeTestApp();
    try {
      await failSignIn(app);
      expect(lastFailedSignInIp()).toBe("203.0.113.9");
    } finally {
      app.close();
    }
  });

  it("sends HSTS only for a request that arrived over HTTPS", async () => {
    const direct = makeTestApp();
    process.env.TRUST_PROXY_HOPS = "1";
    const proxied = makeTestApp();
    try {
      // With no trusted hop, the client's X-Forwarded-Proto says nothing.
      const plain = await request(direct)
        .get("/api/auth/status")
        .set("X-Forwarded-Proto", "https");
      expect(plain.headers["strict-transport-security"]).toBeUndefined();

      const tls = await request(proxied)
        .get("/api/auth/status")
        .set("X-Forwarded-Proto", "https");
      expect(tls.headers["strict-transport-security"]).toBe("max-age=31536000");
    } finally {
      direct.close();
      proxied.close();
    }
  });

  it("refuses a value that is not a whole number of hops", () => {
    process.env.TRUST_PROXY_HOPS = "yes";
    expect(() => makeTestApp()).toThrow(/TRUST_PROXY_HOPS/);
  });
});

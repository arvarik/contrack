import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { mailService } from "../../server/services/mailService.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import { __resetAdminRateLimits } from "../../server/routes/admin.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import * as authService from "../../server/services/authService.ts";
import { createAuthLink } from "../../server/services/authLinkService.ts";

const app = makeTestApp();

const PASSWORD = "correct horse battery staple";

interface Handle {
  id: string;
  username: string;
  email: string;
  cookie: string[];
}

function cookieFrom(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[]) ?? [];
}

function as(who: Handle) {
  return (r: request.Test): request.Test => r.set("Cookie", who.cookie);
}

async function freshAdmin(email = "admin@example.com"): Promise<Handle> {
  resetAccounts();
  sqlite.exec(
    `DELETE FROM audit_log; DELETE FROM invitations; DELETE FROM auth_links;`,
  );
  __resetAuthRateLimits();
  __resetAdminRateLimits();
  const res = await request(app).post("/api/auth/setup").send({
    name: "Admin",
    email,
    username: "adminuser",
    password: PASSWORD,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const user = res.body.user ?? res.body;
  return {
    id: user.id,
    username: "adminuser",
    email,
    cookie: cookieFrom(res),
  };
}

describe("API: Password reset and magic links", () => {
  beforeEach(() => {
    resetAccounts();
    sqlite.exec(
      `DELETE FROM audit_log; DELETE FROM sessions; DELETE FROM auth_links; DELETE FROM users WHERE credentialState != 'none';`,
    );
    clearSettingsCache();
    mailService.__useJsonTransport(false);
    mailService.__clearSentMessages();
    __resetAuthRateLimits();
    __resetAdminRateLimits();
  });

  afterEach(() => {
    mailService.__useJsonTransport(false);
    mailService.__clearSentMessages();
  });

  describe("POST /api/auth/password-reset/request", () => {
    it("always returns 202 even for unknown emails", async () => {
      const res = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: "nobody@example.com" });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({});
      expect(mailService.__getSentMessages()).toHaveLength(0);
    });

    it("sends no email when mail is not configured", async () => {
      const admin = await freshAdmin();
      const res = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: admin.email });
      expect(res.status).toBe(202);
      expect(mailService.__getSentMessages()).toHaveLength(0);
    });

    it("creates an auth link and sends reset email when mail is configured", async () => {
      mailService.__useJsonTransport(true);
      const admin = await freshAdmin("testuser@example.com");

      const res = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: admin.email });
      expect(res.status).toBe(202);

      const messages = mailService.__getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("/reset-password?token=");

      const link = sqlite
        .prepare("SELECT * FROM auth_links WHERE userId = ? AND kind = 'reset'")
        .get(admin.id) as { tokenHash: string; expiresAt: string } | undefined;
      expect(link).toBeDefined();
    });

    it("does not send email or create link for disabled accounts", async () => {
      mailService.__useJsonTransport(true);
      const admin = await freshAdmin("disabled@example.com");
      sqlite
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(admin.id);

      const res = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: admin.email });
      expect(res.status).toBe(202);
      expect(mailService.__getSentMessages()).toHaveLength(0);
      const link = sqlite
        .prepare("SELECT * FROM auth_links WHERE userId = ?")
        .get(admin.id);
      expect(link).toBeUndefined();
    });

    it("enforces hourly creation cap of 3 per account without error", async () => {
      mailService.__useJsonTransport(true);
      const admin = await freshAdmin("capped@example.com");

      for (let i = 0; i < 3; i++) {
        __resetAuthRateLimits(); // clear IP rate limit
        const res = await request(app)
          .post("/api/auth/password-reset/request")
          .send({ email: admin.email });
        expect(res.status).toBe(202);
      }
      expect(mailService.__getSentMessages()).toHaveLength(3);

      // 4th request within 1 hour: still 202, but no new message
      __resetAuthRateLimits();
      const res4 = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: admin.email });
      expect(res4.status).toBe(202);
      expect(mailService.__getSentMessages()).toHaveLength(3);
    });

    it("rate limits by IP with linkLimiter (3 per 15 min)", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/auth/password-reset/request")
          .send({ email: "anyone@example.com" });
        expect(res.status).toBe(202);
      }

      const res4 = await request(app)
        .post("/api/auth/password-reset/request")
        .send({ email: "anyone@example.com" });
      expect(res4.status).toBe(429);
    });
  });

  describe("POST /api/auth/password-reset/complete", () => {
    it("validates required fields and password length", async () => {
      const resNoToken = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ password: "newPassword123!" });
      expect(resNoToken.status).toBe(400);

      const resNoPass = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: "tok123" });
      expect(resNoPass.status).toBe(400);

      const resShortPass = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: "tok123", password: "short" });
      expect(resShortPass.status).toBe(400);
    });

    it("refuses invalid, expired, and already-used tokens", async () => {
      const admin = await freshAdmin();

      // Unknown token
      const resInvalid = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: "unknown-token", password: "newPassword123!" });
      expect(resInvalid.status).toBe(404);
      expect(resInvalid.body.error.code).toBe("LINK_INVALID");

      // Expired token
      const link1 = createAuthLink("reset", admin.id, 100);
      expect(link1).not.toBeNull();
      sqlite
        .prepare(
          "UPDATE auth_links SET expiresAt = datetime('now', '-1 hour') WHERE id = ?",
        )
        .run(link1!.id);

      const resExpired = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: link1!.token, password: "newPassword123!" });
      expect(resExpired.status).toBe(410);
      expect(resExpired.body.error.code).toBe("LINK_EXPIRED");

      // Already-used token
      const link2 = createAuthLink("reset", admin.id, 3600);
      expect(link2).not.toBeNull();
      sqlite
        .prepare(
          "UPDATE auth_links SET usedAt = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(link2!.id);

      const resUsed = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: link2!.token, password: "newPassword123!" });
      expect(resUsed.status).toBe(410);
      expect(resUsed.body.error.code).toBe("LINK_USED");
    });

    it("resets password, signs in with email-link method, and audits", async () => {
      const admin = await freshAdmin();
      authService.createSession(admin.id, "Old Device");

      const link = createAuthLink("reset", admin.id, 3600);
      expect(link).not.toBeNull();

      const newPassword = "newPassword456!";
      const res = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: link!.token, password: newPassword });

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(admin.id);
      expect(res.body.user.mustChangePassword).toBe(false);

      // Verify cookie was set
      const cookies = cookieFrom(res);
      expect(cookies.some((c) => c.includes("contrack_session="))).toBe(true);

      // Verify session method is "email-link"
      const sessionRow = sqlite
        .prepare("SELECT method FROM sessions WHERE userId = ?")
        .get(admin.id) as { method: string };
      expect(sessionRow.method).toBe("email-link");

      // Verify audit row
      const audit = sqlite
        .prepare(
          "SELECT * FROM audit_log WHERE targetId = ? AND action = 'auth.password.reset'",
        )
        .get(admin.id) as { action: string; actorUserId: string };
      expect(audit).toBeDefined();
      expect(audit.actorUserId).toBe(admin.id);

      // Verify user can now sign in with the new password
      const creds = await authService.verifyCredentials(
        admin.username,
        newPassword,
      );
      expect(creds).not.toBeNull();
      expect(creds?.id).toBe(admin.id);
    });

    it("rejects reset completion with 403 ACCOUNT_DISABLED for disabled accounts", async () => {
      const admin = await freshAdmin();
      const link = createAuthLink("reset", admin.id, 3600);
      expect(link).not.toBeNull();

      sqlite
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(admin.id);

      const res = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: link!.token, password: "newPassword789!" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ACCOUNT_DISABLED");
    });

    it("revokes active API tokens and sibling auth links on reset", async () => {
      const admin = await freshAdmin();
      const link1 = createAuthLink("reset", admin.id, 3600);
      const link2 = createAuthLink("reset", admin.id, 3600);
      expect(link1).not.toBeNull();
      expect(link2).not.toBeNull();

      sqlite
        .prepare(
          `INSERT INTO api_tokens (id, userId, tokenHash, tokenPrefix, name, expiresAt)
           VALUES ('tok-1', ?, 'hash-1', 'ct_test', 'Test Token', datetime('now', '+30 days'))`,
        )
        .run(admin.id);

      const res = await request(app)
        .post("/api/auth/password-reset/complete")
        .send({ token: link1!.token, password: "newPassword123!" });
      expect(res.status).toBe(200);

      const tokenRow = sqlite
        .prepare("SELECT revokedAt FROM api_tokens WHERE id = 'tok-1'")
        .get() as { revokedAt: string | null };
      expect(tokenRow.revokedAt).not.toBeNull();

      const sibling = sqlite
        .prepare("SELECT usedAt FROM auth_links WHERE id = ?")
        .get(link2!.id) as { usedAt: string | null };
      expect(sibling.usedAt).not.toBeNull();
    });
  });

  describe("POST /api/auth/magic-link/request", () => {
    it("returns 404 MAGIC_LINK_OFF when magicLinkSignIn is disabled", async () => {
      mailService.__useJsonTransport(true);
      authService.setMagicLinkSignIn(false);

      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: "user@example.com" });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("MAGIC_LINK_OFF");
    });

    it("returns 404 MAGIC_LINK_OFF when mail is not configured even if setting is true", async () => {
      mailService.__useJsonTransport(false);
      authService.setMagicLinkSignIn(true);

      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: "user@example.com" });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("MAGIC_LINK_OFF");
    });

    it("sends magic link when enabled and user exists", async () => {
      mailService.__useJsonTransport(true);
      authService.setMagicLinkSignIn(true);
      const admin = await freshAdmin("magicuser@example.com");

      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: admin.email });
      expect(res.status).toBe(202);

      const messages = mailService.__getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("/signin-link?token=");

      const link = sqlite
        .prepare("SELECT * FROM auth_links WHERE userId = ? AND kind = 'magic'")
        .get(admin.id) as { tokenHash: string; expiresAt: string } | undefined;
      expect(link).toBeDefined();
    });

    it("does not send magic link for disabled accounts", async () => {
      mailService.__useJsonTransport(true);
      authService.setMagicLinkSignIn(true);
      const admin = await freshAdmin("disabledmagic@example.com");
      sqlite
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(admin.id);

      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: admin.email });
      expect(res.status).toBe(202);
      expect(mailService.__getSentMessages()).toHaveLength(0);
    });
  });

  describe("POST /api/auth/magic-link/complete", () => {
    it("completes magic link sign-in, signs in with email-link method, and writes audits", async () => {
      const admin = await freshAdmin();
      const link = createAuthLink("magic", admin.id, 900);
      expect(link).not.toBeNull();

      const res = await request(app)
        .post("/api/auth/magic-link/complete")
        .send({ token: link!.token });

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(admin.id);

      // Verify cookie
      const cookies = cookieFrom(res);
      expect(cookies.some((c) => c.includes("contrack_session="))).toBe(true);

      // Verify session method
      const resSessions = await request(app)
        .get("/api/auth/sessions")
        .set("Cookie", cookies);
      expect(resSessions.status).toBe(200);
      const currentSession = resSessions.body.sessions.find(
        (s: { current: boolean; method: string }) => s.current,
      );
      expect(currentSession?.method).toBe("email-link");

      // Verify audit rows: auth.login.success with method magic-link, and auth.magic_link.used
      const loginAudit = sqlite
        .prepare(
          "SELECT details FROM audit_log WHERE targetId = ? AND action = 'auth.login.success'",
        )
        .get(admin.id) as { details: string };
      expect(JSON.parse(loginAudit.details)).toMatchObject({
        method: "magic-link",
      });

      const usedAudit = sqlite
        .prepare(
          "SELECT * FROM audit_log WHERE targetId = ? AND action = 'auth.magic_link.used'",
        )
        .get(admin.id);
      expect(usedAudit).toBeDefined();
    });

    it("rejects invalid, expired, or used magic link tokens", async () => {
      const admin = await freshAdmin();

      const resInvalid = await request(app)
        .post("/api/auth/magic-link/complete")
        .send({ token: "not-real" });
      expect(resInvalid.status).toBe(404);
      expect(resInvalid.body.error.code).toBe("LINK_INVALID");

      const link = createAuthLink("magic", admin.id, 900);
      sqlite
        .prepare(
          "UPDATE auth_links SET expiresAt = datetime('now', '-5 minutes') WHERE id = ?",
        )
        .run(link!.id);

      const resExpired = await request(app)
        .post("/api/auth/magic-link/complete")
        .send({ token: link!.token });
      expect(resExpired.status).toBe(410);
      expect(resExpired.body.error.code).toBe("LINK_EXPIRED");
    });

    it("rejects magic link completion with 403 ACCOUNT_DISABLED for disabled accounts", async () => {
      const admin = await freshAdmin();
      const link = createAuthLink("magic", admin.id, 900);
      expect(link).not.toBeNull();

      sqlite
        .prepare("UPDATE users SET status = 'disabled' WHERE id = ?")
        .run(admin.id);

      const res = await request(app)
        .post("/api/auth/magic-link/complete")
        .send({ token: link!.token });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ACCOUNT_DISABLED");
    });
  });

  describe("POST /api/admin/users/:id/reset-link", () => {
    it("returns 409 MAIL_NOT_CONFIGURED when mail is not configured", async () => {
      const admin = await freshAdmin();
      mailService.__useJsonTransport(false);

      const member = await authService.createUser({
        username: "member1",
        email: "member1@example.com",
        password: PASSWORD,
        role: "member",
      });

      const res = await as(admin)(
        request(app).post(`/api/admin/users/${member.id}/reset-link`),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("MAIL_NOT_CONFIGURED");
    });

    it("sends 24-hour reset link when mail is configured and audits user.password.reset via email", async () => {
      mailService.__useJsonTransport(true);
      const admin = await freshAdmin();

      const member = await authService.createUser({
        username: "member2",
        email: "member2@example.com",
        password: PASSWORD,
        role: "member",
      });

      const res = await as(admin)(
        request(app).post(`/api/admin/users/${member.id}/reset-link`),
      );
      expect(res.status).toBe(200);
      expect(res.body.sentTo).toBe("member2@example.com");
      expect(res.body.expiresAt).toBeDefined();

      const messages = mailService.__getSentMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toContain("/reset-password?token=");
      expect(messages[0].text).toContain("24 hours");

      // Verify audit row
      const audit = sqlite
        .prepare(
          "SELECT * FROM audit_log WHERE targetId = ? AND action = 'user.password.reset'",
        )
        .get(member.id) as { actorUserId: string; details: string };
      expect(audit).toBeDefined();
      expect(audit.actorUserId).toBe(admin.id);
      expect(JSON.parse(audit.details)).toMatchObject({
        via: "email",
        username: "member2",
      });
    });
  });

  describe("PUT /api/admin/settings & GET /api/auth/status magicLinkSignIn", () => {
    it("refuses magicLinkSignIn: true with 409 MAIL_NOT_CONFIGURED when mail is off", async () => {
      const admin = await freshAdmin();
      mailService.__useJsonTransport(false);

      const res = await as(admin)(
        request(app).put("/api/admin/settings").send({ magicLinkSignIn: true }),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("MAIL_NOT_CONFIGURED");
    });

    it("enables magicLinkSignIn when mail is on, reports in status and settings, and audits", async () => {
      mailService.__useJsonTransport(true);
      const admin = await freshAdmin();

      const res = await as(admin)(
        request(app).put("/api/admin/settings").send({ magicLinkSignIn: true }),
      );
      expect(res.status).toBe(200);
      expect(res.body.magicLinkSignIn).toBe(true);

      // GET /api/admin/settings
      const settingsRes = await as(admin)(
        request(app).get("/api/admin/settings"),
      );
      expect(settingsRes.body.magicLinkSignIn).toBe(true);

      // GET /api/auth/status
      const statusRes = await request(app).get("/api/auth/status");
      expect(statusRes.body.magicLinkSignIn).toBe(true);
      expect(statusRes.body.mailConfigured).toBe(true);

      // If mail is turned off, status reports magicLinkSignIn: false
      mailService.__useJsonTransport(false);
      const statusResOff = await request(app).get("/api/auth/status");
      expect(statusResOff.body.magicLinkSignIn).toBe(false);
      expect(statusResOff.body.mailConfigured).toBe(false);

      // Verify audit
      const audit = sqlite
        .prepare(
          "SELECT * FROM audit_log WHERE action = 'settings.changed' AND targetId = 'auth.magicLinkSignIn'",
        )
        .get();
      expect(audit).toBeDefined();
    });
  });
});

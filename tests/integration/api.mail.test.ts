import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import { mailService } from "../../server/services/mailService.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import { __resetAdminRateLimits } from "../../server/routes/admin.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import * as authService from "../../server/services/authService.ts";

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
  sqlite.exec(`DELETE FROM audit_log; DELETE FROM invitations;`);
  __resetAuthRateLimits();
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

async function createMember(email = "member@example.com"): Promise<Handle> {
  const user = await authService.createUser({
    username: "memberuser",
    email,
    password: PASSWORD,
  });
  __resetAuthRateLimits();
  const res = await request(app).post("/api/auth/login").send({
    identifier: "memberuser",
    password: PASSWORD,
  });
  return {
    id: user.id,
    username: "memberuser",
    email,
    cookie: cookieFrom(res),
  };
}

describe("api.mail", () => {
  let admin: Handle;
  let member: Handle;
  const originalSmtpUrl = process.env.SMTP_URL;
  const originalMailFrom = process.env.MAIL_FROM;

  beforeAll(() => {
    process.env.AUTH_REQUIRED = "true";
  });

  afterAll(() => {
    delete process.env.AUTH_REQUIRED;
  });

  afterEach(() => {
    if (originalSmtpUrl !== undefined) process.env.SMTP_URL = originalSmtpUrl;
    else delete process.env.SMTP_URL;

    if (originalMailFrom !== undefined)
      process.env.MAIL_FROM = originalMailFrom;
    else delete process.env.MAIL_FROM;

    mailService.__useJsonTransport(false);
    mailService.__clearSentMessages();
    mailService.__invalidateTransportCache();
    clearSettingsCache();
    sqlite.prepare("DELETE FROM app_settings WHERE key = 'mail.smtp'").run();
  });

  beforeEach(async () => {
    delete process.env.SMTP_URL;
    delete process.env.MAIL_FROM;
    mailService.__useJsonTransport(false);
    mailService.__clearSentMessages();
    mailService.__invalidateTransportCache();
    clearSettingsCache();
    sqlite.prepare("DELETE FROM app_settings WHERE key = 'mail.smtp'").run();
    __resetAdminRateLimits();

    admin = await freshAdmin("admin@example.com");
    member = await createMember("member@example.com");
  });

  it("guards PUT /api/admin/mail to admins only", async () => {
    const payload = {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "user",
      password: "secretpassword123",
      from: "crm@example.com",
    };

    // Anonymous request is refused with 401
    const anonRes = await request(app).put("/api/admin/mail").send(payload);
    expect(anonRes.status).toBe(401);

    // Member request is refused with 403
    const memberRes = await as(member)(
      request(app).put("/api/admin/mail").send(payload),
    );
    expect(memberRes.status).toBe(403);
    expect(memberRes.body.error.code).toBe("ADMIN_REQUIRED");

    // Admin request succeeds
    const adminRes = await as(admin)(
      request(app).put("/api/admin/mail").send(payload),
    );
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.source).toBe("settings");
    expect(adminRes.body.host).toBe("smtp.example.com");
  });

  it("stores a sealed password in settings and never returns it in GET", async () => {
    const password = "my-super-secret-smtp-password";
    const putRes = await as(admin)(
      request(app).put("/api/admin/mail").send({
        host: "mail.contrack.internal",
        port: 465,
        secure: true,
        user: "mailer",
        password,
        from: "notifications@contrack.internal",
        replyTo: "help@contrack.internal",
      }),
    );
    expect(putRes.status).toBe(200);
    expect(putRes.body.hasPassword).toBe(true);
    expect(putRes.body.password).toBeUndefined();

    // Verify app_settings row on disk has sealed password, not plaintext
    const row = sqlite
      .prepare("SELECT value FROM app_settings WHERE key = 'mail.smtp'")
      .get() as { value: string };
    const parsed = JSON.parse(row.value);
    expect(parsed.passwordSealed).toMatch(/^v1:/);
    expect(parsed.password).toBeUndefined();
    expect(row.value).not.toContain(password);

    // GET /api/admin/mail returns hasPassword: true and no secret
    const getRes = await as(admin)(request(app).get("/api/admin/mail"));
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      source: "settings",
      host: "mail.contrack.internal",
      port: 465,
      secure: true,
      user: "mailer",
      from: "notifications@contrack.internal",
      replyTo: "help@contrack.internal",
      hasPassword: true,
    });
    expect(getRes.body.password).toBeUndefined();
    expect(JSON.stringify(getRes.body)).not.toContain(password);

    // Audit log records mail.settings.changed
    const auditRow = sqlite
      .prepare(
        "SELECT action, targetType, targetId FROM audit_log WHERE action = 'mail.settings.changed' ORDER BY createdAt DESC LIMIT 1",
      )
      .get() as { action: string; targetType: string; targetId: string };
    expect(auditRow).toMatchObject({
      action: "mail.settings.changed",
      targetType: "mail",
      targetId: "smtp",
    });
  });

  it("reflects SMTP_URL from environment as source: env and makes PUT answer 409", async () => {
    process.env.SMTP_URL = "smtps://envuser:envpass@smtp.envprovider.net:465";
    process.env.MAIL_FROM = "env-sender@example.com";

    const getRes = await as(admin)(request(app).get("/api/admin/mail"));
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      source: "env",
      host: "smtp.envprovider.net",
      port: 465,
      secure: true,
      user: "envuser",
      from: "env-sender@example.com",
      hasPassword: true,
    });
    expect(getRes.body.password).toBeUndefined();

    // PUT /api/admin/mail answers 409
    const putRes = await as(admin)(
      request(app).put("/api/admin/mail").send({
        host: "other.example.com",
        port: 587,
        secure: false,
        from: "other@example.com",
      }),
    );
    expect(putRes.status).toBe(409);
    expect(putRes.body.error.code).toBe("MAIL_CONFIGURED_BY_ENV");

    // DELETE /api/admin/mail answers 409
    const delRes = await as(admin)(request(app).delete("/api/admin/mail"));
    expect(delRes.status).toBe(409);
    expect(delRes.body.error.code).toBe("MAIL_CONFIGURED_BY_ENV");
  });

  it("deletes mail settings and clears configuration", async () => {
    await as(admin)(
      request(app).put("/api/admin/mail").send({
        host: "temp.example.com",
        port: 587,
        secure: false,
        from: "temp@example.com",
      }),
    );

    const delRes = await as(admin)(request(app).delete("/api/admin/mail"));
    expect(delRes.status).toBe(200);
    expect(delRes.body.source).toBe("none");

    const getRes = await as(admin)(request(app).get("/api/admin/mail"));
    expect(getRes.body.source).toBe("none");
    expect(getRes.body.hasPassword).toBe(false);
  });

  it("handles POST /api/admin/mail/test with JSON test transport", async () => {
    mailService.__useJsonTransport(true);

    const testRes = await as(admin)(
      request(app).post("/api/admin/mail/test").send({}),
    );
    expect(testRes.status).toBe(200);
    expect(testRes.body.sentTo).toBe("admin@example.com");

    const sent = mailService.__getSentMessages();
    expect(sent.length).toBe(1);
    const to = Array.isArray(sent[0].to)
      ? (sent[0].to[0] as unknown as { address: string }).address
      : sent[0].to;
    expect(to).toBe("admin@example.com");
    expect(sent[0].subject).toContain("Test message");

    // Audit log recorded
    const audit = sqlite
      .prepare(
        "SELECT action, details FROM audit_log WHERE action = 'mail.test.sent' ORDER BY createdAt DESC LIMIT 1",
      )
      .get() as { action: string; details: string };
    expect(audit).toBeDefined();
    expect(JSON.parse(audit.details)).toMatchObject({
      to: "admin@example.com",
    });
  });

  it("reports MAIL_SEND_FAILED from a transport that throws", async () => {
    // Configure settings so mail is considered configured
    await as(admin)(
      request(app).put("/api/admin/mail").send({
        host: "smtp.throwing.local",
        port: 587,
        secure: false,
        from: "from@throwing.local",
      }),
    );

    // Mock sendOrThrow on mailService to simulate transport failure
    const sendSpy = vi
      .spyOn(mailService, "sendOrThrow")
      .mockRejectedValueOnce(new Error("Connection refused (ECONNREFUSED)"));

    const res = await as(admin)(
      request(app).post("/api/admin/mail/test").send({}),
    );
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("MAIL_SEND_FAILED");
    expect(res.body.error.message).toContain("ECONNREFUSED");

    sendSpy.mockRestore();
  });

  it("enforces rate limit of 5 tests per 10 minutes per account", async () => {
    mailService.__useJsonTransport(true);

    for (let i = 0; i < 5; i++) {
      const res = await as(admin)(
        request(app).post("/api/admin/mail/test").send({}),
      );
      expect(res.status).toBe(200);
    }

    // 6th attempt is rate limited
    const limitedRes = await as(admin)(
      request(app).post("/api/admin/mail/test").send({}),
    );
    expect(limitedRes.status).toBe(429);
  });

  it("reports mailConfigured in /api/auth/status and /api/admin/settings", async () => {
    // Initially false
    const status1 = await request(app).get("/api/auth/status");
    expect(status1.body.mailConfigured).toBe(false);

    const settings1 = await as(admin)(request(app).get("/api/admin/settings"));
    expect(settings1.body.mailConfigured).toBe(false);

    // Configure mail
    await as(admin)(
      request(app).put("/api/admin/mail").send({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        from: "crm@example.com",
      }),
    );

    const status2 = await request(app).get("/api/auth/status");
    expect(status2.body.mailConfigured).toBe(true);

    const settings2 = await as(admin)(request(app).get("/api/admin/settings"));
    expect(settings2.body.mailConfigured).toBe(true);
  });
});

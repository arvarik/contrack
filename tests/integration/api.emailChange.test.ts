// Integration: changing the account's own email
// A new email needs the current password. With mail that can carry links, it
// waits in a link mailed to the new address, and the old address gets a
// notice, as OWASP asks. Without mail, it applies at once and stays untrusted.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { cookieFrom, resetAccounts } from "./tenancy/helpers.ts";
import { mailService } from "../../server/services/mailService.ts";
import { clearSettingsCache } from "../../server/services/settingsService.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { createUser } from "../../server/services/authService.ts";
import { createAuthLink } from "../../server/services/authLinkService.ts";

const app = makeTestApp();
const PASSWORD = "correct horse battery staple";
const ORIGIN = "https://crm.example.com";

let cookie: string[];
let adaId: string;

beforeEach(async () => {
  process.env.PUBLIC_URL = ORIGIN;
  resetAccounts();
  sqlite.exec("DELETE FROM audit_log; DELETE FROM auth_links;");
  clearSettingsCache();
  __resetAuthRateLimits();
  mailService.__useJsonTransport(true);
  mailService.__clearSentMessages();
  const setup = await request(app).post("/api/auth/setup").send({
    email: "admin@example.com",
    username: "adminuser",
    password: PASSWORD,
  });
  expect(setup.status).toBe(201);
  adaId = (
    await createUser({
      email: "ada@example.com",
      username: "ada",
      password: PASSWORD,
      role: "member",
      emailTrusted: true,
    })
  ).id;
  const login = await request(app)
    .post("/api/auth/login")
    .send({ identifier: "ada", password: PASSWORD });
  cookie = cookieFrom(login).map((c) => c.split(";")[0]);
});

afterEach(() => {
  delete process.env.PUBLIC_URL;
  mailService.__useJsonTransport(false);
  mailService.__clearSentMessages();
});

const patchMe = (body: object) =>
  request(app)
    .patch("/api/auth/me")
    .set("Cookie", cookie)
    .set("Origin", ORIGIN)
    .send(body);

const complete = (token: string) =>
  request(app).post("/api/auth/email-change/complete").send({ token });

const account = () =>
  sqlite
    .prepare("SELECT email, emailTrustedAt FROM users WHERE id = ?")
    .get(adaId) as { email: string; emailTrustedAt: string | null };

/** The mail sent so far, once `count` of them went out. */
const sent = (count: number) =>
  vi.waitFor(() => {
    const messages = mailService.__getSentMessages();
    expect(messages).toHaveLength(count);
    return messages;
  });

/** The mail sent to `to`. The transport records addresses as objects. */
const mailTo = (to: string) =>
  mailService
    .__getSentMessages()
    .filter((m) => JSON.stringify(m.to).includes(`"${to}"`));

/** The token in the newest confirmation mailed to `to`. */
async function tokenMailedTo(to: string, count: number): Promise<string> {
  await sent(count);
  const mail = mailTo(to).at(-1)!;
  return new URL(/https:\/\/\S+/.exec(mail.text!)![0]).searchParams.get(
    "token",
  )!;
}

describe("API: changing your own email", () => {
  it("asks for the current password, but not for a new name", async () => {
    for (const currentPassword of [undefined, "wrong password"]) {
      const res = await patchMe({ email: "ada@new.example", currentPassword });
      expect(res.status, String(currentPassword)).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(account().email).toBe("ada@example.com");
    expect((await patchMe({ displayName: "Ada L." })).status).toBe(200);
    // The same address in other letters is not a change.
    expect((await patchMe({ email: "ADA@example.com" })).status).toBe(200);
    expect(mailService.__getSentMessages()).toHaveLength(0);
  });

  it("waits for the link mailed to the new address, and tells the old one", async () => {
    const before = createAuthLink("reset", adaId, 3600)!;
    const res = await patchMe({
      email: "Ada@New.example",
      currentPassword: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("ada@example.com");
    expect(res.body.pendingEmail).toBe("ada@new.example");
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.body.pendingEmail).toBe("ada@new.example");

    const token = await tokenMailedTo("ada@new.example", 2);
    const [notice] = mailTo("ada@example.com");
    expect(notice.subject).toMatch(/is changing/);
    expect(notice.text).toContain("ada@new.example");
    expect(notice.text).not.toContain("token=");
    expect(account()).toEqual({
      email: "ada@example.com",
      emailTrustedAt: expect.any(String),
    });

    const done = await complete(token);
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ email: "ada@new.example" });
    expect(account()).toEqual({
      email: "ada@new.example",
      emailTrustedAt: expect.any(String),
    });
    // A link mailed to the old address no longer works, nor does this one.
    const reset = await request(app)
      .post("/api/auth/password-reset/complete")
      .send({ token: before.token, password: `${PASSWORD} again` });
    expect(reset.status).toBe(410);
    expect((await complete(token)).status).toBe(410);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).body
        .pendingEmail,
    ).toBeNull();
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'auth.email.changed' AND targetId = ?",
        )
        .get(adaId),
    ).toEqual({ n: 1 });
  });

  it("keeps one change waiting at a time, and Cancel ends it", async () => {
    await patchMe({ email: "first@new.example", currentPassword: PASSWORD });
    const first = await tokenMailedTo("first@new.example", 2);
    await patchMe({ email: "second@new.example", currentPassword: PASSWORD });
    const second = await tokenMailedTo("second@new.example", 4);
    expect((await complete(first)).status).toBe(410);

    const cancel = await request(app)
      .delete("/api/auth/email-change")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN);
    expect(cancel.body).toEqual({ ok: true });
    expect((await complete(second)).status).toBe(410);
    expect(account().email).toBe("ada@example.com");
  });

  it("refuses an address that another account took meanwhile", async () => {
    await patchMe({ email: "taken@new.example", currentPassword: PASSWORD });
    const token = await tokenMailedTo("taken@new.example", 2);
    await createUser({
      email: "taken@new.example",
      username: "bob",
      password: PASSWORD,
      role: "member",
    });
    expect((await complete(token)).status).toBe(409);
    expect(account().email).toBe("ada@example.com");
  });

  it("applies at once, untrusted, when there is no mail to carry the link", async () => {
    mailService.__useJsonTransport(false);
    const res = await patchMe({
      email: "ada@new.example",
      currentPassword: PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      user: { email: "ada@new.example" },
      pendingEmail: null,
    });
    expect(account()).toEqual({
      email: "ada@new.example",
      emailTrustedAt: null,
    });
  });
});

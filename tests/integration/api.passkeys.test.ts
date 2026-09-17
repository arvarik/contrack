// =============================================================================
// Integration: Passkeys API
// =============================================================================
// Covers registration options/verify, login options/verify, passkey listing,
// rename, remove, nudge dismissal, session requirement, ceremony expiry,
// disabled account checks, and origin verification.
// =============================================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { makeTestApp } from "./helpers.ts";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { __resetAuthRateLimits } from "../../server/routes/auth.ts";
import { createSession } from "../../server/services/authService.ts";
import { createToken } from "../../server/services/apiTokenService.ts";
import * as simplewebauthn from "@simplewebauthn/server";

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const app = makeTestApp();

const ACCOUNT = {
  email: "owner@example.com",
  username: "owner",
  password: "correct horse battery staple",
  displayName: "The Owner",
};

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
    DELETE FROM auth_challenges;
    DELETE FROM passkeys;
    DELETE FROM user_settings;
    DELETE FROM users;
  `);
  ensureLocalOwner();
}

function cookieFrom(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? (raw as string[]) : [raw as string];
}

async function setupAccount(overrides: Partial<typeof ACCOUNT> = {}) {
  __resetAuthRateLimits();
  const res = await request(app)
    .post("/api/auth/setup")
    .set("Host", "localhost:3210")
    .send({ ...ACCOUNT, ...overrides });
  return { res, cookie: cookieFrom(res), user: res.body.user };
}

function insertPasskeyRow(fields: {
  id: string;
  userId: string;
  name?: string;
  counter?: number;
  deviceType?: string;
  backedUp?: number;
}) {
  sqlite
    .prepare(
      `INSERT INTO passkeys (id, userId, name, publicKey, counter, deviceType, backedUp, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      fields.id,
      fields.userId,
      fields.name ?? "Chrome on Mac",
      Buffer.from("mock-public-key"),
      fields.counter ?? 0,
      fields.deviceType ?? "singleDevice",
      fields.backedUp ?? 0,
    );
}

beforeEach(() => {
  process.env.AUTH_REQUIRED = "true";
  wipeAccounts();
  __resetAuthRateLimits();
  vi.clearAllMocks();
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  wipeAccounts();
});

describe("passkey registration options", () => {
  it("requires an authenticated session (401 for anonymous)", async () => {
    const res = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Authentication required/i);
  });

  it("refuses API tokens with 403 SESSION_REQUIRED", async () => {
    const { user } = await setupAccount();
    const { token } = createToken(
      user as unknown as Parameters<typeof createToken>[0],
      { name: "Test Token" },
      null,
    );

    const res = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SESSION_REQUIRED");
  });

  it("refuses temporary password accounts with 403 PASSWORD_CHANGE_REQUIRED", async () => {
    const { user, cookie } = await setupAccount();
    sqlite
      .prepare("UPDATE users SET mustChangePassword = 1 WHERE id = ?")
      .run(user.id);

    const res = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("returns registration options and stores an auth challenge", async () => {
    const { user, cookie } = await setupAccount();

    const res = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ceremonyId");
    expect(res.body).toHaveProperty("options");
    expect(res.body.options.rp.id).toBe("localhost");
    expect(Buffer.from(res.body.options.user.id, "base64url").toString()).toBe(
      user.id,
    );
    expect(res.body.options.user.name).toBe(user.username);
    expect(res.body.options.attestation).toBe("none");
    expect(res.body.options.authenticatorSelection.residentKey).toBe(
      "preferred",
    );
    expect(res.body.options.authenticatorSelection.userVerification).toBe(
      "preferred",
    );

    const challenge = sqlite
      .prepare("SELECT * FROM auth_challenges WHERE id = ?")
      .get(res.body.ceremonyId) as {
      kind: string;
      userId: string;
      challenge: string;
    };
    expect(challenge).toBeDefined();
    expect(challenge.kind).toBe("register");
    expect(challenge.userId).toBe(user.id);
  });

  it("throws PASSKEY_UNSUPPORTED_ORIGIN on IP host without PUBLIC_URL", async () => {
    const { cookie } = await setupAccount();

    const res = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "127.0.0.1:3210")
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PASSKEY_UNSUPPORTED_ORIGIN");
  });
});

describe("passkey registration verify", () => {
  it("returns 410 CEREMONY_EXPIRED when challenge does not exist or has expired", async () => {
    const { cookie } = await setupAccount();

    const res = await request(app)
      .post("/api/auth/passkeys/register/verify")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie)
      .send({
        ceremonyId: crypto.randomUUID(),
        response: {
          id: "test",
          rawId: "test",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("CEREMONY_EXPIRED");
  });

  it("returns 401 PASSKEY_VERIFICATION_FAILED for a garbage response", async () => {
    const { cookie } = await setupAccount();
    const optRes = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);

    const res = await request(app)
      .post("/api/auth/passkeys/register/verify")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie)
      .send({
        ceremonyId: optRes.body.ceremonyId,
        response: {
          id: "bad-id",
          rawId: "bad-id",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PASSKEY_VERIFICATION_FAILED");
  });

  it("successfully registers a passkey with valid verification response", async () => {
    const { cookie, user } = await setupAccount();
    const optRes = await request(app)
      .post("/api/auth/passkeys/register/options")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);

    const mockCredentialID = "credential_abc123";
    const mockPublicKey = new Uint8Array([1, 2, 3, 4]);

    vi.mocked(simplewebauthn.verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: mockCredentialID,
          publicKey: mockPublicKey,
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      } as unknown as NonNullable<
        Awaited<
          ReturnType<typeof simplewebauthn.verifyRegistrationResponse>
        >["registrationInfo"]
      >,
    });

    const res = await request(app)
      .post("/api/auth/passkeys/register/verify")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie)
      .send({
        ceremonyId: optRes.body.ceremonyId,
        name: "My YubiKey",
        response: {
          id: mockCredentialID,
          rawId: mockCredentialID,
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.passkey).toBeDefined();
    expect(res.body.passkey.id).toBe(mockCredentialID);
    expect(res.body.passkey.name).toBe("My YubiKey");
    expect(res.body.passkey.deviceType).toBe("singleDevice");
    expect(res.body.passkey.backedUp).toBe(false);

    // Challenge must be deleted
    const challenge = sqlite
      .prepare("SELECT * FROM auth_challenges WHERE id = ?")
      .get(optRes.body.ceremonyId);
    expect(challenge).toBeUndefined();

    // Passkey exists in database
    const passkeyRow = sqlite
      .prepare("SELECT * FROM passkeys WHERE id = ?")
      .get(mockCredentialID) as { userId: string } | undefined;
    expect(passkeyRow).toBeDefined();
    expect(passkeyRow?.userId).toBe(user.id);
  });
});

describe("passkey login options & verify", () => {
  it("login options are public and carry allowCredentials: []", async () => {
    const res = await request(app)
      .post("/api/auth/passkeys/login/options")
      .set("Host", "localhost:3210");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ceremonyId");
    expect(res.body).toHaveProperty("options");
    expect(res.body.options.allowCredentials).toEqual([]);
    expect(res.body.options.rpId).toBe("localhost");
  });

  it("login verify returns 410 CEREMONY_EXPIRED for expired/invalid ceremony", async () => {
    const res = await request(app)
      .post("/api/auth/passkeys/login/verify")
      .set("Host", "localhost:3210")
      .send({
        ceremonyId: crypto.randomUUID(),
        response: {
          id: "cred-1",
          rawId: "cred-1",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe("CEREMONY_EXPIRED");
  });

  it("login verify returns 404 PASSKEY_NOT_FOUND if passkey does not exist", async () => {
    const optRes = await request(app)
      .post("/api/auth/passkeys/login/options")
      .set("Host", "localhost:3210");

    const res = await request(app)
      .post("/api/auth/passkeys/login/verify")
      .set("Host", "localhost:3210")
      .send({
        ceremonyId: optRes.body.ceremonyId,
        response: {
          id: "non-existent",
          rawId: "non-existent",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PASSKEY_NOT_FOUND");
  });

  it("login verify returns 401 PASSKEY_VERIFICATION_FAILED for garbage response", async () => {
    const { user } = await setupAccount();
    insertPasskeyRow({ id: "passkey_123", userId: user.id });

    const optRes = await request(app)
      .post("/api/auth/passkeys/login/options")
      .set("Host", "localhost:3210");

    const res = await request(app)
      .post("/api/auth/passkeys/login/verify")
      .set("Host", "localhost:3210")
      .send({
        ceremonyId: optRes.body.ceremonyId,
        response: {
          id: "passkey_123",
          rawId: "passkey_123",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("PASSKEY_VERIFICATION_FAILED");
  });

  it("refuses disabled accounts with 403 ACCOUNT_DISABLED", async () => {
    const { user } = await setupAccount();
    insertPasskeyRow({ id: "passkey_disabled", userId: user.id });
    sqlite
      .prepare(
        "UPDATE users SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(user.id);

    const optRes = await request(app)
      .post("/api/auth/passkeys/login/options")
      .set("Host", "localhost:3210");

    vi.mocked(
      simplewebauthn.verifyAuthenticationResponse,
    ).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
      } as unknown as NonNullable<
        Awaited<
          ReturnType<typeof simplewebauthn.verifyAuthenticationResponse>
        >["authenticationInfo"]
      >,
    });

    const res = await request(app)
      .post("/api/auth/passkeys/login/verify")
      .set("Host", "localhost:3210")
      .send({
        ceremonyId: optRes.body.ceremonyId,
        response: {
          id: "passkey_disabled",
          rawId: "passkey_disabled",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_DISABLED");
  });

  it("successfully verifies login, creates session with method 'passkey', and sets cookie", async () => {
    const { user } = await setupAccount();
    insertPasskeyRow({ id: "passkey_valid", userId: user.id });

    const optRes = await request(app)
      .post("/api/auth/passkeys/login/options")
      .set("Host", "localhost:3210");

    vi.mocked(
      simplewebauthn.verifyAuthenticationResponse,
    ).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 5,
      } as unknown as NonNullable<
        Awaited<
          ReturnType<typeof simplewebauthn.verifyAuthenticationResponse>
        >["authenticationInfo"]
      >,
    });

    const res = await request(app)
      .post("/api/auth/passkeys/login/verify")
      .set("Host", "localhost:3210")
      .send({
        ceremonyId: optRes.body.ceremonyId,
        response: {
          id: "passkey_valid",
          rawId: "passkey_valid",
          type: "public-key",
          response: {},
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(user.id);
    expect(cookieFrom(res).length).toBeGreaterThan(0);

    // Assert session was created with method = 'passkey'
    const session = sqlite
      .prepare(
        "SELECT * FROM sessions WHERE userId = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(user.id) as { method: string | null } | undefined;
    expect(session).toBeDefined();
    expect(session?.method).toBe("passkey");

    // Passkey counter and lastUsedAt updated
    const passkey = sqlite
      .prepare("SELECT * FROM passkeys WHERE id = ?")
      .get("passkey_valid") as
      { counter: number; lastUsedAt: string | null } | undefined;
    expect(passkey?.counter).toBe(5);
    expect(passkey?.lastUsedAt).not.toBeNull();
  });
});

describe("passkey management: list, rename, remove, nudge", () => {
  it("isolates list, rename, and remove per account (second account gets 404 for first)", async () => {
    const { user: user1, cookie: cookie1 } = await setupAccount();

    // Create a second account
    const user2Id = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO users (id, email, username, displayName, role, passwordHash, credentialState, createdAt)
         VALUES (?, 'user2@example.com', 'user2', 'User Two', 'member', 'hash', 'password', CURRENT_TIMESTAMP)`,
      )
      .run(user2Id);

    const session2 = createSession(user2Id, "Test Agent", {
      method: "password",
    });
    const cookie2 = [`contrack_session=${session2.secret}; Path=/; HttpOnly`];

    // Add passkey for user 1
    insertPasskeyRow({
      id: "passkey_user1",
      userId: user1.id,
      name: "User 1 Key",
    });

    // User 1 lists passkeys -> sees it
    const listRes1 = await request(app)
      .get("/api/auth/passkeys")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie1);
    expect(listRes1.status).toBe(200);
    expect(listRes1.body.passkeys).toHaveLength(1);
    expect(listRes1.body.passkeys[0].id).toBe("passkey_user1");
    expect(listRes1.body.nudgeDismissed).toBe(false);

    // User 2 lists passkeys -> sees 0 passkeys
    const listRes2 = await request(app)
      .get("/api/auth/passkeys")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie2);
    expect(listRes2.status).toBe(200);
    expect(listRes2.body.passkeys).toHaveLength(0);

    // User 2 tries to rename User 1's passkey -> 404 PASSKEY_NOT_FOUND
    const renameRes2 = await request(app)
      .patch("/api/auth/passkeys/passkey_user1")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie2)
      .send({ name: "Hacked Name" });
    expect(renameRes2.status).toBe(404);
    expect(renameRes2.body.error.code).toBe("PASSKEY_NOT_FOUND");

    // User 2 tries to delete User 1's passkey -> 404 PASSKEY_NOT_FOUND
    const deleteRes2 = await request(app)
      .delete("/api/auth/passkeys/passkey_user1")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie2);
    expect(deleteRes2.status).toBe(404);
    expect(deleteRes2.body.error.code).toBe("PASSKEY_NOT_FOUND");

    // User 1 renames their passkey -> 200
    const renameRes1 = await request(app)
      .patch("/api/auth/passkeys/passkey_user1")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie1)
      .send({ name: "Renamed Key" });
    expect(renameRes1.status).toBe(200);
    expect(renameRes1.body.passkey.name).toBe("Renamed Key");

    // User 1 deletes their passkey -> 200
    const deleteRes1 = await request(app)
      .delete("/api/auth/passkeys/passkey_user1")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie1);
    expect(deleteRes1.status).toBe(200);
    expect(deleteRes1.body.ok).toBe(true);

    // Verify it is gone
    const listResAfter = await request(app)
      .get("/api/auth/passkeys")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie1);
    expect(listResAfter.body.passkeys).toHaveLength(0);
  });

  it("dismisses passkey nudge and reports nudgeDismissed: true", async () => {
    const { cookie } = await setupAccount();

    const beforeRes = await request(app)
      .get("/api/auth/passkeys")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);
    expect(beforeRes.body.nudgeDismissed).toBe(false);

    const dismissRes = await request(app)
      .post("/api/auth/passkey-nudge/dismiss")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);
    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.ok).toBe(true);

    const afterRes = await request(app)
      .get("/api/auth/passkeys")
      .set("Host", "localhost:3210")
      .set("Cookie", cookie);
    expect(afterRes.body.nudgeDismissed).toBe(true);
  });
});

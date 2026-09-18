import { describe, it, expect, beforeEach } from "vitest";
import { sqlite } from "../../server/db.ts";
import { resetAccounts } from "./tenancy/helpers.ts";
import {
  createUser,
  createSession,
  verifyCredentials,
  listSessions,
} from "../../server/services/authService.ts";
import { resetPasswordCli } from "../../scripts/reset-password.ts";

describe("scripts/reset-password.ts", () => {
  beforeEach(async () => {
    resetAccounts();
    sqlite.exec(
      `DELETE FROM audit_log; DELETE FROM sessions; DELETE FROM users WHERE credentialState != 'none';`,
    );
  });

  it("resets password by username, revokes sessions, sets mustChangePassword, and writes audit", async () => {
    const user = await createUser({
      username: "alice",
      email: "alice@example.com",
      password: "initialPassword123!",
      role: "member",
    });

    createSession(user.id, "Mozilla/5.0");
    expect(listSessions(user.id, null)).toHaveLength(1);

    const res = await resetPasswordCli("alice");
    expect(res.userId).toBe(user.id);
    expect(res.username).toBe("alice");
    expect(res.email).toBe("alice@example.com");
    expect(res.temporaryPassword).toBeDefined();

    // Verify session was revoked
    expect(listSessions(user.id, null)).toHaveLength(0);

    // Verify mustChangePassword is set to 1
    const row = sqlite
      .prepare(
        "SELECT mustChangePassword, passwordChangedAt FROM users WHERE id = ?",
      )
      .get(user.id) as {
      mustChangePassword: number;
      passwordChangedAt: string;
    };
    expect(row.mustChangePassword).toBe(1);
    expect(row.passwordChangedAt).toBeDefined();

    // Verify credentials work with temporary password
    const verified = await verifyCredentials("alice", res.temporaryPassword);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(user.id);

    // Old password no longer works
    const oldVerified = await verifyCredentials("alice", "initialPassword123!");
    expect(oldVerified).toBeNull();

    // Verify audit row
    const audit = sqlite
      .prepare(
        "SELECT * FROM audit_log WHERE targetId = ? AND action = 'user.password.reset'",
      )
      .get(user.id) as {
      actorUserId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      details: string;
    };
    expect(audit).toBeDefined();
    expect(audit.actorUserId).toBeNull();
    const details = JSON.parse(audit.details);
    expect(details.via).toBe("cli");
    expect(details.username).toBe("alice");
  });

  it("resets password by email case-insensitively", async () => {
    const user = await createUser({
      username: "bob",
      email: "Bob.Smith@example.com",
      password: "initialPassword123!",
      role: "member",
    });

    const res = await resetPasswordCli("BOB.SMITH@EXAMPLE.COM");
    expect(res.userId).toBe(user.id);

    const verified = await verifyCredentials("bob", res.temporaryPassword);
    expect(verified).not.toBeNull();
  });

  it("throws for unknown account", async () => {
    await expect(resetPasswordCli("nobody")).rejects.toThrow(
      'Account "nobody" not found',
    );
  });

  it("throws for local owner with credentialState none", async () => {
    const local = sqlite
      .prepare(
        "SELECT username FROM users WHERE credentialState = 'none' LIMIT 1",
      )
      .get() as { username: string } | undefined;

    if (local) {
      await expect(resetPasswordCli(local.username)).rejects.toThrow(
        "This account has no password to reset",
      );
    }
  });
});

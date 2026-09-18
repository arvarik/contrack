import "dotenv/config";
import { sqlite } from "../server/db.ts";
import { hashPassword } from "../server/services/passwords.ts";
import { generateTemporaryPassword } from "../server/services/adminService.ts";
import { revokeOtherSessions } from "../server/services/authService.ts";
import { auditService } from "../server/services/auditService.ts";

export interface ResetPasswordResult {
  userId: string;
  username: string;
  email: string;
  temporaryPassword: string;
}

/**
 * Reset an account's password from the CLI.
 *
 * Finds the account by username or email, generates a temporary password,
 * sets mustChangePassword = 1, revokes all sessions, and writes an audit row
 * with actorUserId: null and details.via: "cli".
 */
export async function resetPasswordCli(
  identifier: string,
): Promise<ResetPasswordResult> {
  const query = identifier.trim().toLowerCase();
  if (!query) {
    throw new Error("Username or email is required");
  }

  const user = sqlite
    .prepare(
      `SELECT id, username, email, credentialState FROM users
       WHERE lower(username) = ? OR lower(email) = ? LIMIT 1`,
    )
    .get(query, query) as
    | { id: string; username: string; email: string; credentialState: string }
    | undefined;

  if (!user) {
    throw new Error(`Account "${identifier}" not found`);
  }

  if (user.credentialState === "none") {
    throw new Error(
      "This account has no password to reset. It is the local account that owns this device's data.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 1,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, user.id);
    revokeOtherSessions(user.id, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(user.id);
  })();

  auditService.record({
    actorUserId: null,
    action: "user.password.reset",
    targetType: "user",
    targetId: user.id,
    details: { username: user.username, via: "cli" },
    ip: null,
  });

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    temporaryPassword,
  };
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error("Usage: npm run reset-password <username-or-email>");
    process.exit(1);
  }

  try {
    const result = await resetPasswordCli(identifier);
    console.log(`Password reset for ${result.username} (${result.email}):`);
    console.log(`Temporary password: ${result.temporaryPassword}`);
    console.log(
      "The user will be required to change this password upon sign-in.",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("reset-password.ts") ||
    process.argv[1].endsWith("reset-password.js"));

if (isDirectRun) {
  void main();
}

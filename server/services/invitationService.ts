// =============================================================================
// Invitation Service — how a second person gets an account
// =============================================================================
// An admin creates an invitation and copies the link. There is no mail: this
// is a self-hosted app with no outbound mail configured, and adding one would
// be a deployment requirement rather than a feature. The admin sends the link
// however they already talk to the person.
//
// The database holds only the SHA-256 of the secret, so the invitations table
// is useless to anybody who reads it, including anybody who finds one of the
// rotating backups on disk. The secret exists in plaintext exactly once, in
// the response to the request that created it.
//
// An invitation is single use, expires (7 days by default), and can be
// revoked. Those three states each answer `410` with their own code so the
// person holding a dead link is told which kind of dead it is. An unknown or
// malformed token answers `404` with one body for both, so the endpoint
// cannot be used to test whether a token exists.
// =============================================================================

import crypto from "crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { auditService } from "./auditService.ts";
import { createUser, type User } from "./authService.ts";

/** How long an invitation lives when the admin does not say. */
export const DEFAULT_INVITATION_DAYS = 7;
export const MIN_INVITATION_DAYS = 1;
export const MAX_INVITATION_DAYS = 90;

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationSummary {
  id: string;
  email: string | null;
  role: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  invitedByUsername: string | null;
}

interface InvitationRow {
  id: string;
  email: string | null;
  role: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  invitedByUsername: string | null;
}

const SELECT_INVITATIONS = `
  SELECT i.id, i.email, i.role, i.createdAt, i.expiresAt, i.acceptedAt,
         i.acceptedBy, i.revokedAt, i.invitedBy, u.username AS invitedByUsername
    FROM invitations i
    LEFT JOIN users u ON u.id = i.invitedBy`;

function tokenHash(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

/**
 * The status the row is in right now.
 *
 * `expired` is derived from `expiresAt` rather than stored, so an invitation
 * that ages out needs no sweep to become unusable. The daily maintenance
 * interval removes long-dead rows, but the state changes on its own.
 */
function statusOf(row: {
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}): InvitationStatus {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (new Date(row.expiresAt).getTime() <= Date.now()) return "expired";
  return "pending";
}

/**
 * Create an invitation and return its one-time link.
 *
 * `origin` comes from the request, so the link works behind a reverse proxy
 * without the operator configuring a public URL anywhere.
 */
export function createInvitation(
  ctx: { actor: User; ip: string | null },
  input: {
    email?: string | null;
    role: "admin" | "member";
    expiresInDays?: number;
  },
  origin: string,
): { id: string; link: string; expiresAt: string } {
  const days = Math.min(
    MAX_INVITATION_DAYS,
    Math.max(
      MIN_INVITATION_DAYS,
      input.expiresInDays ?? DEFAULT_INVITATION_DAYS,
    ),
  );
  const secret = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const email = input.email?.trim().toLowerCase() || null;

  sqlite
    .prepare(
      `INSERT INTO invitations (id, email, role, tokenHash, invitedBy, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, email, input.role, tokenHash(secret), ctx.actor.id, expiresAt);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.invited",
    targetType: "invitation",
    targetId: id,
    // The email is a hint the admin typed, not a credential. The secret is
    // not here, and auditService would redact it under the key `link` anyway.
    details: { email, role: input.role, expiresAt },
    ip: ctx.ip,
  });

  log.info("Admin", `Invitation ${id} created for ${email ?? "anyone"}`);
  return { id, link: `${origin}/join?token=${secret}`, expiresAt };
}

export function listInvitations(): InvitationSummary[] {
  const rows = sqlite
    .prepare(`${SELECT_INVITATIONS} ORDER BY i.createdAt DESC`)
    .all() as InvitationRow[];
  return rows.map((row) => ({ ...row, status: statusOf(row) }));
}

export function revokeInvitation(
  ctx: { actor: User; ip: string | null },
  id: string,
): { revoked: true } {
  const row = sqlite
    .prepare(`SELECT id, acceptedAt FROM invitations WHERE id = ?`)
    .get(id) as { id: string; acceptedAt: string | null } | undefined;
  if (!row) throw new NotFoundError("Invitation", id);

  // Revoking an accepted invitation would say nothing about the account it
  // produced. Disabling that account is the action the admin wants.
  if (row.acceptedAt) {
    throw new AppError(
      "This invitation has already been accepted. Disable the account instead.",
      409,
      { code: "INVITATION_USED" },
    );
  }

  sqlite
    .prepare(
      `UPDATE invitations SET revokedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND revokedAt IS NULL`,
    )
    .run(id);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.invitation.revoked",
    targetType: "invitation",
    targetId: id,
    ip: ctx.ip,
  });
  return { revoked: true };
}

/**
 * Turn a link into an account.
 *
 * The person chooses their own email, username and password. The invitation
 * decides only the role, which is why an admin can invite an admin. The email
 * on the invitation is a hint the admin typed and is not enforced: a person
 * whose work address differs from the one the admin guessed would otherwise
 * be locked out by a typo they cannot see.
 */
export async function acceptInvitation(
  input: {
    token: unknown;
    email: unknown;
    username: unknown;
    password: unknown;
    displayName?: unknown;
  },
  ip: string | null,
): Promise<User> {
  // A malformed token and an unknown one get the same answer. Telling them
  // apart would turn this endpoint into an oracle for whether a link is real.
  if (typeof input.token !== "string" || !input.token)
    throw unknownInvitation();

  const row = sqlite
    .prepare(
      `SELECT id, role, invitedBy, acceptedAt, revokedAt, expiresAt
         FROM invitations WHERE tokenHash = ?`,
    )
    .get(tokenHash(input.token)) as
    | {
        id: string;
        role: string;
        invitedBy: string | null;
        acceptedAt: string | null;
        revokedAt: string | null;
        expiresAt: string;
      }
    | undefined;
  if (!row) throw unknownInvitation();

  const status = statusOf(row);
  if (status !== "pending") throw deadInvitation(status);

  const user = await createUser({
    email: input.email,
    username: input.username,
    password: input.password,
    displayName: input.displayName,
    role: row.role === "admin" ? "admin" : "member",
    // The admin who issued the invitation is the one responsible for the
    // account it produced, which is what the admin list shows.
    createdBy: row.invitedBy,
  });

  // Claimed after the account exists, and conditionally, so two people racing
  // the same link produce one account rather than two. The second UPDATE
  // changes nothing, and the account it created is left without an invitation
  // — which is why the check runs before the response is built.
  const claimed = sqlite
    .prepare(
      `UPDATE invitations
          SET acceptedAt = CURRENT_TIMESTAMP, acceptedBy = ?
        WHERE id = ? AND acceptedAt IS NULL AND revokedAt IS NULL`,
    )
    .run(user.id, row.id);
  if (claimed.changes === 0) {
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
    throw deadInvitation("accepted");
  }

  auditService.record({
    actorUserId: user.id,
    action: "user.invitation.accepted",
    targetType: "invitation",
    targetId: row.id,
    details: { username: user.username, role: user.role },
    ip,
  });

  log.info("Auth", `Invitation ${row.id} accepted by "${user.username}"`);
  return user;
}

/** One body for a token that is malformed and for one that never existed. */
function unknownInvitation(): AppError {
  return new AppError("That invitation link is not valid.", 404, {
    code: "INVITATION_NOT_FOUND",
  });
}

function deadInvitation(status: InvitationStatus): AppError {
  const message: Record<string, [string, string]> = {
    accepted: ["INVITATION_USED", "That invitation has already been used."],
    revoked: ["INVITATION_REVOKED", "That invitation was revoked."],
    expired: ["INVITATION_EXPIRED", "That invitation has expired."],
  };
  const [code, text] = message[status] ?? [
    "INVITATION_USED",
    "That invitation cannot be used.",
  ];
  return new AppError(`${text} Ask an administrator for a new link.`, 410, {
    code,
  });
}

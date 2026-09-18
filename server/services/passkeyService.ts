import crypto from "node:crypto";
import type { Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticatorTransport,
} from "@simplewebauthn/server";
import { sqlite } from "../db.ts";
import { AppError } from "../utils/AppError.ts";
import { getPasskeyRp } from "../utils/publicOrigin.ts";
import { getInstanceName, getUserById, type User } from "./authService.ts";
import { auditService } from "./auditService.ts";
import { describeDevice } from "../../src/lib/devices.ts";

export interface PasskeySummary {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PasskeyRow {
  id: string;
  userId: string;
  name: string;
  publicKey: Buffer;
  counter: number;
  transports: string | null;
  deviceType: string;
  backedUp: number;
  aaguid: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function rowToSummary(row: PasskeyRow): PasskeySummary {
  let transports: string[] | null = null;
  if (row.transports) {
    try {
      transports = JSON.parse(row.transports);
    } catch {
      transports = null;
    }
  }

  return {
    id: row.id,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: Boolean(row.backedUp),
    transports,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

function ipOf(req: Request): string | null {
  return req.ip ?? null;
}

// ── Registration ─────────────────────────────────────────────────────────────

export async function createRegistrationOptions(
  req: Request,
  user: User,
): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}> {
  const { rpID } = getPasskeyRp(req);

  const existingPasskeys = sqlite
    .prepare("SELECT id, transports FROM passkeys WHERE userId = ?")
    .all(user.id) as { id: string; transports: string | null }[];

  const excludeCredentials = existingPasskeys.map((p) => {
    let transports: AuthenticatorTransport[] | undefined = undefined;
    if (p.transports) {
      try {
        transports = JSON.parse(p.transports) as AuthenticatorTransport[];
      } catch {
        transports = undefined;
      }
    }
    return {
      id: p.id,
      transports,
    };
  });

  const options = await generateRegistrationOptions({
    rpName: getInstanceName() || "Contrack",
    rpID,
    userID: new Uint8Array(Buffer.from(user.id, "utf8")),
    userName: user.username,
    userDisplayName: user.displayName || user.username,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const ceremonyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'register', ?, ?, ?)`,
    )
    .run(ceremonyId, user.id, options.challenge, expiresAt);

  return { ceremonyId, options };
}

export async function verifyRegistration(
  req: Request,
  user: User,
  ceremonyId: string,
  response: RegistrationResponseJSON,
  name?: string,
): Promise<{ passkey: PasskeySummary }> {
  if (!ceremonyId || !response) {
    throw new AppError("Invalid registration payload.", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const challengeRow = sqlite
    .prepare(
      `DELETE FROM auth_challenges
        WHERE id = ? AND kind = 'register' AND userId = ?
        RETURNING id, challenge, expiresAt`,
    )
    .get(ceremonyId, user.id) as
    { id: string; challenge: string; expiresAt: string } | undefined;

  if (!challengeRow) {
    throw new AppError("Passkey ceremony expired or not found.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  if (new Date(challengeRow.expiresAt).getTime() <= Date.now()) {
    throw new AppError("Passkey ceremony expired.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  const { rpID, origin } = getPasskeyRp(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (cause) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
      cause,
    });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
    });
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
    verification.registrationInfo;

  const passkeyName =
    name?.trim() || describeDevice(req.headers["user-agent"] ?? null);

  const rawTransports =
    response.response.transports ?? credential.transports ?? null;
  const transports = rawTransports ? JSON.stringify(rawTransports) : null;

  sqlite
    .prepare(
      `INSERT INTO passkeys (id, userId, name, publicKey, counter, transports, deviceType, backedUp, aaguid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      credential.id,
      user.id,
      passkeyName,
      Buffer.from(credential.publicKey),
      credential.counter,
      transports,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      aaguid || null,
    );

  const inserted = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(credential.id, user.id) as PasskeyRow;

  const passkey = rowToSummary(inserted);

  auditService.record({
    actorUserId: user.id,
    action: "auth.passkey.added",
    targetType: "passkey",
    targetId: credential.id,
    details: { name: passkeyName },
    ip: ipOf(req),
  });

  return { passkey };
}

// ── Passkey Management ────────────────────────────────────────────────────────

export function listPasskeys(userId: string): PasskeySummary[] {
  const rows = sqlite
    .prepare(
      `SELECT id, userId, name, publicKey, counter, transports, deviceType, backedUp, aaguid, createdAt, lastUsedAt
         FROM passkeys
        WHERE userId = ?
        ORDER BY createdAt DESC`,
    )
    .all(userId) as PasskeyRow[];

  return rows.map(rowToSummary);
}

export function renamePasskey(
  req: Request,
  userId: string,
  id: string,
  name: string,
): { passkey: PasskeySummary } {
  const trimmed = name?.trim();
  if (!trimmed) {
    throw new AppError("Passkey name is required.", 400, {
      code: "VALIDATION_ERROR",
    });
  }

  const existing = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow | undefined;

  if (!existing) {
    throw new AppError("Passkey not found.", 404, {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  sqlite
    .prepare("UPDATE passkeys SET name = ? WHERE id = ? AND userId = ?")
    .run(trimmed, id, userId);

  const updated = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow;

  const passkey = rowToSummary(updated);

  auditService.record({
    actorUserId: userId,
    action: "auth.passkey.renamed",
    targetType: "passkey",
    targetId: id,
    details: { name: trimmed },
    ip: ipOf(req),
  });

  return { passkey };
}

export function removePasskey(
  req: Request,
  userId: string,
  id: string,
): { ok: boolean } {
  const existing = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow | undefined;

  if (!existing) {
    throw new AppError("Passkey not found.", 404, {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  sqlite
    .prepare("DELETE FROM passkeys WHERE id = ? AND userId = ?")
    .run(id, userId);

  auditService.record({
    actorUserId: userId,
    action: "auth.passkey.removed",
    targetType: "passkey",
    targetId: id,
    details: { name: existing.name },
    ip: ipOf(req),
  });

  return { ok: true };
}

// ── Login ────────────────────────────────────────────────────────────────────

export async function createLoginOptions(req: Request): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const { rpID } = getPasskeyRp(req);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });

  const ceremonyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'login', NULL, ?, ?)`,
    )
    .run(ceremonyId, options.challenge, expiresAt);

  return { ceremonyId, options };
}

export async function verifyLogin(
  req: Request,
  ceremonyId: string,
  response: AuthenticationResponseJSON,
): Promise<{ user: User }> {
  if (
    !ceremonyId ||
    !response ||
    typeof response !== "object" ||
    !response.id
  ) {
    throw new AppError("Passkey not found.", 404, {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  const challengeRow = sqlite
    .prepare(
      `DELETE FROM auth_challenges
        WHERE id = ? AND kind = 'login'
        RETURNING id, challenge, expiresAt`,
    )
    .get(ceremonyId) as
    { id: string; challenge: string; expiresAt: string } | undefined;

  if (!challengeRow) {
    throw new AppError("Passkey ceremony expired or not found.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  if (new Date(challengeRow.expiresAt).getTime() <= Date.now()) {
    throw new AppError("Passkey ceremony expired.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  const passkey = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ?")
    .get(response.id) as PasskeyRow | undefined;

  if (!passkey) {
    throw new AppError("Passkey not found.", 404, {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  const user = getUserById(passkey.userId);
  if (!user) {
    throw new AppError("Passkey not found.", 404, {
      code: "PASSKEY_NOT_FOUND",
    });
  }

  const { rpID, origin } = getPasskeyRp(req);

  let transports: string[] | undefined = undefined;
  if (passkey.transports) {
    try {
      transports = JSON.parse(passkey.transports);
    } catch {
      transports = undefined;
    }
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports,
      },
      requireUserVerification: false,
    });
  } catch (cause) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
      cause,
    });
  }

  if (!verification.verified) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
    });
  }

  sqlite
    .prepare(
      `UPDATE passkeys
          SET counter = ?, lastUsedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(verification.authenticationInfo.newCounter, passkey.id);

  if (user.status !== "disabled") {
    sqlite
      .prepare("UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(user.id);
  }

  return { user };
}

// ── Passkey Nudge ────────────────────────────────────────────────────────────

export function isPasskeyNudgeDismissed(userId: string): boolean {
  const row = sqlite
    .prepare("SELECT value FROM user_settings WHERE userId = ? AND key = ?")
    .get(userId, "auth.passkeyNudge") as { value: string } | undefined;
  return row?.value === "dismissed";
}

export function dismissPasskeyNudge(userId: string): void {
  sqlite
    .prepare(
      `INSERT INTO user_settings (userId, key, value, updatedAt)
       VALUES (?, 'auth.passkeyNudge', 'dismissed', CURRENT_TIMESTAMP)
       ON CONFLICT (userId, key) DO UPDATE SET
         value = 'dismissed',
         updatedAt = CURRENT_TIMESTAMP`,
    )
    .run(userId);
}

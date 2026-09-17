import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.ts";
import { AppError } from "./AppError.ts";

/**
 * SecretUnavailableError — thrown when a sealed secret cannot be opened
 * because the key changed, the payload was tampered with, or it is invalid.
 */
export class SecretUnavailableError extends AppError {
  constructor(
    message = "Secret is unavailable or could not be decrypted",
    cause?: unknown,
  ) {
    super(message, 500, { code: "SECRET_UNAVAILABLE", cause });
  }
}

/**
 * Validates the CONTRACK_SECRET_KEY environment variable.
 * Must be exactly 64 hex characters (32 bytes).
 */
export function validateSecretKey(
  key: string | undefined = process.env.CONTRACK_SECRET_KEY,
): void {
  if (key === undefined || key === "") {
    return;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      "CONTRACK_SECRET_KEY must be a 64-character hex string (32 bytes)",
    );
  }
}

let cachedKey: Buffer | null = null;

/**
 * Resets cached secret key (used for test isolation).
 */
export function __resetSecretKeyCache(): void {
  cachedKey = null;
}

/**
 * Resolves or initializes the 32-byte master encryption key.
 * If CONTRACK_SECRET_KEY is set in environment, it is validated and used.
 * Otherwise, DATA_DIR/secret.key is loaded or generated with file mode 0600.
 */
export function getOrInitSecretKey(dataDir: string = DATA_DIR): Buffer {
  if (process.env.CONTRACK_SECRET_KEY) {
    validateSecretKey(process.env.CONTRACK_SECRET_KEY);
    return Buffer.from(process.env.CONTRACK_SECRET_KEY, "hex");
  }

  if (cachedKey && dataDir === DATA_DIR) {
    return cachedKey;
  }

  const keyPath = path.join(dataDir, "secret.key");
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      const key = Buffer.from(raw, "hex");
      if (dataDir === DATA_DIR) cachedKey = key;
      return key;
    }
    const buf = fs.readFileSync(keyPath);
    if (buf.length === 32) {
      if (dataDir === DATA_DIR) cachedKey = buf;
      return buf;
    }
    throw new Error(`Invalid secret key in ${keyPath}: expected 32 bytes`);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const rawKey = crypto.randomBytes(32);
  const hexKey = rawKey.toString("hex");

  // Create with mode 0600 (owner read/write only)
  fs.writeFileSync(keyPath, hexKey, { mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Best effort on platforms that don't support POSIX chmod
  }

  if (dataDir === DATA_DIR) {
    cachedKey = rawKey;
  }
  return rawKey;
}

/**
 * Seals plaintext into "v1:" + base64(iv[12] + tag[16] + ciphertext).
 */
export function seal(plaintext: string, explicitKey?: Buffer): string {
  const key = explicitKey ?? getOrInitSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `v1:${payload}`;
}

/**
 * Opens a sealed string created by seal().
 * Throws SecretUnavailableError if tampering is detected or decryption fails.
 */
export function open(sealed: string, explicitKey?: Buffer): string {
  if (typeof sealed !== "string" || !sealed.startsWith("v1:")) {
    throw new SecretUnavailableError(
      "Invalid sealed secret: missing v1 prefix",
    );
  }

  const key = explicitKey ?? getOrInitSecretKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(sealed.slice(3), "base64");
  } catch (err) {
    throw new SecretUnavailableError("Invalid base64 encoding", err);
  }

  if (buf.length < 28) {
    throw new SecretUnavailableError("Sealed secret payload is too short");
  }

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new SecretUnavailableError(
      "Failed to decrypt secret: invalid key or corrupted data",
      err,
    );
  }
}

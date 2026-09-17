import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {
  seal,
  open,
  SecretUnavailableError,
  validateSecretKey,
  getOrInitSecretKey,
  __resetSecretKeyCache,
} from "../../server/utils/secretBox.ts";

describe("secretBox", () => {
  let tempDir: string;
  const originalEnv = process.env.CONTRACK_SECRET_KEY;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "secretbox-test-"));
    delete process.env.CONTRACK_SECRET_KEY;
    __resetSecretKeyCache();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CONTRACK_SECRET_KEY = originalEnv;
    } else {
      delete process.env.CONTRACK_SECRET_KEY;
    }
    __resetSecretKeyCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("performs seal and open round trip with default file key", () => {
    const key = getOrInitSecretKey(tempDir);
    const plaintext = "super-secret-smtp-password-123!";
    const sealed = seal(plaintext, key);

    expect(sealed).toMatch(/^v1:[A-Za-z0-9+/=]+$/);
    const unsealed = open(sealed, key);
    expect(unsealed).toBe(plaintext);
  });

  it("detects tampering with ciphertext or auth tag", () => {
    const key = getOrInitSecretKey(tempDir);
    const plaintext = "sensitive-content";
    const sealed = seal(plaintext, key);

    const payload = Buffer.from(sealed.slice(3), "base64");
    // Flip a bit in the ciphertext / tag
    payload[payload.length - 1] ^= 0x01;
    const tampered = `v1:${payload.toString("base64")}`;

    expect(() => open(tampered, key)).toThrow(SecretUnavailableError);
  });

  it("detects tampering with missing or wrong prefix", () => {
    const key = getOrInitSecretKey(tempDir);
    const sealed = seal("data", key);
    expect(() => open(sealed.slice(3), key)).toThrow(SecretUnavailableError);
    expect(() => open(`v2:${sealed.slice(3)}`, key)).toThrow(
      SecretUnavailableError,
    );
  });

  it("throws SecretUnavailableError when opened with a different key", () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);

    const sealed = seal("private-data", key1);
    expect(() => open(sealed, key2)).toThrow(SecretUnavailableError);
  });

  it("creates key file with 0600 permissions", () => {
    const key = getOrInitSecretKey(tempDir);
    expect(key.length).toBe(32);

    const keyPath = path.join(tempDir, "secret.key");
    expect(fs.existsSync(keyPath)).toBe(true);

    const stat = fs.statSync(keyPath);
    // 0o600: read & write for owner, none for group or others
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("refuses wrong-length env key with clear message", () => {
    expect(() => validateSecretKey("too-short")).toThrow(
      "CONTRACK_SECRET_KEY must be a 64-character hex string (32 bytes)",
    );

    // 63 characters (1 short)
    expect(() => validateSecretKey("a".repeat(63))).toThrow(
      "CONTRACK_SECRET_KEY must be a 64-character hex string (32 bytes)",
    );

    // 65 characters (1 long)
    expect(() => validateSecretKey("a".repeat(65))).toThrow(
      "CONTRACK_SECRET_KEY must be a 64-character hex string (32 bytes)",
    );

    // 64 characters but non-hex
    expect(() => validateSecretKey("g".repeat(64))).toThrow(
      "CONTRACK_SECRET_KEY must be a 64-character hex string (32 bytes)",
    );

    // Valid 64 hex characters does not throw
    const valid = crypto.randomBytes(32).toString("hex");
    expect(() => validateSecretKey(valid)).not.toThrow();
  });

  it("uses CONTRACK_SECRET_KEY from environment when set", () => {
    const valid = crypto.randomBytes(32).toString("hex");
    process.env.CONTRACK_SECRET_KEY = valid;

    const key = getOrInitSecretKey(tempDir);
    expect(key.toString("hex")).toBe(valid);

    const sealed = seal("from-env");
    expect(open(sealed)).toBe("from-env");
  });
});

// =============================================================================
// Unit: password hashing
// =============================================================================
// scrypt at the shipping cost parameters takes ~100ms per call, so these tests
// are deliberately not exhaustive about round-tripping — the interesting cases
// are the ones that must NOT throw, must NOT match, and must not depend on how
// a password was typed.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from "../../server/services/passwords.ts";

describe("hashPassword", () => {
  it("produces a self-describing scrypt string", async () => {
    const hash = await hashPassword("a reasonable password");
    const [algorithm, N, r, p, salt, digest] = hash.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(65536);
    expect(Number(r)).toBeGreaterThanOrEqual(8);
    expect(Number(p)).toBeGreaterThanOrEqual(1);
    expect(salt.length).toBeGreaterThan(0);
    expect(digest.length).toBeGreaterThan(0);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
    // ...and both still verify.
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("refuses an absurdly long password rather than grinding on it", async () => {
    await expect(
      hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1)),
    ).rejects.toThrow(/maximum/i);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true,
    );
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(
      false,
    );
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("treats a Unicode-equivalent password as the same password", async () => {
    // "é" composed as one code point vs. "e" + combining acute. The same key
    // press on different platforms can produce either.
    const composed = "café password";
    const decomposed = "café password";
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$only$four$parts",
      "bcrypt$65536$8$1$c2FsdA==$aGFzaA==",
      "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==",
      "scrypt$65536$8$1$$",
      // N must be a power of two — scrypt's own constraint.
      "scrypt$65537$8$1$c2FsdA==$aGFzaA==",
      // Refusing to allocate a gigabyte because a row said so.
      "scrypt$1073741824$64$1$c2FsdA==$aGFzaA==",
    ]) {
      await expect(
        verifyPassword("anything", bad),
        `hash: ${bad}`,
      ).resolves.toBe(false);
    }
  });

  it("rejects an over-long candidate without hashing it", async () => {
    const hash = await hashPassword("short enough");
    expect(
      await verifyPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), hash),
    ).toBe(false);
  });
});

describe("needsRehash", () => {
  it("is false for a freshly made hash", async () => {
    expect(needsRehash(await hashPassword("a password"))).toBe(false);
  });

  it("is true for weaker parameters than we now use", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(true);
  });

  it("is false for stronger parameters — never downgrade someone", () => {
    expect(needsRehash("scrypt$131072$8$1$c2FsdA==$aGFzaA==")).toBe(false);
  });

  it("is true for anything unparseable, so a corrupt row gets replaced", () => {
    expect(needsRehash("garbage")).toBe(true);
  });
});

describe("validatePassword", () => {
  it("accepts a long passphrase with no composition rules", () => {
    expect(validatePassword("all lowercase words no symbols")).toBeNull();
  });

  it("rejects too short, empty, whitespace, and non-strings", () => {
    expect(validatePassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(
      /at least/i,
    );
    expect(validatePassword("")).toMatch(/enter a password/i);
    expect(validatePassword("        ")).toMatch(/enter a password/i);
    expect(validatePassword(undefined)).toMatch(/enter a password/i);
    expect(validatePassword(12345678)).toMatch(/enter a password/i);
  });

  it("rejects one longer than we will hash", () => {
    expect(validatePassword("x".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(
      /at most/i,
    );
  });
});

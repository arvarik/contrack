// Password hashing: scrypt, with the cost carried in the hash. Not argon2id,
// the stronger choice, because argon2 is a native module, and every native
// dependency beyond better-sqlite3 is one more thing that can fail to build on
// somebody's NAS. scrypt is memory-hard, ships in node:crypto, and is on
// OWASP's list of acceptable choices. The stored string describes itself:
//
//     scrypt$16384$8$1$<salt-b64>$<hash-b64>
//            └─N─┘ │ │
//                  r p
//
// The parameters travel with the hash, so raising the cost later invalidates no
// password: verification uses what the stored string says, and `needsRehash`
// reports a hash made with weaker settings, so the caller can upgrade it at the
// next sign-in.

import crypto from "crypto";
import { promisify } from "util";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Current cost parameters. N=2^16 with r=8 costs about 64 MB and 100 ms per
 * hash on a modern laptop, slow on purpose: it is the whole defense against
 * somebody grinding a stolen database offline. It also bounds online guessing
 * to about ten attempts a second per core, beside the login rate limiter.
 */
const PARAMS = { N: 65536, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * scrypt refuses to run unless `maxmem` exceeds 128 * N * r, and Node's default
 * of 32 MB is well under these parameters. The factor of two is headroom for
 * p>1 should the parameters rise.
 */
function maxmemFor(N: number, r: number): number {
  return 256 * N * r;
}

/** Longest password we will hash. */
export const MAX_PASSWORD_LENGTH = 1024;

/** Shortest password we will accept. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Hash a password for storage.
 *
 * @returns a self-describing `scrypt$N$r$p$salt$hash` string
 */
export async function hashPassword(password: string): Promise<string> {
  // Unbounded input is a denial of service on a deliberately slow function: a
  // 100 MB "password" still moves 100 MB through scrypt.
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `Password exceeds the maximum of ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  const { N, r, p } = PARAMS;
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(normalize(password), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Check a password against a stored hash. False, not a throw, for a malformed
 * or unknown-algorithm hash: a corrupted row reads as "wrong password" rather
 * than crashing the login route and telling an attacker they found something.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const parsed = parseHash(stored);
  if (!parsed) return false;

  const { N, r, p, salt, hash } = parsed;
  let derived: Buffer;
  try {
    derived = await scrypt(normalize(password), salt, hash.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    // Parameters out of range for this Node build — treat as a failed match
    // rather than a 500.
    return false;
  }
  // Lengths are equal by construction (we derived to hash.length), but
  // timingSafeEqual throws on a mismatch, so this stays defensive.
  if (derived.length !== hash.length) return false;
  return crypto.timingSafeEqual(derived, hash);
}

/**
 * True when `stored` used weaker parameters than the current ones, so the
 * caller should re-hash after a successful verify.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

/**
 * Unicode-normalize before hashing: one password typed on two keyboards can
 * arrive as different bytes (an accented letter as one code point on macOS and
 * two on Linux), and NFKC folds them together.
 */
function normalize(password: string): string {
  return password.normalize("NFKC");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [algorithm, rawN, rawR, rawP, saltB64, hashB64] = parts;
  if (algorithm !== "scrypt") return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  // N must be a power of two above one (scrypt's own rule); the rest is sanity,
  // so a corrupted row cannot ask for gigabytes of memory.
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 64) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  if (maxmemFor(N, r) > 1024 * 1024 * 1024) return null;

  let salt: Buffer;
  let hash: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    hash = Buffer.from(hashB64, "base64");
  } catch {
    return null;
  }
  if (salt.length === 0 || hash.length === 0) return null;

  return { N, r, p, salt, hash };
}

/**
 * Refuse a password that is too short or only whitespace. No composition rule
 * ("one uppercase, one digit, one symbol"): those push people toward
 * `Password1!`, NIST no longer recommends them, and length is what helps.
 *
 * @returns an error message, or null when the password is acceptable
 */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.trim().length === 0) {
    return "Enter a password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

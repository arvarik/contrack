// =============================================================================
// Password hashing — scrypt, with the cost parameters carried in the hash
// =============================================================================
// scrypt rather than argon2id, which is the stronger recommendation, because
// argon2 means a native module. This app already pays for one (better-sqlite3)
// and every extra native dependency is another thing that can fail to build on
// somebody's NAS. scrypt is memory-hard, ships in node:crypto, and is on
// OWASP's list of acceptable choices — the right trade for self-hosted.
//
// The stored string is self-describing:
//
//     scrypt$16384$8$1$<salt-b64>$<hash-b64>
//            └─N─┘ │ │
//                  r p
//
// Parameters travel WITH the hash rather than living in a constant, which is
// the whole point: raising the cost later does not invalidate anyone's
// password. Verification uses whatever the stored string says, and
// `needsRehash` reports when a hash was made with weaker settings than the
// current ones so the caller can quietly upgrade it on next sign-in.
// =============================================================================

import crypto from "crypto";
import { promisify } from "util";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Current cost parameters.
 *
 * N=2^16 with r=8 costs ~64 MB and ~100 ms per hash on a modern laptop. That
 * is deliberately slow — it is the entire defence against someone who has
 * stolen the database file and is grinding the hash offline. It also bounds
 * online guessing to roughly ten attempts a second per core, on top of the
 * rate limiter in front of the login route.
 */
const PARAMS = { N: 65536, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * scrypt needs `maxmem` above 128 * N * r or it refuses to run; the Node
 * default is 32 MB, well under what these parameters ask for. The factor of
 * two is headroom for the p>1 case if the parameters are ever raised.
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
  // Unbounded input is a denial-of-service vector on a deliberately expensive
  // function: scrypt's cost is dominated by N and r, but hashing a 100 MB
  // "password" still means moving 100 MB through it.
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
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing for a malformed or unknown-algorithm
 * hash: a corrupted row should read as "wrong password", not crash the login
 * route and tell an attacker they found something interesting.
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
 * True when `stored` was produced with weaker parameters than the current
 * ones, so the caller should re-hash after a successful verify.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < PARAMS.N || parsed.r < PARAMS.r || parsed.p < PARAMS.p;
}

/**
 * Unicode-normalize before hashing.
 *
 * The same password typed on two keyboards can arrive as different byte
 * sequences — an accented character composed as one code point on macOS and
 * two on Linux. NFKC folds those together so a password set on one machine
 * still verifies on another.
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
  // N must be a power of two greater than one, which is scrypt's own
  // constraint; the rest is basic sanity so a corrupted row cannot ask for
  // gigabytes of memory.
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
 * Reject passwords that are too short or made entirely of whitespace.
 *
 * Deliberately not a composition rule ("one uppercase, one digit, one symbol").
 * Those push people toward `Password1!` and are no longer recommended by NIST;
 * length is what actually helps, and this is a self-hosted app whose owner is
 * the only person affected by their own choice.
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

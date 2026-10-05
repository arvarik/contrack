// =============================================================================
// Server Helpers — Lightweight Utilities
// =============================================================================
// This file is intentionally minimal. Domain logic lives in:
//   - server/repositories/contactRepository.ts  (hydration + child persistence)
//   - server/utils/nlp/index.ts                  (name similarity, nicknames, etc.)
//   - server/utils/AppError.ts                   (typed application errors)
//   - server/middleware/errorHandler.ts          (Express error translation)
//
// URL utilities (detectPlatformFromUrl, extractHandleFromUrl) live in
// contactRepository.ts — the sole consumer.
// =============================================================================

/**
 * Whitelist of contact-table columns this server accepts in PATCH /api/contacts/:id
 * payloads. New scalar contact columns MUST be added here or they will be
 * silently dropped. Relations (emails, phones, etc.) are persisted separately
 * by {@link ContactRepository.insertChildRecords}.
 *
 * Kept as `const` so callers and tests get the exact tuple type rather than
 * a generic `readonly string[]`.
 */
const UPDATABLE_CONTACT_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "headline",
  "role",
  "company",
  "location",
  "lat",
  "lng",
  "isGhost",
  "birthday",
  "preferences",
  "avatarUrl",
  "cadenceDays",
  "lastContactedAt",
  // `nextFollowUpAt` is deliberately absent: the follow-up tasks set it, and
  // a date in a write becomes a task (`followUpTo` in contactService).
  "themeColor",
  "about",
  "pronouns",
  "industry",
  "website",
  "isArchived",
  // `trackedAt` is deliberately absent: only the database triggers write it.
  "isTracked",
  "aiBriefing",
  "aiBriefingAt",
  "aiBackground",
  "aiSummary",
  "aiHydratedAt",
] as const;

/**
 * Build a Drizzle/SQL UPDATE payload from an arbitrary request body.
 *
 * Rules:
 * - Only fields enumerated in {@link UPDATABLE_CONTACT_FIELDS} are forwarded.
 *   Unknown fields (typos, frontend mistakes, attempts to set computed columns
 *   like `relationshipScore`) are silently dropped — the caller's Zod schema
 *   is the source of truth for what's accepted.
 * - JavaScript `boolean` values are coerced to integer `0` / `1` because
 *   SQLite (via better-sqlite3) refuses to bind native booleans.
 * - `undefined` values are skipped so partial updates don't blow away
 *   existing columns. To explicitly null a column, pass `null`.
 * - `updatedAt` is ALWAYS stamped to `new Date().toISOString()` so the
 *   column reflects the most recent successful write.
 *
 * @param body - Untrusted request body. The caller is expected to have run
 *   Zod validation already; this function is the second filter (allow-list).
 * @returns A SQLite-bind-safe object containing only the columns to update,
 *   plus `updatedAt`. Always at minimum `{ updatedAt: string }`.
 *
 * @example
 * ```ts
 * buildContactUpdate({ name: "Alex", isArchived: true, hackerField: 1 });
 * // → { name: "Alex", isArchived: 1, updatedAt: "2026-05-14T…Z" }
 * ```
 */
export function buildContactUpdate(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  for (const f of UPDATABLE_CONTACT_FIELDS) {
    if (body[f] !== undefined) {
      // SQLite can't bind JS booleans — coerce to 0/1
      update[f] = typeof body[f] === "boolean" ? (body[f] ? 1 : 0) : body[f];
    }
  }
  return update;
}

/**
 * Extract a human-readable error message from an unknown thrown value.
 *
 * TypeScript's `catch` clauses receive `unknown` by default (the safer
 * alternative to the legacy `any` typing). This helper is a one-liner
 * replacement for the boilerplate `err instanceof Error ? err.message :
 * String(err)` pattern that previously appeared at every call site.
 *
 * @param err - Anything `throw`n: an `Error` instance, a string, an object,
 *   `null`, `undefined`, or arbitrary JS values.
 * @returns The error's `message` when `err` is an `Error`; otherwise
 *   `String(err)` (which yields `"undefined"`, `"null"`, `"[object Object]"`,
 *   numeric string representations, etc.).
 *
 * @example
 * ```ts
 * try {
 *   await callExternalApi();
 * } catch (err: unknown) {
 *   log.error("contactService", getErrorMessage(err));
 * }
 * ```
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * A URL safe to write to a log: the path alone, with no query string.
 *
 * The query string carries the secrets and the personal text. An invitation,
 * a password reset and a sign-in link put their token there
 * (`/join?token=<secret>`), and the invitee's browser sends it to this server
 * as an ordinary page request. The palette search sends what a person typed
 * (`/api/search?q=<name>`), a link preview the URL a person pasted, and a
 * failed Google sign-in its `code` and `state`. The access log and the error
 * log keep the path, which names the route and the ids.
 */
export function redactUrlForLog(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

// Small server helpers. Domain logic lives in contactRepository.ts (hydration
// and child rows, URL utilities), utils/nlp/ (names), AppError.ts and
// middleware/errorHandler.ts.

import crypto from "crypto";

/**
 * Lowercase ASCII slug for a contact's name, capped at 32 characters so a
 * long name or email address still makes a readable URL path.
 */
export function contactSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug || "contact";
}

/**
 * Human-readable contact ID (`<name-slug>-<8-hex>`) with a short random suffix
 * so two people with the same name never share an ID or URL.
 */
export function newContactId(name: string): string {
  return `${contactSlug(name)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The contact columns PATCH /api/contacts/:id may set. A new scalar contact
 * column must be added here or it is dropped. Relations (emails, phones and the
 * rest) go through {@link ContactRepository.insertChildRecords}. `const` keeps
 * the exact tuple type.
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
 * Build an SQL UPDATE payload from a request body:
 * - Only fields in {@link UPDATABLE_CONTACT_FIELDS} pass; anything else (a
 *   typo, a computed column like `relationshipScore`) is dropped. The caller's
 *   Zod schema decides what is accepted, and this is the second filter.
 * - `boolean` becomes `0` / `1`, because better-sqlite3 cannot bind booleans.
 * - `undefined` is skipped, so a partial update leaves other columns alone.
 *   Pass `null` to clear one.
 * - `updatedAt` is always stamped.
 *
 * @param body - Untrusted request body, already validated by Zod.
 * @returns The columns to update plus `updatedAt`, safe to bind.
 *
 * @example
 *   buildContactUpdate({ name: "Alex", isArchived: true, hackerField: 1 });
 *   // → { name: "Alex", isArchived: 1, updatedAt: "2026-05-14T…Z" }
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
 * The message of an unknown thrown value: `err.message` for an `Error`, else
 * `String(err)`.
 *
 * @param err - Anything thrown: an `Error`, a string, an object, `null`,
 *   `undefined`.
 * @returns The error's message, or `String(err)`.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * A URL safe to log: the path alone, with no query string. The query string
 * carries secrets and personal text: invitation, password reset and sign-in
 * tokens (`/join?token=<secret>`), what a person typed in the palette
 * (`/api/search?q=<name>`), a pasted link preview URL, and a failed Google
 * sign-in's `code` and `state`. The path still names the route and the ids.
 */
export function redactUrlForLog(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

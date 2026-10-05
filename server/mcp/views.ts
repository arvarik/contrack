/**
 * server/mcp/views.ts — What a tool sends back of a row.
 *
 * Every field a tool returns costs the client tokens, and a client may cut a
 * long answer short. A row from the services holds columns that only the
 * server reads, such as the owner, the search fields and the merge links, so
 * no tool sends those. A search hit or a list row is a summary, and
 * get_contact sends the whole profile.
 *
 * @module server/mcp/views
 */

/** Columns only the server reads. They are `INTERNAL` in shared/contracts. */
const INTERNAL = new Set([
  "ownerId",
  "searchExpansion",
  "deletedAt",
  "canonicalId",
  "phoneticHash",
  "scoreDirty",
]);

/** Fields that only draw the app: a picture path and a colour. */
const DRAWING = new Set([
  "avatarUrl",
  "themeColor",
  "contactAvatarUrl",
  "contactThemeColor",
]);

/** Profile columns that track research and geocoding, not the person. */
const BOOKKEEPING = new Set([
  "aiResearch",
  "aiHydratedAt",
  "aiBriefingAt",
  "geoSource",
  "lat",
  "lng",
  "isGhost",
]);

/**
 * The fields of a contact in a list or a search hit. list_contacts selects
 * these columns in SQL. A search hit adds why it matched.
 */
export const CONTACT_SUMMARY_FIELDS = [
  "id",
  "name",
  "headline",
  "role",
  "company",
  "location",
  "industry",
  "isTracked",
  "cadenceDays",
  "lastContactedAt",
  "nextFollowUpAt",
  "isArchived",
  "addedAt",
  "updatedAt",
] as const;

/** Every key no answer sends, at any depth. `highlights` are UI offsets. */
const STRIPPED = new Set([...INTERNAL, ...DRAWING, "highlights"]);

/**
 * A value without the fields only the server or the app reads, at every
 * depth: a follow-up inside the Pulse, a note's contact. `answer()` sends
 * everything through this, and so do the resources and the prompts.
 */
export function lean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lean);
  if (value === null || typeof value !== "object") return value;
  // Only plain records are rebuilt. A Date or a Buffer goes as JSON writes it.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !STRIPPED.has(key))
      .map(([key, inner]) => [key, lean(inner)]),
  );
}

/** A contact's whole profile, as get_contact and the resource send it. */
export function contactProfile(contact: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(lean(contact) as Record<string, unknown>).filter(
      ([key]) => !BOOKKEEPING.has(key),
    ),
  );
}

/** A contact as a search hit: the summary, and why it matched. */
export function contactSummary(
  contact: object & { matchedOn?: unknown; aiReason?: unknown },
): Record<string, unknown> {
  const row = contact as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of CONTACT_SUMMARY_FIELDS) summary[key] = row[key] ?? null;
  if (contact.matchedOn) summary.matchedOn = contact.matchedOn;
  if (contact.aiReason) summary.aiReason = contact.aiReason;
  return summary;
}

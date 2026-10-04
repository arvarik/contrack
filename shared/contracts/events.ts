// =============================================================================
// Domain events: one payload schema per event type
// =============================================================================
// A write records an event in its own transaction (server/events/record.ts),
// and `recordEvent` parses the payload with the schema of its type before the
// row is written. The same schemas will describe outbound webhooks, and the
// table keeps a row for 30 days, so a payload carries ids, field names and
// facts about the write. It never carries a name, an email, an address or any
// other contact data: a subscriber that needs a value reads the row.
//
// Every schema is strict, so a key that is not listed here fails the write in
// tests rather than reaching the table.
// =============================================================================

import { z } from "zod";

const id = z.string().min(1).max(200);

/**
 * The names of the fields a write set, never their values. Contact fields
 * use the request names, relation names included (`tags`, `addresses` and
 * the others of RELATION_REGISTRY).
 */
const fieldNames = z
  .array(
    z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*$/)
      .max(64),
  )
  .min(1);

/** What an event is about. */
export const EVENT_SUBJECT_TYPES = [
  "contact",
  "interaction",
  "action_item",
  "list",
] as const;
export type EventSubjectType = (typeof EVENT_SUBJECT_TYPES)[number];

export const EVENT_SCHEMAS = {
  /**
   * A contact was added.
   *
   * `origin` says how. `manual` is one contact added in the app, through the
   * API or by an MCP client. `connector` is one added by a sync. `import` is
   * one row of a file import, which runs its own duplicate pass for the
   * whole file. `mention` is a ghost made from a name in a note.
   *
   * `autoEnrich` is true only when a person added the contact and the
   * caller allowed "Enrich new contacts automatically" to research it.
   */
  "contact.created": z.strictObject({
    origin: z.enum(["manual", "connector", "import", "mention"]),
    autoEnrich: z.boolean(),
  }),
  /**
   * A contact's fields changed. `changed` names what the write set. `bulk`
   * is true for one contact of a bulk edit, which reacts as a batch: no
   * per-row duplicate check or dedupe vector, and the route scores the batch.
   */
  "contact.updated": z.strictObject({
    changed: fieldNames,
    bulk: z.boolean(),
  }),
  /**
   * A contact left the list. `permanent` is false for a move to the trash
   * and true for a delete that cannot be undone.
   */
  "contact.deleted": z.strictObject({ permanent: z.boolean() }),
  /** A contact came back from the trash. */
  "contact.restored": z.strictObject({}),
  /**
   * Two contacts became one. The subject is the contact that stays, and
   * `duplicateId` the one that was folded into it.
   */
  "contact.merged": z.strictObject({
    duplicateId: id,
    mergedBy: z.enum(["user", "auto"]),
  }),
  "interaction.created": z.strictObject({ contactId: id }),
  "interaction.updated": z.strictObject({
    contactId: id,
    changed: fieldNames,
  }),
  "interaction.deleted": z.strictObject({ contactId: id }),
  /** `interactionId` is the note the task was made with, or null. */
  "action_item.created": z.strictObject({
    contactId: id,
    interactionId: id.nullable(),
  }),
  "action_item.updated": z.strictObject({
    contactId: id,
    changed: fieldNames,
  }),
  "action_item.completed": z.strictObject({ contactId: id }),
  "action_item.deleted": z.strictObject({ contactId: id }),
  /** Contacts joined or left a list. Both arrays hold contact ids. */
  "list.members_changed": z.strictObject({
    added: z.array(id),
    removed: z.array(id),
  }),
} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;

export const EVENT_TYPES = Object.keys(EVENT_SCHEMAS) as EventType[];

export type EventPayload<T extends EventType> = z.infer<
  (typeof EVENT_SCHEMAS)[T]
>;

/** The subject type of an event type: the part before the dot. */
export function subjectTypeOf(type: EventType): EventSubjectType {
  return type.slice(0, type.indexOf(".")) as EventSubjectType;
}

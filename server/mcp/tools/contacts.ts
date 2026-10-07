/**
 * Contact MCP tools: get_contact, list_contacts, create_contact,
 * update_contact.
 *
 * @module server/mcp/tools/contacts
 */

import { z } from "zod";
import type { McpToolContext } from "../../modules/module.ts";
import { contactService } from "../../services/contactService.ts";
import { relationshipService } from "../../services/relationshipService.ts";
import { mcpService, type ContactMatch } from "../../services/mcpService.ts";
import type { ContactPayload } from "../../repositories/types.ts";
import { AppError, NotFoundError } from "../../utils/AppError.ts";
import { normalizePhone } from "../../utils/nlp/phone.ts";
import { contactRoutes } from "../../../shared/contracts/contacts.ts";
import { answer, count, cursorInput, offsetOf } from "../tool.ts";
import { CONTACT_SUMMARY_FIELDS, contactProfile } from "../views.ts";

/**
 * What list_contacts returns for each contact. The row holds more, such as
 * the research record and the search fields, which cost a client tokens and
 * tell it nothing. get_contact returns the whole profile.
 */
const LIST_FIELDS = CONTACT_SUMMARY_FIELDS.join(",");

/**
 * create_contact's refusal of an email or phone a contact already has. The
 * message names the contact, because some clients show their model the
 * message and nothing else.
 */
function duplicateError(matches: ContactMatch[]): AppError {
  const held = matches.map(
    (m) =>
      `${m.name} (${m.id}${m.isArchived ? ", archived" : ""}) has ${m.matched}`,
  );
  return new AppError(
    `A contact already has this email or phone: ${held.join("; ")}. Change that contact with update_contact, or set allowDuplicate to create another.`,
    409,
    { code: "DUPLICATE_CONTACT", details: { matches } },
  );
}

/** One email, phone or tag, with the fields the contact form keeps. */
interface Entry {
  value: string;
  label?: string;
  isPrimary?: boolean;
}

/**
 * A contact's emails, phones or tags with `add` appended and `remove` taken
 * out. `key` says when two are the same: an email or a tag ignoring case, a
 * phone by its digits. updateContact saves the whole list, as the contact form
 * does, so every entry the caller did not name stays. When the primary one
 * goes, the first one left becomes primary.
 */
function edit(
  entries: Entry[],
  key: (value: string) => string,
  add: string[] = [],
  remove: string[] = [],
): Entry[] {
  const gone = new Set(remove.map(key));
  const kept = entries.filter((entry) => !gone.has(key(entry.value)));
  for (const value of add) {
    if (!kept.some((entry) => key(entry.value) === key(value))) {
      kept.push({ value: value.trim() });
    }
  }
  if (kept.length > 0 && !kept.some((entry) => entry.isPrimary)) {
    kept[0] = { ...kept[0], isPrimary: true };
  }
  return kept;
}

const lower = (value: string) => value.trim().toLowerCase();

// The REST bodies of the same writes, so a profile field is checked exactly as
// `POST /api/contacts` and `PUT /api/contacts/:id` check it. Emails, phones,
// tags and the tracking flag keep the tools' own shapes: the REST bodies also
// take bare strings and "true" or "1", which a model does not need to see.
const createBody = contactRoutes.create.body.shape;
const updateBody = contactRoutes.replace.body.shape;

export function registerContactTools({ tool, scope }: McpToolContext): void {
  tool(
    "get_contact",
    {
      id: z.string().min(1).describe("The contact ID to look up"),
    },
    async ({ id }) => {
      const contact = contactService.getContactById(scope, id);
      if (!contact) {
        throw new NotFoundError("Contact", id);
      }
      const work = [contact.role, contact.company].filter(Boolean).join(" at ");
      return answer(work ? `${contact.name}, ${work}` : contact.name, {
        contact: contactProfile(contact),
        scoreExplanation: relationshipService.explainScore(id),
      });
    },
  );

  tool(
    "list_contacts",
    {
      cursor: cursorInput,
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .optional()
        .describe("Maximum contacts to return (default 50, max 100)"),
      role: z.string().optional().describe("Filter contacts by role"),
      company: z.string().optional().describe("Filter contacts by company"),
      industry: z.string().optional().describe("Filter contacts by industry"),
      location: z
        .string()
        .optional()
        .describe("Filter contacts by location, a partial match"),
      tag: z
        .string()
        .optional()
        .describe("Filter by a tag, without regard to case"),
      list: z
        .string()
        .optional()
        .describe("Filter by a list's ID or its whole name"),
      email: z
        .string()
        .email()
        .optional()
        .describe("Only the contacts with this email, without regard to case"),
      phone: z
        .string()
        .min(1)
        .optional()
        .describe("Only the contacts with this phone number, by its digits"),
      updatedSince: z
        .string()
        .optional()
        .describe("Filter contacts updated at or after this ISO timestamp"),
      tracked: z
        .boolean()
        .optional()
        .describe(
          "true for the people the account keeps up with, false for everyone else",
        ),
    },
    async (params) => {
      const limit = params.limit ?? 50;
      const offset = offsetOf(params.cursor);
      // One more than the page, to know whether another page follows.
      const rows = mcpService.queryContacts(scope, {
        limit: limit + 1,
        offset,
        fields: LIST_FIELDS,
        role: params.role,
        company: params.company,
        industry: params.industry,
        updatedSince: params.updatedSince,
        tracked: params.tracked,
        location: params.location,
        tag: params.tag,
        list: params.list,
        email: params.email,
        phone: params.phone,
      });
      const nextCursor = rows.length > limit ? String(offset + limit) : null;
      // The query reads the flags as SQLite's 0 and 1. Every other tool sends
      // them as booleans.
      const contacts = rows.slice(0, limit).map((row) => ({
        ...row,
        isTracked: row.isTracked === 1,
        isArchived: row.isArchived === 1,
      }));
      return answer(count(contacts.length, "contact"), {
        contacts,
        nextCursor,
      });
    },
  );

  tool(
    "create_contact",
    {
      name: createBody.name.describe("Full name of the contact"),
      headline: createBody.headline.describe("Professional headline"),
      role: createBody.role.describe("Job title or role"),
      company: createBody.company.describe("Company or organization"),
      location: createBody.location.describe("Location or city"),
      about: createBody.about.describe("Bio or background notes"),
      industry: createBody.industry.describe("Industry"),
      emails: z
        .array(
          z.object({
            email: z.string().email(),
            label: z.string().optional(),
            isPrimary: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Email addresses"),
      phones: z
        .array(
          z.object({
            phone: z.string(),
            label: z.string().optional(),
            isPrimary: z.boolean().optional(),
          }),
        )
        .optional()
        .describe("Phone numbers"),
      tags: z
        .array(z.object({ tag: z.string() }))
        .optional()
        .describe("Tags to attach"),
      allowDuplicate: z
        .boolean()
        .optional()
        .describe(
          "Create the contact even when a contact already has one of its emails or phones",
        ),
    },
    async ({ allowDuplicate, ...body }) => {
      if (!allowDuplicate) {
        const matches = mcpService.findByEmailOrPhone(
          scope,
          (body.emails ?? []).map((e) => e.email),
          (body.phones ?? []).map((p) => p.phone),
        );
        if (matches.length > 0) throw duplicateError(matches);
      }
      // No `autoEnrich`: "Enrich new contacts automatically" researches the
      // contacts a person adds, not the ones an MCP client adds.
      const contact = contactService.createContact(scope, body);
      if (!contact) {
        throw new AppError("Failed to create contact", 500);
      }
      return answer(
        `Created contact ${contact.name} (${contact.id})`,
        contactProfile(contact),
      );
    },
  );

  tool(
    "update_contact",
    {
      id: z.string().min(1).describe("Contact ID to update"),
      fields: z
        .object({
          name: updateBody.name,
          role: updateBody.role,
          company: updateBody.company,
          location: updateBody.location,
          headline: updateBody.headline,
          about: updateBody.about,
          industry: updateBody.industry,
          themeColor: updateBody.themeColor,
          isTracked: z
            .boolean()
            .optional()
            .describe("Keep up with this person (true) or stop (false)"),
          // The REST rule without its null: a tracked contact with no
          // cadence never comes due, so a model may not clear it.
          cadenceDays: createBody.cadenceDays
            .unwrap()
            .unwrap()
            .optional()
            .describe("How often to keep up, in days: 30, 60, 90, 180 or 365"),
          addEmails: z
            .array(z.string().email())
            .optional()
            .describe("Emails to add. The contact keeps its others"),
          removeEmails: z
            .array(z.string())
            .optional()
            .describe("Emails to remove, without regard to case"),
          addPhones: z
            .array(z.string().min(1))
            .optional()
            .describe("Phone numbers to add. The contact keeps its others"),
          removePhones: z
            .array(z.string())
            .optional()
            .describe("Phone numbers to remove, matched by their digits"),
          addTags: z
            .array(z.string().trim().min(1))
            .optional()
            .describe("Tags to add. The contact keeps its others"),
          removeTags: z
            .array(z.string())
            .optional()
            .describe("Tags to remove, without regard to case"),
        })
        .describe("Fields to update on the contact"),
    },
    async ({ id, fields }) => {
      const {
        addEmails,
        removeEmails,
        addPhones,
        removePhones,
        addTags,
        removeTags,
        ...scalars
      } = fields;
      const body: ContactPayload = { ...scalars };

      if (
        addEmails ||
        removeEmails ||
        addPhones ||
        removePhones ||
        addTags ||
        removeTags
      ) {
        const current = contactService.getContactById(scope, id);
        if (!current) throw new NotFoundError("Contact", id);
        if (addEmails || removeEmails) {
          body.emails = edit(
            current.emails.map((e) => ({
              value: e.email,
              label: e.label ?? undefined,
              isPrimary: e.isPrimary,
            })),
            lower,
            addEmails,
            removeEmails,
          ).map(({ value, label, isPrimary }) => ({
            email: value,
            label,
            isPrimary,
          }));
        }
        if (addPhones || removePhones) {
          body.phones = edit(
            current.phones.map((p) => ({
              value: p.phone,
              label: p.label ?? undefined,
              isPrimary: p.isPrimary,
            })),
            normalizePhone,
            addPhones,
            removePhones,
          ).map(({ value, label, isPrimary }) => ({
            phone: value,
            label,
            isPrimary,
          }));
        }
        if (addTags || removeTags) {
          body.tags = edit(
            current.tags.map((t) => ({ value: t.tag })),
            lower,
            addTags,
            removeTags,
          ).map(({ value }) => ({ tag: value }));
        }
      }

      const updated = contactService.updateContact(scope, id, body);
      if (!updated) {
        throw new NotFoundError("Contact", id);
      }
      return answer(
        `Updated contact ${updated.name} (${updated.id})`,
        contactProfile(updated),
      );
    },
  );
}

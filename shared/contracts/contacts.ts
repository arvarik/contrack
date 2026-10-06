// =============================================================================
// Contracts: contacts
// =============================================================================
// Every route under /api/contacts except the interaction and action-item
// routes nested under a contact (interactions.ts, actionItems.ts): the
// contact itself, the list views, bulk writes, the pin, the photo, the
// research run and the merges.
//
// The answers describe the rows as the server sends them, internal columns
// included (`ownerId`, `phoneticHash`, `scoreDirty`, `searchExpansion`,
// `canonicalId`, `deletedAt`). Those are marked `INTERNAL`, so the OpenAPI
// file tells a client not to rely on them.
// =============================================================================

import { z } from "zod";
import { researchDepthSchema } from "../researchDepth.ts";
import { route } from "./route.ts";
import {
  childRecordsSchema,
  dateSchema,
  emailSchema,
  idsSchema,
  INTERNAL,
  phoneSchema,
  queryText,
  stringToBool,
} from "./common.ts";

// =============================================================================
// Request bodies
// =============================================================================

/** Payload for POST /contacts (Contact creation) */
export const contactCreateSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(300),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    headline: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    industry: z.string().nullable().optional(),
    about: z.string().nullable().optional(),
    aiSummary: z.string().nullable().optional(),
    aiBackground: z.string().nullable().optional(),
    aiBriefing: z.string().nullable().optional(),
    aiBriefingAt: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    themeColor: z.string().nullable().optional(),
    preferences: z.string().nullable().optional(),
    birthday: z.string().nullable().optional(),
    pronouns: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    cadenceDays: z.number().int().positive().nullable().optional(),
    isGhost: stringToBool,
    isArchived: stringToBool,
    /** A person chose to keep up with this contact. See server/db.ts §2z-0. */
    isTracked: stringToBool,
    nextFollowUpAt: dateSchema.nullable().optional(),
  })
  .merge(childRecordsSchema);

const contactUpdateSchema = contactCreateSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "No valid fields to update",
  });

/**
 * The body of `PATCH /api/contacts/:id/location`: a pin a person dropped, or
 * a request to hand the pin back to the geocoder. One or the other, with
 * nothing else beside it, so a body that carries both, or a coordinate the
 * map cannot draw, is refused whole.
 */
const contactLocationSchema = z.union([
  z.strictObject({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  z.strictObject({ regeocode: z.literal(true) }),
]);

/**
 * The items of a list an import can read. An import keeps the emails and
 * phones that are real and leaves out the rest: one "n/a" in a file of
 * 5,000 rows must not refuse the whole file.
 */
const readable = (item: z.ZodType) =>
  z
    .preprocess(
      (list) =>
        Array.isArray(list)
          ? list.filter((value) => item.safeParse(value).success)
          : list,
      z.array(item).max(100),
    )
    .optional()
    .describe("An item that cannot be read is left out, and the rest saves");

// Cap bulk imports — combined with the 50 MB JSON body limit, an unbounded
// array lets one request allocate arbitrary memory.
const contactBulkCreateSchema = z
  .array(
    contactCreateSchema.extend({
      emails: readable(emailSchema),
      phones: readable(phoneSchema),
    }),
  )
  .max(5000);

/**
 * The child arrays, which a bulk edit refuses. The same ten keys as
 * `RELATION_REGISTRY` in `server/repositories/contactRepository.ts`.
 */
const CHILD_KEYS = Object.keys(childRecordsSchema.shape);

/** A merge keeps one contact, so a contact cannot be merged into itself. */
const mergeBodySchema = z
  .object({
    primaryId: z
      .string({ error: "primaryId and duplicateId are required" })
      .min(1, "primaryId and duplicateId are required"),
    duplicateId: z
      .string({ error: "primaryId and duplicateId are required" })
      .min(1, "primaryId and duplicateId are required"),
  })
  .refine((body) => body.primaryId !== body.duplicateId, {
    message: "Cannot merge a contact with itself",
  });

const mergeClusterBodySchema = z
  .object({
    primaryId: z
      .string({ error: "primaryId and duplicateIds[] are required" })
      .min(1, "primaryId and duplicateIds[] are required"),
    duplicateIds: z
      .array(z.string(), { error: "primaryId and duplicateIds[] are required" })
      .min(1, "primaryId and duplicateIds[] are required")
      .max(10, "Maximum 10 duplicates per cluster merge"),
  })
  .refine((body) => !body.duplicateIds.includes(body.primaryId), {
    message: "primaryId cannot appear in duplicateIds",
  });

/**
 * A batch of cluster merges. A cluster whose primary or duplicates are absent
 * or empty is not refused: the answer lists it with nothing merged and each
 * of its duplicates counted as failed, beside the clusters that merged. A
 * value of the wrong type, such as a null primary or duplicates given as a
 * string, refuses the whole batch with 400, and so does a cluster whose
 * primary is one of its own duplicates.
 */
const mergeClustersBodySchema = z
  .object({
    clusters: z
      .array(
        z.object({
          primaryId: z.string().optional(),
          duplicateIds: z.array(z.string()).optional(),
        }),
        { error: "clusters array is required and must not be empty" },
      )
      .min(1, "clusters array is required and must not be empty"),
  })
  .refine(
    (body) =>
      body.clusters.reduce(
        (sum, cluster) => sum + (cluster.duplicateIds?.length ?? 0),
        0,
      ) <= 250,
    { message: "Maximum 250 total merge operations per batch" },
  )
  .refine(
    (body) =>
      body.clusters.every(
        (cluster) =>
          !cluster.primaryId ||
          !cluster.duplicateIds?.includes(cluster.primaryId),
      ),
    { message: "primaryId cannot appear in duplicateIds" },
  );

// =============================================================================
// Answers
// =============================================================================

const contactEmailSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  label: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
  /** Where the address came from: "manual", a connector's kind, or null. */
  source: z.string().nullable(),
});

const contactPhoneSchema = z.strictObject({
  id: z.string(),
  /** As it was entered or imported, not normalized. */
  phone: z.string(),
  label: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
  source: z.string().nullable(),
});

const contactAddressSchema = z.strictObject({
  id: z.string(),
  address: z.string(),
  label: z.string(),
  isPrimary: z.boolean(),
  sortOrder: z.number().int(),
  source: z.string().nullable(),
});

const contactSocialLinkSchema = z.strictObject({
  id: z.string(),
  /** "linkedin", "twitter", "github" and the like, or "other". */
  platform: z.string(),
  url: z.string(),
  handle: z.string().nullable(),
  source: z.string().nullable(),
});

const contactEducationSchema = z.strictObject({
  id: z.string(),
  school: z.string(),
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  description: z.string().nullable(),
});

const contactExperienceSchema = z.strictObject({
  id: z.string(),
  company: z.string(),
  role: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  description: z.string().nullable(),
  location: z.string().nullable(),
});

const contactSourceSchema = z.strictObject({
  id: z.string(),
  platform: z.string(),
  externalId: z.string().nullable(),
  connectedOn: z.string().nullable(),
  importedAt: z.string().nullable(),
});

const contactTagSchema = z.strictObject({ id: z.string(), tag: z.string() });

const contactInterestSchema = z.strictObject({
  id: z.string(),
  interest: z.string(),
  /** 1 for an interest research added, 0 for one a person added. */
  isAiGenerated: z.number().int().nullable(),
});

const contactAttributeSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  value: z.string(),
});

/** A list the contact belongs to, as the contact names it. */
const contactListRefSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
});

/** Who placed the pin: the geocoder, a person, or nobody yet. */
const geoSourceSchema = z.enum(["geocoder", "manual"]).nullable();

/** The columns of a `contacts` row, with the three flags read as booleans. */
const contactColumns = {
  id: z.string(),
  name: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  headline: z.string().nullable(),
  role: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  birthday: z.string().nullable(),
  preferences: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  addedAt: z.string(),
  updatedAt: z.string(),
  /** Null only after a write that sent `cadenceDays: null`. */
  cadenceDays: z.number().int().nullable(),
  lastContactedAt: z.string().nullable(),
  nextFollowUpAt: z.string().nullable(),
  /** Null only after a write that sent `themeColor: null`. */
  themeColor: z.string().nullable(),
  about: z.string().nullable(),
  pronouns: z.string().nullable(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  aiBriefing: z.string().nullable(),
  aiBackground: z.string().nullable(),
  aiSummary: z.string().nullable(),
  aiHydratedAt: z.string().nullable(),
  aiBriefingAt: z.string().nullable(),
  isGhost: z.boolean(),
  isArchived: z.boolean(),
  relationshipScore: z.number(),
  searchExpansion: z.string().nullable().meta(INTERNAL),
  deletedAt: z.string().nullable().meta(INTERNAL),
  canonicalId: z.string().nullable().meta(INTERNAL),
  phoneticHash: z.string().nullable().meta(INTERNAL),
  geoSource: geoSourceSchema,
  /**
   * A person chose to keep up with this contact. Only a tracked contact has
   * a score, a place on Pulse and a tint on the map.
   */
  isTracked: z.boolean(),
  /** When `isTracked` last turned on. Null while untracked. */
  trackedAt: z.string().nullable(),
  /** The research record, JSON in the shape of shared/researchRecord.ts. */
  aiResearch: z.string().nullable(),
  ownerId: z.string().meta(INTERNAL),
  scoreDirty: z.number().int().meta(INTERNAL),
};

/** A contact with every child record, as `GET /api/contacts/:id` sends it. */
export const contactSchema = z
  .strictObject({
    ...contactColumns,
    emails: z.array(contactEmailSchema),
    phones: z.array(contactPhoneSchema),
    socialLinks: z.array(contactSocialLinkSchema),
    education: z.array(contactEducationSchema),
    experience: z.array(contactExperienceSchema),
    sources: z.array(contactSourceSchema),
    tags: z.array(contactTagSchema),
    interests: z.array(contactInterestSchema),
    attributes: z.array(contactAttributeSchema),
    addresses: z.array(contactAddressSchema),
    lists: z.array(contactListRefSchema),
    interactionCount: z.number().int(),
  })
  .meta({ id: "Contact" });

/**
 * A raw `contacts` row, as the query route sends it: the three flags as 0 or
 * 1, and no child records.
 */
export const contactRowSchema = z.strictObject({
  ...contactColumns,
  isGhost: z.number().int().nullable(),
  isArchived: z.number().int().nullable(),
  isTracked: z.number().int(),
});

const RESEARCH_OUTCOMES = ["added", "nothing-new", "no-public-info"] as const;

/**
 * One row of the list view, `GET /api/contacts?view=slim`: the fields the
 * list, the map and the search read, emails and phones as bare values, and
 * empty arrays where the full contact has child records.
 */
const slimContactSchema = z
  .strictObject({
    ...z.strictObject(contactColumns).pick({
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      company: true,
      avatarUrl: true,
      themeColor: true,
      isGhost: true,
      isArchived: true,
      addedAt: true,
      updatedAt: true,
      role: true,
      headline: true,
      location: true,
      industry: true,
      pronouns: true,
      cadenceDays: true,
      lastContactedAt: true,
      nextFollowUpAt: true,
      lat: true,
      lng: true,
      geoSource: true,
      relationshipScore: true,
      isTracked: true,
      trackedAt: true,
      aiHydratedAt: true,
      birthday: true,
    }).shape,
    /** The last research run's outcome, or null before any run. */
    researchOutcome: z.enum(RESEARCH_OUTCOMES).nullable(),
    /** Each tag's `id` is the tag itself in this view. */
    tags: z.array(contactTagSchema),
    lists: z.array(
      contactListRefSchema.extend({ sortOrder: z.number().int() }),
    ),
    interactionCount: z.number().int(),
    emails: z.array(z.strictObject({ email: z.string() })),
    phones: z.array(z.strictObject({ phone: z.string() })),
    socialLinkCount: z.number().int(),
    socialLinks: z.tuple([]),
    education: z.tuple([]),
    experience: z.tuple([]),
    sources: z.tuple([]),
    addresses: z.tuple([]),
    interests: z.tuple([]),
    attributes: z.tuple([]),
  })
  .meta({ id: "SlimContact" });

/** A contact with a pin, as the map draws it. */
const mapContactSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    company: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    location: z.string().nullable(),
    lat: z.number(),
    lng: z.number(),
    geoSource: geoSourceSchema,
  })
  .meta({ id: "MapContact" });

/** Why a tracked contact scores what it scores: five signals, each 0 to 100. */
const scoreBreakdownSchema = z
  .strictObject({
    score: z.number(),
    components: z.array(
      z.strictObject({
        key: z.enum([
          "recency",
          "frequency",
          "depth",
          "reciprocity",
          "momentum",
        ]),
        label: z.string(),
        /** 0 to 100 for this signal alone. */
        value: z.number(),
        /** Its share of the composite, 0 to 1. */
        weight: z.number(),
        /** What this signal measured, in words. */
        detail: z.string(),
      }),
    ),
  })
  .meta({ id: "ScoreBreakdown" });

const IMPORT_STATUSES = ["running", "imported", "complete", "failed"] as const;

// =============================================================================
// Routes
// =============================================================================

export const contactRoutes = {
  map: route({
    method: "GET",
    path: "/api/contacts/map",
    summary: "The contacts with a pin, for the map",
    response: z.array(mapContactSchema),
  }),
  archived: route({
    method: "GET",
    path: "/api/contacts/archived",
    summary: "The archived contacts, newest change first",
    response: z.array(contactSchema),
  }),
  list: route({
    method: "GET",
    path: "/api/contacts",
    summary:
      "Every contact in the network. `view=slim` answers the list view rows instead of whole contacts",
    query: z.object({
      view: queryText.describe('"slim" for the list view rows'),
    }),
    response: z.union([z.array(contactSchema), z.array(slimContactSchema)]),
  }),
  get: route({
    method: "GET",
    path: "/api/contacts/:id",
    summary: "One contact with every child record",
    response: contactSchema,
  }),
  score: route({
    method: "GET",
    path: "/api/contacts/:id/score",
    summary: "Why a tracked contact scores what it scores",
    response: scoreBreakdownSchema,
  }),
  create: route({
    method: "POST",
    path: "/api/contacts",
    summary: "Add a contact",
    status: 201,
    body: contactCreateSchema,
    response: contactSchema,
  }),
  bulkCreate: route({
    method: "POST",
    path: "/api/contacts/bulk",
    summary:
      "Import contacts. A known X-Import-Id answers 200 with the first run's counts and writes nothing. With Accept: text/event-stream the answer is a stream of progress events instead",
    status: [200, 201],
    body: contactBulkCreateSchema,
    response: z.union([
      z.strictObject({
        success: z.literal(true),
        count: z.number().int(),
        failed: z.number().int(),
        importId: z.string(),
      }),
      z.strictObject({
        success: z.literal(true),
        repeated: z.literal(true),
        importId: z.string(),
        status: z.enum(IMPORT_STATUSES),
        count: z.number().int(),
        failed: z.number().int(),
      }),
    ]),
  }),
  bulkDelete: route({
    method: "POST",
    path: "/api/contacts/bulk-delete",
    summary: "Move contacts to the trash",
    body: z.object({ ids: idsSchema }),
    response: z.strictObject({
      success: z.literal(true),
      count: z.number().int(),
      /** How many days the trash keeps them. */
      retentionDays: z.number().int(),
    }),
  }),
  bulkUpdate: route({
    method: "PUT",
    path: "/api/contacts/bulk-update",
    summary: "Change the same profile fields on many contacts",
    body: z.object({
      ids: idsSchema,
      data: contactUpdateSchema.refine(
        (data) => !CHILD_KEYS.some((key) => key in data),
        {
          message:
            "Bulk edits support profile fields only. Edit contact details on each contact.",
        },
      ),
    }),
    response: z.strictObject({
      success: z.literal(true),
      count: z.number().int(),
    }),
  }),
  replace: route({
    method: "PUT",
    path: "/api/contacts/:id",
    summary: "Change a contact. Each child array sent replaces the one stored",
    body: contactUpdateSchema,
    response: contactSchema,
  }),
  patch: route({
    method: "PATCH",
    path: "/api/contacts/:id",
    summary:
      "Change a contact's profile fields. A body with a child array is refused",
    body: contactUpdateSchema,
    response: contactSchema,
  }),
  delete: route({
    method: "DELETE",
    path: "/api/contacts/:id",
    summary: "Move a contact to the trash",
    response: z.strictObject({
      success: z.literal(true),
      retentionDays: z.number().int(),
    }),
  }),
  location: route({
    method: "PATCH",
    path: "/api/contacts/:id/location",
    summary: "Place the pin by hand, or hand it back to the geocoder",
    body: contactLocationSchema,
    response: contactSchema,
  }),
  avatar: route({
    method: "POST",
    path: "/api/contacts/:id/avatar",
    summary:
      "Upload a photo as the multipart field `avatar`: JPEG, PNG, GIF, WebP or AVIF, up to 10 MB",
    response: contactSchema,
  }),
  enrich: route({
    method: "POST",
    path: "/api/contacts/:id/enrich",
    summary: "Research one contact now and merge what it finds",
    // No body at all is the same as an empty one.
    body: z.preprocess(
      (body) => body ?? {},
      z.object({
        /** A registered research technique, such as "search-and-read". */
        technique: z.string().trim().max(40).optional(),
        /** A registered web search, such as "searxng". */
        webSearch: z.string().trim().max(40).optional(),
        depth: researchDepthSchema.optional(),
      }),
    ),
    response: z.strictObject({
      success: z.literal(true),
      fieldsUpdated: z.number().int(),
      outcome: z.enum(RESEARCH_OUTCOMES),
      latencyMs: z.number(),
      models: z.array(z.string()),
      tokenCount: z.number(),
    }),
  }),
  rejectResearchRun: route({
    method: "POST",
    path: "/api/contacts/:id/research/reject",
    summary:
      "Not this person: take back what one research run added, and leave its pages out of later runs",
    body: z.object({
      /** The run, by its `at` in the contact's research record. */
      runAt: z.string().trim().min(1).max(40),
    }),
    response: z.strictObject({
      success: z.literal(true),
      /** Fields, entries and list items taken back. */
      removed: z.number().int(),
      contact: contactSchema,
    }),
  }),
  merge: route({
    method: "POST",
    path: "/api/contacts/merge",
    summary: "Merge one contact into another",
    body: mergeBodySchema,
    response: z.strictObject({
      success: z.literal(true),
      contact: contactSchema,
      /** The merge-history row, for Undo. */
      mergeLogId: z.string(),
    }),
  }),
  mergeCluster: route({
    method: "POST",
    path: "/api/contacts/merge-cluster",
    summary: "Merge up to ten contacts into one",
    body: mergeClusterBodySchema,
    response: z.strictObject({
      success: z.boolean(),
      merged: z.number().int(),
      failed: z.number().int(),
      /** The primary after the last merge that worked, or null. */
      contact: contactSchema.nullable(),
      /** The merge-history rows of the merges that worked, in merge order. */
      mergeLogIds: z.array(z.string()),
    }),
  }),
  mergeClusters: route({
    method: "POST",
    path: "/api/contacts/merge-clusters",
    summary: "Merge many clusters in one call, up to 250 merges in all",
    body: mergeClustersBodySchema,
    response: z.strictObject({
      results: z.array(
        z.strictObject({
          primaryId: z.string(),
          merged: z.number().int(),
          failed: z.number().int(),
          /** This cluster's merge-history rows, in merge order. */
          mergeLogIds: z.array(z.string()),
        }),
      ),
      totalMerged: z.number().int(),
      totalFailed: z.number().int(),
    }),
  }),
};

export type Contact = z.infer<typeof contactSchema>;
export type SlimContact = z.infer<typeof slimContactSchema>;
export type ContactEmail = z.infer<typeof contactEmailSchema>;
export type ContactPhone = z.infer<typeof contactPhoneSchema>;
export type ContactAddress = z.infer<typeof contactAddressSchema>;
export type ContactSocialLink = z.infer<typeof contactSocialLinkSchema>;
export type ContactEducation = z.infer<typeof contactEducationSchema>;
export type ContactExperience = z.infer<typeof contactExperienceSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

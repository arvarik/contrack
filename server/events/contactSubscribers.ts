// =============================================================================
// The reactions to a contact write
// =============================================================================
// Every write path that changes a contact records an event
// (contactService, interactionService for a ghost, dedupe/merging). These
// subscribers turn the events into follow-up work, and each one decides from
// the event alone: its type, the field names in `changed`, and the facts the
// payload carries, such as where a contact came from. Not from which function
// wrote it. So a rename by PATCH gets the dedupe vector and the duplicate
// check that PUT always got.
//
// The differences that stay are on purpose, and the payload carries them:
// - An import (`origin: "import"`) and a bulk edit (`bulk: true`) get no
//   per-row dedupe vector and no per-row duplicate check. The import runs one
//   duplicate pass for the whole file, and thousands of embedding calls at
//   once would swamp the embedding worker. An import is not indexed for
//   search per row either, as before.
// - A ghost made from a note (`origin: "mention"`) gets only the cache
//   invalidation: the mention resolver already decided what it is.
// - Auto-enrichment runs only where `autoEnrich` says a person added the
//   contact and allowed it.
// - A bulk edit that turns tracking on is scored by its route, as a batch.
//
// Each handler is synchronous and short. It schedules work and returns:
// the search index queue, a job, a fire-and-forget promise.
//
// The subscribers register when this module loads. contactService imports
// it, so every process that can write a contact runs them: the server, a
// test app, a test that calls a service, a script. Registration is
// idempotent by id.
// =============================================================================

import crypto from "node:crypto";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { aiCache } from "../utils/aiCache.ts";
import { scopeForOwnerId } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { scheduleSearchIndex } from "../services/search/indexQueue.ts";
import { generateAndStoreEmbedding } from "../services/dedupe/embeddings.ts";
import { queueGeocode } from "../services/geocoding/index.ts";
import { relationshipService } from "../services/relationshipService.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { aiAllowedForUser } from "../ai/instanceSwitch.ts";
import { chooseResearch } from "../services/research/index.ts";
import { jobQueue } from "../services/aiSearch/jobQueue.ts";
import { DEFAULT_RESEARCH_DEPTH } from "../../shared/researchDepth.ts";
import { enqueueJob, registerJobs } from "../jobs/runner.ts";
import { DEDUPE_CHECK_JOB } from "../jobs/dedupe.ts";
import {
  registerSubscribers,
  type AnyDomainEvent,
  type Subscriber,
} from "./dispatcher.ts";
import type { EventPayload } from "../../shared/contracts/events.ts";

/** The fields the search document reads, relations included. */
const SEARCH_FIELDS = [
  "name",
  "company",
  "role",
  "location",
  "industry",
  "headline",
  "about",
  "preferences",
  "tags",
  "interests",
];

/** The fields the dedupe vector is built from. */
const DEDUPE_VECTOR_FIELDS = [
  "name",
  "company",
  "role",
  "location",
  "industry",
  "headline",
];

/** The identity fields the duplicate check compares. */
const DEDUPE_CHECK_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "company",
  "role",
  "location",
];

/** The fields a pin is read from. */
const ADDRESS_FIELDS = ["location", "addresses"];

/** The duplicate check waits this long, so a burst of edits is one check. */
export const DEDUPE_CHECK_DELAY_MS = 5_000;

/** The owner-keyed AI cache tiers that hold a view of contact data. */
const OWNER_CACHE_TIERS = ["rerank", "synthesis", "dailyInsight", "briefing"];

const touches = (changed: readonly string[], fields: readonly string[]) =>
  changed.some((field) => fields.includes(field));

/**
 * True for a contact somebody added one at a time: in the app, through the
 * API, by an MCP client or by a connector sync.
 */
const addedOneByOne = (payload: EventPayload<"contact.created">) =>
  payload.origin === "manual" || payload.origin === "connector";

interface ContactFacts {
  name: string | null;
  location: string | null;
  geoSource: string | null;
  isGhost: number | null;
  isArchived: number | null;
  deletedAt: string | null;
}

/** The row a handler decides from, read after the commit. */
function contactFacts(event: AnyDomainEvent): ContactFacts | undefined {
  return sqlite
    .prepare(
      `SELECT name, location, geoSource, isGhost, isArchived, deletedAt
         FROM contacts WHERE id = ? AND ownerId = ?`,
    )
    .get(event.subjectId, event.ownerId) as ContactFacts | undefined;
}

/** The address the contact page shows first: the primary, else the first. */
function primaryAddress(contactId: string): string | null {
  const row = sqlite
    .prepare(
      `SELECT address FROM contact_addresses WHERE contactId = ?
        ORDER BY isPrimary DESC, sortOrder ASC LIMIT 1`,
    )
    .get(contactId) as { address: string | null } | undefined;
  return row?.address || null;
}

/**
 * The search index: the contact's vector and passages are rebuilt from the
 * queue. The FTS rows need no help, because triggers keep them.
 */
const searchIndex: Subscriber = {
  id: "contacts.searchIndex",
  types: ["contact.created", "contact.updated", "contact.restored"],
  handle(event) {
    if (event.type === "contact.created" && !addedOneByOne(event.payload)) {
      return;
    }
    if (
      event.type === "contact.updated" &&
      !touches(event.payload.changed, SEARCH_FIELDS)
    ) {
      return;
    }
    scheduleSearchIndex(event.subjectId);
  },
};

/** The dedupe vector, from the fields the duplicate check embeds. */
const dedupeVector: Subscriber = {
  id: "contacts.dedupeVector",
  types: ["contact.created", "contact.updated", "contact.restored"],
  handle(event) {
    if (event.type === "contact.created" && !addedOneByOne(event.payload)) {
      return;
    }
    if (
      event.type === "contact.updated" &&
      (event.payload.bulk ||
        !touches(event.payload.changed, DEDUPE_VECTOR_FIELDS))
    ) {
      return;
    }
    const id = event.subjectId;
    generateAndStoreEmbedding(id).catch((err) =>
      log.warn(
        "ContactService",
        `Background embedding for ${id} failed: ${getErrorMessage(err)}`,
      ),
    );
  },
};

/**
 * The duplicate check for one contact, when the owner has "check for
 * duplicates when a contact is added" on. A job keyed by the contact, five
 * seconds out: a second edit in that time moves the same job, so a burst of
 * edits is one check. With background jobs off the job stays queued.
 */
const dedupeCheck: Subscriber = {
  id: "contacts.dedupeCheck",
  types: ["contact.created", "contact.updated"],
  handle(event) {
    if (event.type === "contact.created" && !addedOneByOne(event.payload)) {
      return;
    }
    if (
      event.type === "contact.updated" &&
      (event.payload.bulk ||
        !touches(event.payload.changed, DEDUPE_CHECK_FIELDS))
    ) {
      return;
    }
    if (!getPreferences(event.ownerId).dedupeOnCreate) return;
    enqueueJob(
      DEDUPE_CHECK_JOB.kind,
      { contactId: event.subjectId },
      {
        ownerId: event.ownerId,
        runAt: Date.now() + DEDUPE_CHECK_DELAY_MS,
        dedupeKey: `${DEDUPE_CHECK_JOB.kind}:${event.subjectId}`,
      },
    );
  },
};

/**
 * The geocoder, for a contact whose address the write set.
 *
 * A pin a person placed is not the geocoder's to move. The write that changed
 * the address under such a pin cleared `geoSource` in its own transaction
 * (contactService), so the pin reaching this handler as 'manual' is one whose
 * address did not move, and it is left alone.
 */
const geocode: Subscriber = {
  id: "contacts.geocode",
  types: ["contact.created", "contact.updated"],
  handle(event) {
    let text: string | null = null;
    if (event.type === "contact.created") {
      if (event.payload.origin === "mention") return;
      const facts = contactFacts(event);
      if (!facts) return;
      // An import reads the location field and not the address rows, as it
      // always has.
      text =
        facts.location ||
        (event.payload.origin === "import"
          ? null
          : primaryAddress(event.subjectId));
    } else if (event.type === "contact.updated") {
      const { changed } = event.payload;
      if (!touches(changed, ADDRESS_FIELDS)) return;
      const facts = contactFacts(event);
      if (!facts || facts.geoSource === "manual") return;
      text =
        (changed.includes("location") ? facts.location : null) ||
        (changed.includes("addresses")
          ? primaryAddress(event.subjectId)
          : null);
    }
    if (text) queueGeocode(event.subjectId, text);
  },
};

/**
 * The relationship score of a contact that tracking was just turned on for,
 * so the ring is right on the read that follows and not after the hourly
 * sweep. `computeScore` scores tracked contacts only. A bulk edit is scored by
 * its route, as one batch.
 */
const score: Subscriber = {
  id: "contacts.score",
  types: ["contact.updated"],
  handle(event) {
    if (event.type !== "contact.updated") return;
    if (event.payload.bulk || !event.payload.changed.includes("isTracked")) {
      return;
    }
    relationshipService.computeScore(event.subjectId);
  },
};

/**
 * The owner's AI cache tiers that hold a view of contact data.
 *
 * Not every tier: the content-addressed ones (query parsing, mentions) hash
 * their own input and stay valid. Each tier is owner-keyed, so one account's
 * edit drops only that account's entries. A batch write runs its dispatch in
 * the cache's batch mode, so a thousand events cost one invalidation.
 */
const ownerCaches: Subscriber = {
  id: "contacts.ownerCaches",
  types: [
    "contact.created",
    "contact.updated",
    "contact.deleted",
    "contact.restored",
    "contact.merged",
  ],
  handle(event) {
    for (const tier of OWNER_CACHE_TIERS) {
      aiCache.invalidateForOwner(tier, event.ownerId);
    }
  },
};

/**
 * "Enrich new contacts automatically", for a contact a person added. Whether
 * research may run at all is chooseResearch's question. aiAllowedForUser
 * reads both switches: the account's and the instance's.
 */
const autoEnrich: Subscriber = {
  id: "contacts.autoEnrich",
  types: ["contact.created"],
  handle(event) {
    if (event.type !== "contact.created" || !event.payload.autoEnrich) return;
    const prefs = getPreferences(event.ownerId);
    if (!prefs.autoEnrich || !aiAllowedForUser(event.ownerId)) return;
    const facts = contactFacts(event);
    if (!facts?.name || facts.isGhost || facts.isArchived || facts.deletedAt) {
      return;
    }
    const scope = scopeForOwnerId(event.ownerId);
    const contact = { id: event.subjectId, name: facts.name };
    runWithContext(
      {
        requestId: `enrich-${crypto.randomUUID().slice(0, 8)}`,
        principal: null,
        scope,
      },
      () => {
        try {
          // The account's web search engine, at Standard depth.
          const choice = chooseResearch({}, prefs.webSearchEngine);
          const check = jobQueue.canStartBatch(scope);
          // While this account's batch runs, the new contact joins it. A
          // batch created beside it would never run.
          if (check.appendTo) {
            jobQueue.appendToBatch(
              scope,
              check.appendTo,
              [contact],
              DEFAULT_RESEARCH_DEPTH,
              choice,
            );
          } else if (check.allowed) {
            const batch = jobQueue.createBatch(scope, [contact], choice);
            jobQueue.processBatch(batch.id).catch((err) => {
              log.error(
                "ContactService",
                `Auto-enrich batch ${batch.id} processing error: ${getErrorMessage(err)}`,
              );
            });
          }
        } catch (err) {
          log.warn(
            "ContactService",
            `Auto-enrich for ${contact.id} failed to schedule: ${getErrorMessage(err)}`,
          );
        }
      },
    );
  },
};

/** Every contact subscriber, in the order they run for one event. */
export const CONTACT_SUBSCRIBERS: readonly Subscriber[] = [
  searchIndex,
  dedupeVector,
  dedupeCheck,
  geocode,
  score,
  ownerCaches,
  autoEnrich,
];

registerSubscribers(CONTACT_SUBSCRIBERS);
// The duplicate check's job, so runJobNow and the runner know the kind
// wherever a contact can be written.
registerJobs([DEDUPE_CHECK_JOB]);
